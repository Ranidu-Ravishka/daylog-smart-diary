import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
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
import { captureException, logInfo } from "./observability";
import {
  findLatestUserDeletionJobByClerkUserId,
  findLatestUserDeletionJobByUserId,
} from "./userDeletionJobQueries";
import { enqueueUserIntegrationRevocations } from "./integrations";

const DEFAULT_USER_DELETION_BATCH_SIZE = 128;
const DEFAULT_ADMIN_USERS_PAGE_LIMIT = 50;
const MAX_ADMIN_USERS_PAGE_LIMIT = 200;
const PROFILE_IMAGE_CONTENT_TYPE_PREFIX = "image/";
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

type ProfileImageSource = "clerk" | "apple" | "google" | "manual";

function shouldUpdateProfileImageFromClerk(
  source: ProfileImageSource | undefined,
): boolean {
  return source === undefined || source === "clerk";
}

function resolveFallbackClerkEmail(clerkUserId: string): string {
  return `${clerkUserId}@daylog.invalid`;
}

async function createUserFromClerkIdentity(
  ctx: Pick<MutationCtx, "db">,
  args: {
    clerkUserId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    imageUrl?: string;
  },
) {
  const now = Date.now();
  const id = await ctx.db.insert("user", {
    clerkUserId: args.clerkUserId,
    email: args.email,
    firstName: args.firstName,
    lastName: args.lastName,
    imageUrl: args.imageUrl,
    profileImageSource: args.imageUrl ? "clerk" : undefined,
    accountStatus: "active",
    planTier: "free",
    isAdmin: false,
    adminAuthVersion: 0,
    adminRoleUpdatedAt: now,
  });

  await applyDashboardMetricsDelta(ctx.db, {
    totalUsers: 1,
  });

  return await ctx.db.get(id);
}

export const getUserIdByClerkIdInternal = internalQuery({
  args: {
    clerkUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();
    return user?._id;
  },
});

function clampAdminUsersPageLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ADMIN_USERS_PAGE_LIMIT;
  }

  const normalized = Math.floor(value);
  if (normalized < 1) return 1;
  if (normalized > MAX_ADMIN_USERS_PAGE_LIMIT) {
    return MAX_ADMIN_USERS_PAGE_LIMIT;
  }

  return normalized;
}

function buildAdminRoleStatePatch(
  user: Pick<
    Doc<"user">,
    "isAdmin" | "adminAuthVersion" | "adminRoleUpdatedAt"
  >,
  nextIsAdmin: boolean,
  now = Date.now(),
): {
  isAdmin: boolean;
  adminAuthVersion: number;
  adminRoleUpdatedAt: number;
} {
  const currentIsAdmin = user.isAdmin === true;
  const currentVersion = user.adminAuthVersion ?? 0;
  const roleChanged = currentIsAdmin !== nextIsAdmin;

  return {
    isAdmin: nextIsAdmin,
    adminAuthVersion: roleChanged ? currentVersion + 1 : currentVersion,
    adminRoleUpdatedAt: roleChanged ? now : (user.adminRoleUpdatedAt ?? now),
  };
}

function buildAdminRoleBootstrapPatch(
  user: Pick<Doc<"user">, "adminAuthVersion" | "adminRoleUpdatedAt">,
  now = Date.now(),
): Partial<Pick<Doc<"user">, "adminAuthVersion" | "adminRoleUpdatedAt">> {
  const patch: Partial<
    Pick<Doc<"user">, "adminAuthVersion" | "adminRoleUpdatedAt">
  > = {};

  if (user.adminAuthVersion === undefined) {
    patch.adminAuthVersion = 0;
  }

  if (user.adminRoleUpdatedAt === undefined) {
    patch.adminRoleUpdatedAt = now;
  }

  return patch;
}

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
    deletedPlatformAuditEvents: 0,
    deletedMemoryMedia: 0,
    deletedIntegrationDailyData: 0,
    deletedIntegrationSecrets: 0,
    deletedIntegrationSyncRuns: 0,
    deletedIntegrationHealthEvents: 0,
    deletedExportJobs: 0,
    deletedRestoreJobs: 0,
    deletedAiSummaryAttempts: 0,
    deletedSummaryGenerationEvents: 0,
    deletedSummaryQualityEvaluations: 0,
    deletedDailyFeatureVectors: 0,
    deletedNextBestDayRecommendations: 0,
    deletedSummaryGenerationQuotas: 0,
  };
}

function safeProgressCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return value;
}

function mergeUserDeletionProgress(
  base: UserDeletionProgress,
  delta: UserCascadeDeleteProgress,
): UserDeletionProgress {
  return {
    deletedMemories:
      safeProgressCount(base.deletedMemories) + delta.deletedMemories,
    deletedSummaries:
      safeProgressCount(base.deletedSummaries) + delta.deletedSummaries,
    deletedDays: safeProgressCount(base.deletedDays) + delta.deletedDays,
    deletedIntegrations:
      safeProgressCount(base.deletedIntegrations) + delta.deletedIntegrations,
    deletedPreferences:
      safeProgressCount(base.deletedPreferences) + delta.deletedPreferences,
    deletedAuditLogs:
      safeProgressCount(base.deletedAuditLogs) + delta.deletedAuditLogs,
    deletedPlatformAuditEvents:
      safeProgressCount(base.deletedPlatformAuditEvents) +
      delta.deletedPlatformAuditEvents,
    deletedMemoryMedia:
      safeProgressCount(base.deletedMemoryMedia) + delta.deletedMemoryMedia,
    deletedIntegrationDailyData:
      safeProgressCount(base.deletedIntegrationDailyData) +
      delta.deletedIntegrationDailyData,
    deletedIntegrationSecrets:
      safeProgressCount(base.deletedIntegrationSecrets) +
      delta.deletedIntegrationSecrets,
    deletedIntegrationSyncRuns:
      safeProgressCount(base.deletedIntegrationSyncRuns) +
      delta.deletedIntegrationSyncRuns,
    deletedIntegrationHealthEvents:
      safeProgressCount(base.deletedIntegrationHealthEvents) +
      delta.deletedIntegrationHealthEvents,
    deletedExportJobs:
      safeProgressCount(base.deletedExportJobs) + delta.deletedExportJobs,
    deletedRestoreJobs:
      safeProgressCount(base.deletedRestoreJobs) + delta.deletedRestoreJobs,
    deletedAiSummaryAttempts:
      safeProgressCount(base.deletedAiSummaryAttempts) +
      delta.deletedAiSummaryAttempts,
    deletedSummaryGenerationEvents:
      safeProgressCount(base.deletedSummaryGenerationEvents) +
      delta.deletedSummaryGenerationEvents,
    deletedSummaryQualityEvaluations:
      safeProgressCount(base.deletedSummaryQualityEvaluations) +
      delta.deletedSummaryQualityEvaluations,
    deletedDailyFeatureVectors:
      safeProgressCount(base.deletedDailyFeatureVectors) +
      delta.deletedDailyFeatureVectors,
    deletedNextBestDayRecommendations:
      safeProgressCount(base.deletedNextBestDayRecommendations) +
      delta.deletedNextBestDayRecommendations,
    deletedSummaryGenerationQuotas:
      safeProgressCount(base.deletedSummaryGenerationQuotas) +
      delta.deletedSummaryGenerationQuotas,
  };
}

function safeDetailsJson(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).slice(0, 1500);
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

type UserDeletionJobReader = Pick<MutationCtx | QueryCtx, "db">;

function shouldBlockUserSyncDuringDeletion(
  job: Doc<"userDeletionJobs"> | null,
): boolean {
  if (!job) {
    return false;
  }

  if (job.status === "requested" || job.status === "processing") {
    return true;
  }

  if (job.status === "completed") {
    return true;
  }

  return Boolean(job.userDeletedAt);
}

async function findActiveUserDeletionJobByClerkId(
  ctx: UserDeletionJobReader,
  clerkUserId: string,
): Promise<UserDeletionJobRef | null> {
  const latest = await findLatestUserDeletionJobByClerkUserId(ctx, clerkUserId);
  if (!latest) {
    return null;
  }

  if (latest.status !== "requested" && latest.status !== "processing") {
    return null;
  }

  return {
    jobId: latest._id,
    status: latest.status,
    stage: latest.stage,
  };
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

  await enqueueUserIntegrationRevocations(ctx, args.userId);

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
      logInfo("deletion.user_job_step.skipped_missing_job", {
        status: "skipped",
        jobId: args.jobId,
      });

      return {
        success: false,
        done: true,
        reason: "job_not_found",
      } as const;
    }

    logInfo("deletion.user_job_step.started", {
      status: "started",
      jobId: job._id,
      userId: job.userId,
      stage: job.stage,
      currentStatus: job.status,
      processedBatches: job.processedBatches,
      checkpoints: job.checkpoints,
    });

    if (job.status === "completed") {
      logInfo("deletion.user_job_step.already_completed", {
        status: "succeeded",
        jobId: job._id,
        userId: job.userId,
        stage: job.stage,
      });

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
      logInfo("deletion.user_job_step.already_failed", {
        status: "failed",
        jobId: job._id,
        userId: job.userId,
        stage: job.stage,
        errorMessage: job.lastError,
      });

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

        logInfo("deletion.user_job_step.checkpoint", {
          status: "processing",
          jobId: job._id,
          userId: job.userId,
          stage: job.stage,
          nextCursor: batch.nextCursor,
          processedBatches: nextProcessedBatches,
          checkpoints: nextCheckpoints,
        });

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

        logInfo("deletion.user_job_step.stage_advanced", {
          status: "processing",
          jobId: job._id,
          userId: job.userId,
          previousStage: job.stage,
          nextStage,
          processedBatches: nextProcessedBatches,
          checkpoints: nextCheckpoints,
        });

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
        const userProfileImageStorageId = (userAtFinalize as any)
          .profileImageStorageId as string | undefined;
        if (typeof userProfileImageStorageId === "string") {
          await ctx.storage.delete(userProfileImageStorageId as any);
        }

        const keepTombstoneUntilClerkDeleted =
          job.requestedByUserId !== undefined;
        if (keepTombstoneUntilClerkDeleted) {
          await ctx.db.patch(userAtFinalize._id, {
            accountBackendPurgedAt: now,
          });
        } else {
          await ctx.db.delete(userAtFinalize._id);
        }
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

      try {
        await ctx.db.insert("platformAuditEvents", {
          category: "deletion",
          action: "user_cascade_delete_completed",
          actorType: job.requestedByUserId ? "admin" : "system",
          actorUserId: job.requestedByUserId,
          target: String(job._id),
          details: safeDetailsJson({
            userId: job.userId,
            stage: job.stage,
            checkpoints: nextCheckpoints,
            processedBatches: nextProcessedBatches,
            progress: nextProgress,
          }),
          at: now,
        });

        if (job.requestedByUserId) {
          await ctx.db.insert("auditLogs", {
            actorUserId: job.requestedByUserId,
            action: "delete_user_completed",
            target: String(job.userId),
            at: now,
          });
        }
      } catch {
        // Do not fail deletion completion if audit write fails.
      }

      logInfo("deletion.user_job.completed", {
        status: "succeeded",
        jobId: job._id,
        userId: job.userId,
        stage: job.stage,
        processedBatches: nextProcessedBatches,
        checkpoints: nextCheckpoints,
        durationMs: Math.max(now - job.startedAt, 0),
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

      try {
        await ctx.db.insert("platformAuditEvents", {
          category: "deletion",
          action: "user_cascade_delete_failed",
          actorType: job.requestedByUserId ? "admin" : "system",
          actorUserId: job.requestedByUserId,
          target: String(job._id),
          details: safeDetailsJson({
            userId: job.userId,
            stage: job.stage,
            error: message,
          }),
          at: now,
        });

        if (job.requestedByUserId) {
          await ctx.db.insert("auditLogs", {
            actorUserId: job.requestedByUserId,
            action: "delete_user_failed",
            target: String(job.userId),
            at: now,
          });
        }
      } catch {
        // Preserve original deletion failure regardless of audit insert state.
      }

      captureException("deletion.user_job.failed", error, {
        status: "failed",
        jobId: job._id,
        userId: job.userId,
        stage: job.stage,
        processedBatches: job.processedBatches,
        checkpoints: job.checkpoints,
        errorMessage: message,
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

export const ensureUserExists = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized: not signed in");
    }

    const clerkUserId = identity.subject;
    const existing = await ctx.db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();

    if (existing) {
      return {
        created: false,
        blocked: false,
        userId: existing._id,
      };
    }

    const latestDeletionJob = await findLatestUserDeletionJobByClerkUserId(
      ctx,
      clerkUserId,
    );

    if (shouldBlockUserSyncDuringDeletion(latestDeletionJob)) {
      return {
        created: false,
        blocked: true,
        userId: null,
      };
    }

    const user = await createUserFromClerkIdentity(ctx, {
      clerkUserId,
      email: identity.email?.trim() || resolveFallbackClerkEmail(clerkUserId),
      firstName: undefined,
      lastName: undefined,
      imageUrl: identity.pictureUrl ?? undefined,
    });

    return {
      created: true,
      blocked: false,
      userId: user?._id ?? null,
    };
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
  const latestDeletionJob = await findLatestUserDeletionJobByClerkUserId(
    ctx,
    args.clerkUserId,
  );

  if (shouldBlockUserSyncDuringDeletion(latestDeletionJob)) {
    logInfo("user.sync.blocked_during_deletion", {
      clerkUserId: args.clerkUserId,
      jobId: latestDeletionJob?._id ?? null,
      jobStatus: latestDeletionJob?.status ?? null,
    });
    return null;
  }

  const existing = await ctx.db
    .query("user")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
    .unique();

  if (existing) {
    const existingProfileImageSource = (existing as any).profileImageSource as
      | ProfileImageSource
      | undefined;
    const adminRoleBootstrapPatch = buildAdminRoleBootstrapPatch(existing);
    const shouldUpdateImage = shouldUpdateProfileImageFromClerk(
      existingProfileImageSource,
    );

    await ctx.db.patch(existing._id, {
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      imageUrl: shouldUpdateImage ? args.imageUrl : existing.imageUrl,
      profileImageSource:
        shouldUpdateImage && args.imageUrl
          ? "clerk"
          : existingProfileImageSource,
      ...adminRoleBootstrapPatch,
    });

    return await ctx.db.get(existing._id);
  }

  return await createUserFromClerkIdentity(ctx, args);
}

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error(
        "Unauthorized: user record not found — sign in once to create it",
      );
    }

    if (
      user.accountStatus === "deletion_requested" &&
      user.accountBackendPurgedAt === undefined
    ) {
      throw new Error("Unauthorized: account deletion in progress");
    }

    if (typeof user.accountBackendPurgedAt === "number") {
      const userProfileImageStorageId = (user as any).profileImageStorageId as
        | string
        | undefined;
      const manualImageUrl =
        typeof userProfileImageStorageId === "string"
          ? await ctx.storage.getUrl(userProfileImageStorageId as any)
          : null;
      const userProfileImageSource = (user as any).profileImageSource as
        | ProfileImageSource
        | undefined;

      return {
        ...user,
        profileImageUrl: manualImageUrl ?? user.imageUrl ?? null,
        profileImageSource: userProfileImageSource ?? null,
        hasManualProfileImage:
          typeof userProfileImageStorageId === "string" &&
          userProfileImageStorageId.length > 0,
        clerkAccountDeletionFinalizePending: true as const,
      };
    }

    const userProfileImageStorageId = (user as any).profileImageStorageId as
      | string
      | undefined;
    const userProfileImageSource = (user as any).profileImageSource as
      | ProfileImageSource
      | undefined;
    const manualImageUrl =
      typeof userProfileImageStorageId === "string"
        ? await ctx.storage.getUrl(userProfileImageStorageId as any)
        : null;

    return {
      ...user,
      profileImageUrl: manualImageUrl ?? user.imageUrl ?? null,
      profileImageSource: userProfileImageSource ?? null,
      hasManualProfileImage:
        typeof userProfileImageStorageId === "string" &&
        userProfileImageStorageId.length > 0,
    };
  },
});

export const generateProfileImageUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

export const setProfileImageFromUpload = mutation({
  args: {
    storageId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existingProfileImageStorageId = (user as any)
      .profileImageStorageId as string | undefined;
    const metadata = await ctx.storage.getMetadata(args.storageId as any);
    if (!metadata) {
      throw new Error("Uploaded profile image was not found.");
    }

    if (metadata.size > MAX_PROFILE_IMAGE_BYTES) {
      try {
        await ctx.storage.delete(args.storageId as any);
      } catch {
        // Best-effort cleanup for oversized images.
      }
      throw new Error("Profile image must be 5MB or smaller.");
    }

    const contentType = metadata.contentType?.toLowerCase();
    if (
      contentType &&
      !contentType.startsWith(PROFILE_IMAGE_CONTENT_TYPE_PREFIX)
    ) {
      try {
        await ctx.storage.delete(args.storageId as any);
      } catch {
        // Best-effort cleanup for invalid image payloads.
      }
      throw new Error("Invalid profile image type: expected an image upload.");
    }

    if (
      typeof existingProfileImageStorageId === "string" &&
      existingProfileImageStorageId !== args.storageId
    ) {
      try {
        await ctx.storage.delete(existingProfileImageStorageId as any);
      } catch {
        // Existing image may already be missing.
      }
    }

    await ctx.db.patch(user._id, {
      profileImageStorageId: args.storageId,
      profileImageSource: "manual",
    });

    const profileImageUrl = await ctx.storage.getUrl(args.storageId as any);
    return {
      profileImageUrl,
      profileImageSource: "manual" as const,
    };
  },
});

export const setProfileImageFromProvider = mutation({
  args: {
    imageUrl: v.string(),
    source: v.union(
      v.literal("apple"),
      v.literal("google"),
      v.literal("clerk"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existingProfileImageStorageId = (user as any)
      .profileImageStorageId as string | undefined;
    const trimmedImageUrl = args.imageUrl.trim();
    if (!trimmedImageUrl) {
      throw new Error("Provider image URL is required.");
    }

    if (typeof existingProfileImageStorageId === "string") {
      try {
        await ctx.storage.delete(existingProfileImageStorageId as any);
      } catch {
        // Existing manual image may already be deleted.
      }
    }

    await ctx.db.patch(user._id, {
      imageUrl: trimmedImageUrl,
      profileImageSource: args.source,
      profileImageStorageId: undefined,
    });

    return {
      profileImageUrl: trimmedImageUrl,
      profileImageSource: args.source,
    };
  },
});

export const clearManualProfileImage = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const existingProfileImageStorageId = (user as any)
      .profileImageStorageId as string | undefined;
    if (typeof existingProfileImageStorageId === "string") {
      try {
        await ctx.storage.delete(existingProfileImageStorageId as any);
      } catch {
        // Existing manual image may already be deleted.
      }
    }

    await ctx.db.patch(user._id, {
      profileImageStorageId: undefined,
      profileImageSource: user.imageUrl ? "clerk" : undefined,
    });

    return {
      profileImageUrl: user.imageUrl ?? null,
      profileImageSource: user.imageUrl ? "clerk" : null,
    };
  },
});

// ── Check whether the currently signed-in user is an admin
export const isCurrentUserAdmin = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user?.isAdmin === true;
  },
});

export const getCurrentUserAdminCacheState = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return {
      isAdmin: user?.isAdmin === true,
      adminAuthVersion: user?.adminAuthVersion ?? 0,
      adminRoleUpdatedAt: user?.adminRoleUpdatedAt ?? 0,
    };
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
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const page = await ctx.db.query("user").paginate({
      numItems: clampAdminUsersPageLimit(args.limit),
      cursor: args.cursor ?? null,
    });

    return {
      items: page.page,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
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

    const adminRolePatch = buildAdminRoleStatePatch(user, true);
    await ctx.db.patch(user._id, adminRolePatch);
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

    const adminRolePatch = buildAdminRoleStatePatch(targetUser, args.isAdmin);
    await ctx.db.patch(targetUser._id, adminRolePatch);
    return { success: true };
  },
});

export const requestAccountDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const now = Date.now();

    await ctx.db.patch(user._id, {
      accountStatus: "deletion_requested",
      accountDeletionRequestedAt: now,
    });

    const latestJob = await findLatestUserDeletionJobByUserId(ctx, user._id);

    if (latestJob?.status === "completed") {
      logInfo("deletion.user.request.completed_job_reused", {
        status: "succeeded",
        userId: user._id,
        clerkUserId: user.clerkUserId,
        jobId: latestJob._id,
      });

      return {
        success: true,
        requestedAt: now,
        jobId: latestJob._id,
        status: latestJob.status,
        stage: latestJob.stage,
        created: false,
        retried: false,
        canDeleteClerkAccount: true,
      };
    }

    if (
      latestJob?.status === "processing" ||
      latestJob?.status === "requested"
    ) {
      logInfo("deletion.user.request.reused_inflight_job", {
        status: "queued",
        userId: user._id,
        clerkUserId: user.clerkUserId,
        jobId: latestJob._id,
        stage: latestJob.stage,
        jobStatus: latestJob.status,
      });

      return {
        success: true,
        requestedAt: now,
        jobId: latestJob._id,
        status: latestJob.status,
        stage: latestJob.stage,
        created: false,
        retried: false,
        canDeleteClerkAccount: false,
      };
    }

    if (latestJob?.status === "failed") {
      await ctx.db.patch(latestJob._id, {
        status: "processing",
        updatedAt: now,
        failedAt: undefined,
        lastError: undefined,
      });
      await scheduleUserDeletionStep(ctx, latestJob._id);

      logInfo("deletion.user.request.retried_failed_job", {
        status: "queued",
        userId: user._id,
        clerkUserId: user.clerkUserId,
        jobId: latestJob._id,
        stage: latestJob.stage,
      });

      return {
        success: true,
        requestedAt: now,
        jobId: latestJob._id,
        status: "processing" as const,
        stage: latestJob.stage,
        created: false,
        retried: true,
        canDeleteClerkAccount: false,
      };
    }

    const job = await enqueueUserDeletionJob(ctx, {
      userId: user._id,
      clerkUserId: user.clerkUserId,
      requestedByUserId: user._id,
    });

    logInfo("deletion.user.request.enqueued", {
      status: "queued",
      userId: user._id,
      clerkUserId: user.clerkUserId,
      jobId: job.jobId,
      stage: job.stage,
      created: job.created,
    });

    return {
      success: true,
      requestedAt: now,
      jobId: job.jobId,
      status: job.status,
      stage: job.stage,
      created: job.created,
      retried: false,
      canDeleteClerkAccount: false,
    };
  },
});

export const getMyAccountDeletionStatus = query({
  args: {
    pollToken: v.optional(v.number()),
    jobId: v.optional(v.id("userDeletionJobs")),
  },
  handler: async (ctx, args) => {
    void args.pollToken;

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized: not signed in");
    }

    const clerkUserId = identity.subject;

    const [user, requestedJob] = await Promise.all([
      ctx.db
        .query("user")
        .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
        .unique(),
      args.jobId ? ctx.db.get(args.jobId) : Promise.resolve(null),
    ]);

    const scopedRequestedJob =
      requestedJob && requestedJob.clerkUserId === clerkUserId
        ? requestedJob
        : null;

    const latestJob =
      scopedRequestedJob ??
      (await findLatestUserDeletionJobByClerkUserId(ctx, clerkUserId));

    const backendPurgedAwaitingClerk =
      user !== null && typeof user.accountBackendPurgedAt === "number";

    const deletionPipelineActive =
      latestJob?.status === "requested" || latestJob?.status === "processing";

    const deletionFailed = latestJob?.status === "failed";

    const requestedFromLatestJob = deletionPipelineActive || deletionFailed;

    const requested =
      (!backendPurgedAwaitingClerk &&
        user?.accountStatus === "deletion_requested") ||
      requestedFromLatestJob;

    const accountStatusLabel: "active" | "deletion_requested" = (() => {
      if (!user) {
        return "active";
      }
      if (backendPurgedAwaitingClerk) {
        return "active";
      }
      return requested ? "deletion_requested" : "active";
    })();

    return {
      requested,
      requestedAt: user?.accountDeletionRequestedAt ?? latestJob?.startedAt,
      accountStatus: accountStatusLabel,
      userExists: user !== null,
      backendPurgedAwaitingClerk,
      inProgress: deletionPipelineActive,
      retryable: latestJob?.status === "failed",
      canDeleteClerkAccount: latestJob?.status === "completed",
      job: latestJob
        ? {
            id: latestJob._id,
            status: latestJob.status,
            stage: latestJob.stage,
            startedAt: latestJob.startedAt,
            updatedAt: latestJob.updatedAt,
            completedAt: latestJob.completedAt,
            failedAt: latestJob.failedAt,
            lastError: latestJob.lastError,
            checkpoints: latestJob.checkpoints,
            processedBatches: latestJob.processedBatches,
            progress: latestJob.progress,
          }
        : null,
    };
  },
});

// ── Internal mutation for account deletion from Clerk webhook.
//    Idempotent: succeeds even if user already removed.
export const deleteUserAndRelatedDataByClerkId = internalMutation({
  args: {
    clerkUserId: v.string(),
  },
  handler: async (ctx, args) => {
    logInfo("deletion.user.started", {
      status: "started",
      clerkUserId: args.clerkUserId,
    });

    try {
      const user = await ctx.db
        .query("user")
        .withIndex("by_clerkUserId", (q) =>
          q.eq("clerkUserId", args.clerkUserId),
        )
        .unique();

      if (user && typeof user.accountBackendPurgedAt === "number") {
        await ctx.db.delete(user._id);
        logInfo("deletion.user.tombstone_removed_after_clerk_deleted", {
          status: "succeeded",
          clerkUserId: args.clerkUserId,
          userId: user._id,
        });
        return {
          success: true,
          deleted: true,
          queued: false,
          tombstonePurged: true,
        };
      }

      if (!user) {
        const existingJob = await findActiveUserDeletionJobByClerkId(
          ctx,
          args.clerkUserId,
        );
        if (existingJob) {
          logInfo("deletion.user.enqueued", {
            status: "queued",
            clerkUserId: args.clerkUserId,
            jobId: existingJob.jobId,
            stage: existingJob.stage,
            created: false,
          });

          return {
            success: true,
            deleted: true,
            jobId: existingJob.jobId,
            status: existingJob.status,
            stage: existingJob.stage,
            queued: true,
          };
        }

        logInfo("deletion.user.skipped_missing_user", {
          status: "skipped",
          clerkUserId: args.clerkUserId,
        });

        return { success: true, deleted: false, queued: false };
      }

      const job = await enqueueUserDeletionJob(ctx, {
        userId: user._id,
        clerkUserId: user.clerkUserId,
      });

      logInfo("deletion.user.enqueued", {
        status: "queued",
        userId: user._id,
        clerkUserId: user.clerkUserId,
        jobId: job.jobId,
        stage: job.stage,
        created: job.created,
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
    } catch (error) {
      captureException("deletion.user.failed", error, {
        status: "failed",
        clerkUserId: args.clerkUserId,
      });
      throw error;
    }
  },
});
