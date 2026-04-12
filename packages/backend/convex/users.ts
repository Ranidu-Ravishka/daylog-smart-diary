import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  getCurrentUser,
  requireUser,
  requireAdmin,
  requireIdentityMatch,
} from "./authz";
import { convexServerEnv } from "./env";
import type { Doc, Id } from "./_generated/dataModel";
import {
  USER_CASCADE_DELETION_STAGES,
  getNextUserCascadeDeletionStage,
  runUserCascadeDeletionStageBatch,
  type UserCascadeDeleteProgress,
} from "./cascadeCleanup";
import { applyDashboardMetricsDelta } from "./dashboardMetrics";

const DEFAULT_USER_DELETION_BATCH_SIZE = 128;

type UserDeletionJobStatus =
  | "requested"
  | "processing"
  | "completed"
  | "failed";

type UserDeletionProgress = Doc<"userDeletionJobs">["progress"];

function emptyUserDeletionProgress(): UserDeletionProgress {
  return {
    deletedMemories: 0,
    deletedSummaries: 0,
    deletedDays: 0,
    deletedIntegrations: 0,
    deletedPreferences: 0,
    deletedAuditLogs: 0,
    deletedMemoryMedia: 0,
    deletedIntegrationDailyData: 0,
    deletedIntegrationSecrets: 0,
    deletedIntegrationSyncRuns: 0,
    deletedSummaryGenerationQuotas: 0,
  };
}

function mergeUserDeletionProgress(
  base: UserDeletionProgress,
  delta: UserCascadeDeleteProgress,
): UserDeletionProgress {
  return {
    deletedMemories: base.deletedMemories + delta.deletedMemories,
    deletedSummaries: base.deletedSummaries + delta.deletedSummaries,
    deletedDays: base.deletedDays + delta.deletedDays,
    deletedIntegrations: base.deletedIntegrations + delta.deletedIntegrations,
    deletedPreferences: base.deletedPreferences + delta.deletedPreferences,
    deletedAuditLogs: base.deletedAuditLogs + delta.deletedAuditLogs,
    deletedMemoryMedia: base.deletedMemoryMedia + delta.deletedMemoryMedia,
    deletedIntegrationDailyData:
      base.deletedIntegrationDailyData + delta.deletedIntegrationDailyData,
    deletedIntegrationSecrets:
      base.deletedIntegrationSecrets + delta.deletedIntegrationSecrets,
    deletedIntegrationSyncRuns:
      base.deletedIntegrationSyncRuns + delta.deletedIntegrationSyncRuns,
    deletedSummaryGenerationQuotas:
      base.deletedSummaryGenerationQuotas +
      delta.deletedSummaryGenerationQuotas,
  };
}

function resolveUserDeletionBatchSize(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_USER_DELETION_BATCH_SIZE;
  }

  return Math.max(1, Math.min(Math.floor(value ?? 0), 512));
}

type UserDeletionJobRef = {
  jobId: Id<"userDeletionJobs">;
  status: UserDeletionJobStatus;
  stage: Doc<"userDeletionJobs">["stage"];
};

async function findLatestUserDeletionJobByUserId(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"user">,
): Promise<Doc<"userDeletionJobs"> | null> {
  const processing = await ctx.db
    .query("userDeletionJobs")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "processing"),
    )
    .order("desc")
    .take(1);
  if (processing[0]) return processing[0];

  const requested = await ctx.db
    .query("userDeletionJobs")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "requested"),
    )
    .order("desc")
    .take(1);
  if (requested[0]) return requested[0];

  const completed = await ctx.db
    .query("userDeletionJobs")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "completed"),
    )
    .order("desc")
    .take(1);

  const failed = await ctx.db
    .query("userDeletionJobs")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "failed"),
    )
    .order("desc")
    .take(1);

  const latestCompleted = completed[0] ?? null;
  const latestFailed = failed[0] ?? null;

  if (!latestCompleted) {
    return latestFailed;
  }

  if (!latestFailed) {
    return latestCompleted;
  }

  return latestCompleted.updatedAt >= latestFailed.updatedAt
    ? latestCompleted
    : latestFailed;
}

async function findActiveUserDeletionJobByClerkId(
  ctx: Pick<MutationCtx, "db">,
  clerkUserId: string,
): Promise<UserDeletionJobRef | null> {
  const processing = await ctx.db
    .query("userDeletionJobs")
    .withIndex("by_clerk_status", (q) =>
      q.eq("clerkUserId", clerkUserId).eq("status", "processing"),
    )
    .order("desc")
    .take(1);
  if (processing[0]) {
    return {
      jobId: processing[0]._id,
      status: processing[0].status,
      stage: processing[0].stage,
    };
  }

  const requested = await ctx.db
    .query("userDeletionJobs")
    .withIndex("by_clerk_status", (q) =>
      q.eq("clerkUserId", clerkUserId).eq("status", "requested"),
    )
    .order("desc")
    .take(1);
  if (requested[0]) {
    return {
      jobId: requested[0]._id,
      status: requested[0].status,
      stage: requested[0].stage,
    };
  }

  return null;
}

async function scheduleUserDeletionStep(
  ctx: Pick<MutationCtx, "scheduler">,
  jobId: Id<"userDeletionJobs">,
): Promise<void> {
  await ctx.scheduler.runAfter(
    0,
    internal.users.runUserDeletionCascadeJobStepInternal,
    {
      jobId,
    },
  );
}

async function enqueueUserDeletionJob(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: {
    userId: Id<"user">;
    clerkUserId: string;
    requestedByUserId?: Id<"user">;
  },
): Promise<UserDeletionJobRef & { created: boolean }> {
  const existing = await findLatestUserDeletionJobByUserId(ctx, args.userId);

  if (existing?.status === "processing") {
    return {
      created: false,
      jobId: existing._id,
      status: existing.status,
      stage: existing.stage,
    };
  }

  if (existing?.status === "requested") {
    return {
      created: false,
      jobId: existing._id,
      status: existing.status,
      stage: existing.stage,
    };
  }

  const now = Date.now();
  const initialStage = USER_CASCADE_DELETION_STAGES[0];
  if (!initialStage) {
    throw new Error("User deletion stages are not configured");
  }

  const jobId = await ctx.db.insert("userDeletionJobs", {
    userId: args.userId,
    clerkUserId: args.clerkUserId,
    requestedByUserId: args.requestedByUserId,
    status: "requested",
    stage: initialStage,
    processedBatches: 0,
    checkpoints: 0,
    progress: emptyUserDeletionProgress(),
    startedAt: now,
    updatedAt: now,
  });

  await scheduleUserDeletionStep(ctx, jobId);

  return {
    created: true,
    jobId,
    status: "requested",
    stage: initialStage,
  };
}

export const enqueueUserDeletionJobInternal = internalMutation({
  args: {
    userId: v.id("user"),
    clerkUserId: v.string(),
    requestedByUserId: v.optional(v.id("user")),
  },
  handler: async (ctx, args) => {
    return await enqueueUserDeletionJob(ctx, args);
  },
});

export const runUserDeletionCascadeJobStepInternal = internalMutation({
  args: {
    jobId: v.id("userDeletionJobs"),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return {
        success: false,
        done: true,
        reason: "job_not_found",
      } as const;
    }

    if (job.status === "completed") {
      return {
        success: true,
        done: true,
        jobId: job._id,
        status: job.status,
        stage: job.stage,
        checkpoints: job.checkpoints,
        processedBatches: job.processedBatches,
        progress: job.progress,
      } as const;
    }

    if (job.status === "failed") {
      return {
        success: false,
        done: true,
        reason: "job_failed",
        jobId: job._id,
        status: job.status,
        stage: job.stage,
        checkpoints: job.checkpoints,
        processedBatches: job.processedBatches,
        progress: job.progress,
      } as const;
    }

    try {
      const batch = await runUserCascadeDeletionStageBatch(ctx, {
        userId: job.userId,
        clerkUserId: job.clerkUserId,
        stage: job.stage,
        cursor: job.cursor ?? null,
        batchSize: resolveUserDeletionBatchSize(args.batchSize),
      });

      const now = Date.now();
      const nextProgress = mergeUserDeletionProgress(
        job.progress,
        batch.deleted,
      );
      const nextProcessedBatches = job.processedBatches + 1;
      const nextCheckpoints = job.checkpoints + 1;

      if (!batch.isStageComplete) {
        await ctx.db.patch(job._id, {
          status: "processing",
          cursor: batch.nextCursor ?? undefined,
          progress: nextProgress,
          processedBatches: nextProcessedBatches,
          checkpoints: nextCheckpoints,
          lastCheckpointAt: now,
          updatedAt: now,
        });

        await scheduleUserDeletionStep(ctx, job._id);

        return {
          success: true,
          done: false,
          jobId: job._id,
          status: "processing",
          stage: job.stage,
          cursor: batch.nextCursor,
          checkpoints: nextCheckpoints,
          processedBatches: nextProcessedBatches,
          progress: nextProgress,
        } as const;
      }

      const nextStage = getNextUserCascadeDeletionStage(job.stage);
      if (nextStage) {
        await ctx.db.patch(job._id, {
          status: "processing",
          stage: nextStage,
          cursor: undefined,
          progress: nextProgress,
          processedBatches: nextProcessedBatches,
          checkpoints: nextCheckpoints,
          lastCheckpointAt: now,
          updatedAt: now,
        });

        await scheduleUserDeletionStep(ctx, job._id);

        return {
          success: true,
          done: false,
          jobId: job._id,
          status: "processing",
          stage: nextStage,
          checkpoints: nextCheckpoints,
          processedBatches: nextProcessedBatches,
          progress: nextProgress,
        } as const;
      }

      const userAtFinalize = await ctx.db.get(job.userId);
      const shouldApplyMetrics =
        !job.metricsAppliedAt && userAtFinalize !== null;

      if (shouldApplyMetrics) {
        await applyDashboardMetricsDelta(ctx.db, {
          totalUsers: -1,
          totalMemories: -nextProgress.deletedMemories,
          totalDays: -nextProgress.deletedDays,
          totalSummaries: -nextProgress.deletedSummaries,
          totalIntegrations: -nextProgress.deletedIntegrations,
          totalPreferences: -nextProgress.deletedPreferences,
          totalAuditLogs: -nextProgress.deletedAuditLogs,
        });
      }

      if (!job.userDeletedAt && userAtFinalize) {
        await ctx.db.delete(userAtFinalize._id);
      }

      await ctx.db.patch(job._id, {
        status: "completed",
        cursor: undefined,
        progress: nextProgress,
        processedBatches: nextProcessedBatches,
        checkpoints: nextCheckpoints,
        lastCheckpointAt: now,
        updatedAt: now,
        completedAt: now,
        failedAt: undefined,
        metricsAppliedAt: job.metricsAppliedAt ?? now,
        userDeletedAt: job.userDeletedAt ?? now,
        lastError: undefined,
      });

      return {
        success: true,
        done: true,
        jobId: job._id,
        status: "completed",
        stage: job.stage,
        checkpoints: nextCheckpoints,
        processedBatches: nextProcessedBatches,
        progress: nextProgress,
      } as const;
    } catch (error) {
      const now = Date.now();
      const message =
        error instanceof Error
          ? error.message
          : "User deletion job failed unexpectedly";

      await ctx.db.patch(job._id, {
        status: "failed",
        updatedAt: now,
        failedAt: now,
        lastError: message,
      });

      return {
        success: false,
        done: true,
        reason: "job_failed",
        jobId: job._id,
        status: "failed",
        stage: job.stage,
        checkpoints: job.checkpoints,
        processedBatches: job.processedBatches,
        progress: job.progress,
        error: message,
      } as const;
    }
  },
});

export const getUserDeletionJobByIdInternal = internalQuery({
  args: {
    jobId: v.id("userDeletionJobs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

// ── Sync a user row from Clerk (called by the client after sign-in).
//    Identity must match the clerkUserId arg.
export const syncUserFromClerk = mutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireIdentityMatch(ctx, args.clerkUserId);

    return await syncUserRecord(ctx, args);
  },
});

// ── Internal mutation for the Clerk webhook path.
//    Only callable from server actions (httpAction), never from clients.
export const syncUserFromClerkWebhook = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await syncUserRecord(ctx, args);
  },
});

// ── Shared logic for syncing a user record from Clerk data.
async function syncUserRecord(
  ctx: Pick<MutationCtx, "db">,
  args: {
    clerkUserId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    imageUrl?: string;
  },
) {
  const existing = await ctx.db
    .query("user")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      imageUrl: args.imageUrl,
    });

    return await ctx.db.get(existing._id);
  }

  const id = await ctx.db.insert("user", {
    clerkUserId: args.clerkUserId,
    email: args.email,
    firstName: args.firstName,
    lastName: args.lastName,
    imageUrl: args.imageUrl,
    planTier: "free",
    isAdmin: false,
  });

  await applyDashboardMetricsDelta(ctx.db, {
    totalUsers: 1,
  });

  return await ctx.db.get(id);
}

// ── Check whether the currently signed-in user is an admin
export const isCurrentUserAdmin = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user?.isAdmin === true;
  },
});

// ── Get a user by Clerk ID (admin-only)
export const getUserByClerkId = query({
  args: {
    clerkUserId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    return await ctx.db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();
  },
});

// ── List all users (admin-only)
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("user").collect();
  },
});

// ── Bootstrap: first-time admin setup via env-allowed Clerk IDs
function getBootstrapAdminIds(): string[] {
  return convexServerEnv.adminBootstrapClerkUserIds;
}

export const bootstrapMakeMeAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    // requireUser validates identity + user row existence
    const user = await requireUser(ctx);

    const bootstrapIds = getBootstrapAdminIds();
    if (bootstrapIds.length === 0 || !bootstrapIds.includes(user.clerkUserId)) {
      throw new Error("Forbidden: not in bootstrap admin list");
    }

    await ctx.db.patch(user._id, { isAdmin: true });
    return { success: true };
  },
});

// ── Set admin status for any user (admin-only)
export const setUserAdminStatus = mutation({
  args: {
    clerkUserId: v.string(),
    isAdmin: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const targetUser = await ctx.db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    if (!targetUser) {
      throw new Error("User not found");
    }

    await ctx.db.patch(targetUser._id, { isAdmin: args.isAdmin });
    return { success: true };
  },
});

// ── Internal mutation for account deletion from Clerk webhook.
//    Idempotent: succeeds even if user already removed.
export const deleteUserAndRelatedDataByClerkId = internalMutation({
  args: {
    clerkUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    if (!user) {
      const existingJob = await findActiveUserDeletionJobByClerkId(
        ctx,
        args.clerkUserId,
      );
      if (existingJob) {
        return {
          success: true,
          deleted: true,
          jobId: existingJob.jobId,
          status: existingJob.status,
          stage: existingJob.stage,
          queued: true,
        };
      }

      return { success: true, deleted: false, queued: false };
    }

    const job = await enqueueUserDeletionJob(ctx, {
      userId: user._id,
      clerkUserId: user.clerkUserId,
    });

    return {
      success: true,
      deleted: true,
      queued: true,
      jobId: job.jobId,
      status: job.status,
      stage: job.stage,
      created: job.created,
    };
  },
});
