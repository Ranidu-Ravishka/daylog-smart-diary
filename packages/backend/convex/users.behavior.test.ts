import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";

const ADMIN_USER_ID = "user_admin_001" as Id<"user">;
const MEMBER_USER_ID = "user_member_001" as Id<"user">;

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

let usersModule: typeof import("./users");

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

function baseSeed() {
  return {
    user: [
      {
        _id: ADMIN_USER_ID,
        _creationTime: 1,
        clerkUserId: "clerk_admin_001",
        email: "admin@example.com",
        isAdmin: true,
      },
      {
        _id: MEMBER_USER_ID,
        _creationTime: 2,
        clerkUserId: "clerk_member_001",
        email: "member@example.com",
        isAdmin: false,
      },
    ],
  };
}

beforeAll(async () => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.daylog.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_valid_key_1234567890";
  process.env.OPENAI_API_KEY ??= "sk-test-valid-key-1234567890";
  process.env.ADMIN_BOOTSTRAP_CLERK_USER_IDS ??= "clerk_member_001";

  usersModule = await import("./users");
});

describe("users behavior", () => {
  it("syncs Clerk users and updates existing rows", async () => {
    const db = createInMemoryDb({
      ...baseSeed(),
      user: [baseSeed().user[0]],
    });

    const syncUserFromClerk = handler<
      {
        clerkUserId: string;
        email: string;
        firstName?: string;
        lastName?: string;
        imageUrl?: string;
      },
      { _id: Id<"user">; email: string; firstName?: string } | null
    >(usersModule.syncUserFromClerk);

    const memberCtx = createAuthCtx(db, "clerk_member_001");

    const created = await syncUserFromClerk(memberCtx, {
      clerkUserId: "clerk_member_001",
      email: "member@example.com",
      firstName: "Member",
      lastName: "One",
    });

    expect(created?.email).toBe("member@example.com");

    const metrics = db.getTable("adminDashboardMetrics");
    expect(metrics[0]?.totalUsers).toBe(1);

    const updated = await syncUserFromClerk(memberCtx, {
      clerkUserId: "clerk_member_001",
      email: "member+updated@example.com",
      firstName: "Updated",
    });

    expect(updated?.email).toBe("member+updated@example.com");
    expect(updated?.firstName).toBe("Updated");
    expect(db.getTable("user")).toHaveLength(2);
  });

  it("creates a missing user record during bootstrap", async () => {
    const db = createInMemoryDb({
      user: [baseSeed().user[0]],
    });

    const ensureUserExists = handler<
      Record<string, never>,
      { created: boolean; blocked: boolean; userId: Id<"user"> | null }
    >(usersModule.ensureUserExists);

    const result = await ensureUserExists(
      createAuthCtx(db, "clerk_new_user_001"),
      {},
    );

    expect(result.created).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.userId).toBeTruthy();

    const createdUser = db
      .getTable("user")
      .find((user) => user.clerkUserId === "clerk_new_user_001");

    expect(createdUser?.email).toBe("clerk_new_user_001@daylog.invalid");
    expect(createdUser?.isAdmin).toBe(false);
    expect(db.getTable("adminDashboardMetrics")[0]?.totalUsers).toBe(1);
  });

  it("updates profile image via manual upload and provider fallback", async () => {
    const db = createInMemoryDb(baseSeed());
    const generateProfileImageUploadUrl = handler<
      Record<string, never>,
      { uploadUrl: string }
    >(usersModule.generateProfileImageUploadUrl);
    const setProfileImageFromUpload = handler<
      { storageId: string },
      { profileImageUrl: string | null; profileImageSource: "manual" }
    >(usersModule.setProfileImageFromUpload);
    const setProfileImageFromProvider = handler<
      { imageUrl: string; source: "apple" | "google" | "clerk" },
      {
        profileImageUrl: string;
        profileImageSource: "apple" | "google" | "clerk";
      }
    >(usersModule.setProfileImageFromProvider);
    const getMyProfile = handler<
      Record<string, never>,
      {
        profileImageUrl: string | null;
        profileImageSource: "apple" | "google" | "clerk" | "manual" | null;
      }
    >(usersModule.getMyProfile);

    const storage = {
      generateUploadUrl: vi.fn(async () => "https://upload.test/url"),
      getMetadata: vi.fn(async () => ({
        size: 128 * 1024,
        contentType: "image/jpeg",
      })),
      getUrl: vi.fn(
        async (storageId: string) => `https://cdn.test/${storageId}`,
      ),
      delete: vi.fn(async () => undefined),
    };

    const ctx = {
      ...createAuthCtx(db, "clerk_member_001"),
      storage,
    };

    const upload = await generateProfileImageUploadUrl(ctx, {});
    expect(upload.uploadUrl).toContain("upload.test");

    const manual = await setProfileImageFromUpload(ctx, {
      storageId: "storage_profile_001",
    });
    expect(manual.profileImageSource).toBe("manual");
    expect(manual.profileImageUrl).toContain("storage_profile_001");

    const provider = await setProfileImageFromProvider(ctx, {
      source: "google",
      imageUrl: "https://images.example.com/google.png",
    });
    expect(provider.profileImageSource).toBe("google");

    const profile = await getMyProfile(ctx, {});
    expect(profile.profileImageSource).toBe("google");
    expect(profile.profileImageUrl).toBe(
      "https://images.example.com/google.png",
    );
  });

  it("enforces identity checks and admin boundaries", async () => {
    const db = createInMemoryDb(baseSeed());

    const syncUserFromClerk = handler<
      { clerkUserId: string; email: string },
      unknown
    >(usersModule.syncUserFromClerk);
    const getUserByClerkId = handler<{ clerkUserId: string }, unknown>(
      usersModule.getUserByClerkId,
    );
    const listUsers = handler<
      { limit?: number; cursor?: string },
      { items: unknown[]; nextCursor: string | null }
    >(usersModule.listUsers);

    await expect(
      syncUserFromClerk(createAuthCtx(db, "clerk_member_001"), {
        clerkUserId: "clerk_admin_001",
        email: "x@example.com",
      }),
    ).rejects.toThrow("Forbidden: identity mismatch");

    await expect(
      getUserByClerkId(createAuthCtx(db, "clerk_member_001"), {
        clerkUserId: "clerk_admin_001",
      }),
    ).rejects.toThrow("Forbidden");

    await expect(
      listUsers(createAuthCtx(db, "clerk_member_001"), {}),
    ).rejects.toThrow("Forbidden");

    const adminUsers = await listUsers(createAuthCtx(db, "clerk_admin_001"), {
      limit: 10,
    });
    expect(adminUsers.items).toHaveLength(2);
    expect(adminUsers.nextCursor).toBeNull();

    const firstPage = await listUsers(createAuthCtx(db, "clerk_admin_001"), {
      limit: 1,
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
  });

  it("supports bootstrap admin and admin status updates", async () => {
    const db = createInMemoryDb(baseSeed());

    const bootstrapMakeMeAdmin = handler<
      Record<string, never>,
      { success: boolean }
    >(usersModule.bootstrapMakeMeAdmin);
    const setUserAdminStatus = handler<
      { clerkUserId: string; isAdmin: boolean },
      { success: boolean }
    >(usersModule.setUserAdminStatus);
    const getCurrentUserAdminCacheState = handler<
      Record<string, never>,
      {
        isAdmin: boolean;
        adminAuthVersion: number;
        adminRoleUpdatedAt: number;
      }
    >(usersModule.getCurrentUserAdminCacheState);

    const initialState = await getCurrentUserAdminCacheState(
      createAuthCtx(db, "clerk_member_001"),
      {},
    );
    expect(initialState.isAdmin).toBe(false);
    expect(initialState.adminAuthVersion).toBe(0);
    expect(initialState.adminRoleUpdatedAt).toBe(0);

    await expect(
      setUserAdminStatus(createAuthCtx(db, "clerk_member_001"), {
        clerkUserId: "clerk_admin_001",
        isAdmin: false,
      }),
    ).rejects.toThrow("Forbidden");

    const bootstrapResult = await bootstrapMakeMeAdmin(
      createAuthCtx(db, "clerk_member_001"),
      {},
    );
    expect(bootstrapResult.success).toBe(true);

    const promoted = await db
      .query("user")
      .withIndex("by_clerkUserId", (q) =>
        q.eq("clerkUserId", "clerk_member_001"),
      )
      .unique();
    expect(promoted?.isAdmin).toBe(true);
    expect(promoted?.adminAuthVersion).toBe(1);
    expect(promoted?.adminRoleUpdatedAt).toBeGreaterThan(0);

    const result = await setUserAdminStatus(
      createAuthCtx(db, "clerk_admin_001"),
      {
        clerkUserId: "clerk_member_001",
        isAdmin: false,
      },
    );

    expect(result.success).toBe(true);

    const demoted = await db
      .query("user")
      .withIndex("by_clerkUserId", (q) =>
        q.eq("clerkUserId", "clerk_member_001"),
      )
      .unique();
    expect(demoted?.isAdmin).toBe(false);
    expect(demoted?.adminAuthVersion).toBe(2);
    expect(demoted?.adminRoleUpdatedAt).toBeGreaterThan(0);

    const finalState = await getCurrentUserAdminCacheState(
      createAuthCtx(db, "clerk_member_001"),
      {},
    );
    expect(finalState.isAdmin).toBe(false);
    expect(finalState.adminAuthVersion).toBe(2);
    expect(finalState.adminRoleUpdatedAt).toBeGreaterThan(0);
  });

  it("deletes user cascade data by Clerk id and remains idempotent", async () => {
    const targetUserId = "user_target_001" as Id<"user">;
    const targetMemoryId = "memory_target_001" as Id<"memories">;
    const targetSummaryEventId =
      "summary_event_target_001" as Id<"summaryGenerationEvents">;

    const db = createInMemoryDb({
      ...baseSeed(),
      user: [
        ...baseSeed().user,
        {
          _id: targetUserId,
          _creationTime: 3,
          clerkUserId: "clerk_target_001",
          email: "target@example.com",
          isAdmin: false,
        },
      ],
      memories: [
        {
          _id: targetMemoryId,
          _creationTime: 4,
          userId: targetUserId,
          title: "Memory",
          happenedAt: 1,
          dayKey: "2026-04-01",
        },
      ],
      memoryMedia: [
        {
          _id: "media_target_001",
          _creationTime: 5,
          memoryId: targetMemoryId,
          userId: targetUserId,
          storageId: "storage_target_001",
          type: "image",
        },
      ],
      days: [
        {
          _id: "day_target_001",
          _creationTime: 6,
          userId: targetUserId,
          dayKey: "2026-04-01",
          rating: 4,
        },
      ],
      daySummaries: [
        {
          _id: "summary_target_001",
          _creationTime: 7,
          userId: targetUserId,
          dayKey: "2026-04-01",
          story: "Story",
          highlights: [],
          sourcesUsed: [],
          generatedAt: 1,
        },
      ],
      integrations: [
        {
          _id: "integration_target_001",
          _creationTime: 8,
          userId: targetUserId,
          provider: "spotify",
          status: "connected",
        },
      ],
      integrationDailyData: [
        {
          _id: "dailydata_target_001",
          _creationTime: 9,
          userId: targetUserId,
          provider: "spotify",
          dayKey: "2026-04-01",
          syncedAt: 1,
        },
      ],
      integrationSecrets: [
        {
          _id: "secret_target_001",
          _creationTime: 10,
          userId: targetUserId,
          provider: "spotify",
          tokenRef: "tokref_target_001",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      integrationSyncRuns: [
        {
          _id: "sync_target_001",
          _creationTime: 11,
          userId: targetUserId,
          provider: "spotify",
          dayKey: "2026-04-01",
          status: "success",
          startedAt: 1,
          updatedAt: 1,
        },
      ],
      userPreferences: [
        {
          _id: "pref_target_001",
          _creationTime: 12,
          clerkUserId: "clerk_target_001",
          focusAreas: [0],
          reminderType: "daily",
          dailyTime: "09:00",
          weeklyDay: "monday",
          formattedTime: "9:00 AM",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      auditLogs: [
        {
          _id: "audit_target_001",
          _creationTime: 13,
          actorUserId: targetUserId,
          action: "test",
          at: 1,
        },
      ],
      summaryGenerationQuotas: [
        {
          _id: "quota_target_001",
          _creationTime: 14,
          userId: targetUserId,
          quotaDayKey: "2026-04-01",
          used: 1,
          updatedAt: 1,
        },
      ],
      exportJobs: [
        {
          _id: "export_target_001",
          _creationTime: 15,
          userId: targetUserId,
          status: "ready",
          format: "json",
          includeLocationSignals: false,
          requestedAt: 1,
          updatedAt: 1,
          expiresAt: 1,
          artifactStorageId: "export_storage_target_001",
        },
      ],
      restoreJobs: [
        {
          _id: "restore_target_001",
          _creationTime: 16,
          userId: targetUserId,
          status: "failed",
          requestedAt: 1,
          updatedAt: 1,
          conflictMode: "skip",
          allowPartial: false,
          selectedDatasets: ["memories"],
        },
      ],
      summaryGenerationEvents: [
        {
          _id: targetSummaryEventId,
          _creationTime: 17,
          userId: targetUserId,
          dayKey: "2026-04-01",
          createdAt: 1,
          success: true,
          modelProvider: "openai",
          modelName: "gpt-5",
          modelInput: "input",
        },
      ],
      summaryQualityEvaluations: [
        {
          _id: "quality_target_001",
          _creationTime: 18,
          userId: targetUserId,
          dayKey: "2026-04-01",
          generationEventId: targetSummaryEventId,
          lowQuality: false,
          evaluatedAt: 1,
          scores: {
            overall: 0.9,
            length: 0.9,
            coherence: 0.9,
            duplication: 0,
            failure: 0,
          },
          wordCount: 100,
          duplicateLineRatio: 0,
          flags: [],
        },
      ],
      integrationHealthEvents: [
        {
          _id: "health_target_001",
          _creationTime: 19,
          provider: "spotify",
          userId: targetUserId,
          outcome: "error",
          status: "degraded",
          tokenValidityStatus: "unknown",
          at: 1,
        },
      ],
      platformAuditEvents: [
        {
          _id: "platform_audit_target_001",
          _creationTime: 20,
          category: "retention",
          action: "target",
          actorType: "user",
          actorUserId: targetUserId,
          at: 1,
        },
      ],
    });

    const storageDelete = vi.fn(async () => undefined);
    const schedulerRunAfter = vi.fn(async () => undefined);
    const deleteUserAndRelatedDataByClerkId = handler<
      { clerkUserId: string },
      {
        success: boolean;
        deleted: boolean;
        queued?: boolean;
        jobId?: Id<"userDeletionJobs">;
      }
    >(usersModule.deleteUserAndRelatedDataByClerkId);
    const runUserDeletionCascadeJobStepInternal = handler<
      { jobId: Id<"userDeletionJobs">; batchSize?: number },
      { success: boolean; done: boolean; status?: string }
    >(usersModule.runUserDeletionCascadeJobStepInternal);
    const getUserDeletionJobByIdInternal = handler<
      { jobId: Id<"userDeletionJobs"> },
      { status: string; checkpoints: number; processedBatches: number } | null
    >(usersModule.getUserDeletionJobByIdInternal);

    const ctx = {
      ...createAuthCtx(db, "clerk_admin_001"),
      storage: {
        delete: storageDelete,
      },
      scheduler: {
        runAfter: schedulerRunAfter,
      },
    };

    const first = await deleteUserAndRelatedDataByClerkId(ctx, {
      clerkUserId: "clerk_target_001",
    });

    expect(first.success).toBe(true);
    expect(first.deleted).toBe(true);
    expect(first.queued).toBe(true);
    expect(first.jobId).toBeDefined();
    expect(schedulerRunAfter).toHaveBeenCalledTimes(1);

    const jobId = first.jobId as Id<"userDeletionJobs">;
    const beforeSteps = await getUserDeletionJobByIdInternal(ctx, {
      jobId,
    });
    expect(beforeSteps?.status).toBe("requested");
    expect(beforeSteps?.checkpoints).toBe(0);

    let completed = false;
    let sawProcessing = false;
    let guard = 0;
    while (!completed) {
      guard += 1;
      if (guard > 200) {
        throw new Error("Timed out waiting for user deletion job completion");
      }

      const step = await runUserDeletionCascadeJobStepInternal(ctx, {
        jobId,
        batchSize: 1,
      });

      expect(step.success).toBe(true);
      if (step.status === "processing") {
        sawProcessing = true;
      }
      completed = step.done;
    }

    expect(sawProcessing).toBe(true);

    const afterSteps = await getUserDeletionJobByIdInternal(ctx, {
      jobId,
    });
    expect(afterSteps?.status).toBe("completed");
    expect(afterSteps?.checkpoints).toBeGreaterThan(0);
    expect(afterSteps?.processedBatches).toBe(afterSteps?.checkpoints);

    // Deletes both the memory media artifact and export artifact storage object.
    expect(storageDelete).toHaveBeenCalledTimes(2);
    expect(db.getTable("user").map((row) => row._id)).not.toContain(
      targetUserId,
    );
    expect(db.getTable("memories")).toHaveLength(0);
    expect(db.getTable("days")).toHaveLength(0);
    expect(db.getTable("daySummaries")).toHaveLength(0);
    expect(db.getTable("integrations")).toHaveLength(0);
    expect(db.getTable("integrationDailyData")).toHaveLength(0);
    expect(db.getTable("integrationSecrets")).toHaveLength(0);
    expect(db.getTable("integrationSyncRuns")).toHaveLength(0);
    expect(db.getTable("exportJobs")).toHaveLength(0);
    expect(db.getTable("restoreJobs")).toHaveLength(0);
    expect(db.getTable("summaryGenerationEvents")).toHaveLength(0);
    expect(db.getTable("summaryQualityEvaluations")).toHaveLength(0);
    expect(db.getTable("integrationHealthEvents")).toHaveLength(0);
    expect(db.getTable("userPreferences")).toHaveLength(0);
    expect(db.getTable("auditLogs")).toHaveLength(0);
    expect(db.getTable("summaryGenerationQuotas")).toHaveLength(0);
    expect(
      db
        .getTable("platformAuditEvents")
        .every((row) => row.actorUserId !== targetUserId),
    ).toBe(true);

    const replay = await runUserDeletionCascadeJobStepInternal(ctx, {
      jobId,
      batchSize: 1,
    });
    expect(replay.success).toBe(true);
    expect(replay.done).toBe(true);
    expect(replay.status).toBe("completed");

    const second = await deleteUserAndRelatedDataByClerkId(ctx, {
      clerkUserId: "clerk_target_001",
    });

    expect(second).toEqual({ success: true, deleted: false, queued: false });
  });

  it("requests account deletion via backend job and exposes polling status", async () => {
    const schedulerRunAfter = vi.fn(async () => undefined);
    const db = createInMemoryDb(baseSeed());

    const requestAccountDeletion = handler<
      Record<string, never>,
      {
        success: boolean;
        jobId: Id<"userDeletionJobs">;
        created: boolean;
        retried: boolean;
        canDeleteClerkAccount: boolean;
      }
    >(usersModule.requestAccountDeletion);
    const getMyAccountDeletionStatus = handler<
      { pollToken?: number; jobId?: Id<"userDeletionJobs"> },
      {
        requested: boolean;
        inProgress: boolean;
        retryable: boolean;
        canDeleteClerkAccount: boolean;
        job: {
          id: Id<"userDeletionJobs">;
          status: "requested" | "processing" | "completed" | "failed";
        } | null;
      }
    >(usersModule.getMyAccountDeletionStatus);

    const ctx = {
      ...createAuthCtx(db, "clerk_member_001"),
      scheduler: {
        runAfter: schedulerRunAfter,
      },
    };

    const response = await requestAccountDeletion(ctx, {});
    expect(response.success).toBe(true);
    expect(response.created).toBe(true);
    expect(response.retried).toBe(false);
    expect(response.canDeleteClerkAccount).toBe(false);
    expect(schedulerRunAfter).toHaveBeenCalledTimes(1);

    const member = await db
      .query("user")
      .withIndex("by_clerkUserId", (q) =>
        q.eq("clerkUserId", "clerk_member_001"),
      )
      .unique();
    expect(member?.accountStatus).toBe("deletion_requested");
    expect(typeof member?.accountDeletionRequestedAt).toBe("number");

    const status = await getMyAccountDeletionStatus(
      createAuthCtx(db, "clerk_member_001"),
      {
        pollToken: 1,
        jobId: response.jobId,
      },
    );
    expect(status.requested).toBe(true);
    expect(status.inProgress).toBe(true);
    expect(status.retryable).toBe(false);
    expect(status.canDeleteClerkAccount).toBe(false);
    expect(status.job?.id).toBe(response.jobId);
    expect(status.job?.status).toBe("requested");
  });

  it("does not treat a completed deletion job as an active deletion request when the user row is gone", async () => {
    const completedJobId = "deletion_job_idle_001" as Id<"userDeletionJobs">;
    const db = createInMemoryDb({
      ...baseSeed(),
      user: baseSeed().user.filter((row) => row._id !== MEMBER_USER_ID),
      userDeletionJobs: [
        {
          _id: completedJobId,
          _creationTime: 900,
          userId: MEMBER_USER_ID,
          clerkUserId: "clerk_member_001",
          status: "completed",
          stage: "summaryGenerationQuotas",
          processedBatches: 5,
          checkpoints: 5,
          progress: {
            deletedMemories: 1,
            deletedSummaries: 1,
            deletedDays: 1,
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
            deletedSummaryGenerationEvents: 0,
            deletedSummaryQualityEvaluations: 0,
            deletedSummaryGenerationQuotas: 0,
          },
          startedAt: 1,
          updatedAt: 10,
          completedAt: 10,
          userDeletedAt: 10,
        },
      ],
    });

    const getMyAccountDeletionStatus = handler<
      { pollToken?: number; jobId?: Id<"userDeletionJobs"> },
      {
        requested: boolean;
        inProgress: boolean;
        userExists: boolean;
        accountStatus: string;
      }
    >(usersModule.getMyAccountDeletionStatus);

    const ctx = createAuthCtx(db, "clerk_member_001");
    const status = await getMyAccountDeletionStatus(ctx, { pollToken: 1 });

    expect(status.requested).toBe(false);
    expect(status.inProgress).toBe(false);
    expect(status.userExists).toBe(false);
    expect(status.accountStatus).toBe("active");
  });

  it("retries failed account deletion jobs on request", async () => {
    const schedulerRunAfter = vi.fn(async () => undefined);
    const failedUserId = "user_retry_target_001" as Id<"user">;
    const failedJobId = "deletion_job_retry_001" as Id<"userDeletionJobs">;

    const db = createInMemoryDb({
      ...baseSeed(),
      user: [
        ...baseSeed().user,
        {
          _id: failedUserId,
          _creationTime: 100,
          clerkUserId: "clerk_retry_target_001",
          email: "retry-target@example.com",
          isAdmin: false,
        },
      ],
      userDeletionJobs: [
        {
          _id: failedJobId,
          _creationTime: 101,
          userId: failedUserId,
          clerkUserId: "clerk_retry_target_001",
          status: "failed",
          stage: "memories",
          processedBatches: 2,
          checkpoints: 2,
          progress: {
            deletedMemories: 10,
            deletedSummaries: 3,
            deletedDays: 2,
            deletedIntegrations: 1,
            deletedPreferences: 1,
            deletedAuditLogs: 1,
            deletedPlatformAuditEvents: 1,
            deletedMemoryMedia: 4,
            deletedIntegrationDailyData: 1,
            deletedIntegrationSecrets: 1,
            deletedIntegrationSyncRuns: 1,
            deletedIntegrationHealthEvents: 1,
            deletedExportJobs: 1,
            deletedRestoreJobs: 1,
            deletedSummaryGenerationEvents: 1,
            deletedSummaryQualityEvaluations: 1,
            deletedSummaryGenerationQuotas: 1,
          },
          startedAt: 1,
          updatedAt: 2,
          failedAt: 2,
          lastError: "boom",
        },
      ],
    });

    const requestAccountDeletion = handler<
      Record<string, never>,
      { success: boolean; retried: boolean; status: string }
    >(usersModule.requestAccountDeletion);

    const ctx = {
      ...createAuthCtx(db, "clerk_retry_target_001"),
      scheduler: {
        runAfter: schedulerRunAfter,
      },
    };

    const response = await requestAccountDeletion(ctx, {});
    expect(response.success).toBe(true);
    expect(response.retried).toBe(true);
    expect(response.status).toBe("processing");
    expect(schedulerRunAfter).toHaveBeenCalledTimes(1);

    const retriedJob = await db.get(failedJobId);
    expect(retriedJob?.status).toBe("processing");
    expect(retriedJob?.failedAt).toBeUndefined();
    expect(retriedJob?.lastError).toBeUndefined();
  });

  it("blocks Clerk sync from recreating users after deletion completion", async () => {
    const deletedUserId = "user_deleted_target_001" as Id<"user">;
    const completedJobId =
      "deletion_job_completed_001" as Id<"userDeletionJobs">;

    const db = createInMemoryDb({
      ...baseSeed(),
      userDeletionJobs: [
        {
          _id: completedJobId,
          _creationTime: 50,
          userId: deletedUserId,
          clerkUserId: "clerk_deleted_target_001",
          status: "completed",
          stage: "summaryGenerationQuotas",
          processedBatches: 3,
          checkpoints: 3,
          progress: {
            deletedMemories: 1,
            deletedSummaries: 1,
            deletedDays: 1,
            deletedIntegrations: 1,
            deletedPreferences: 1,
            deletedAuditLogs: 1,
            deletedPlatformAuditEvents: 1,
            deletedMemoryMedia: 1,
            deletedIntegrationDailyData: 1,
            deletedIntegrationSecrets: 1,
            deletedIntegrationSyncRuns: 1,
            deletedIntegrationHealthEvents: 1,
            deletedExportJobs: 1,
            deletedRestoreJobs: 1,
            deletedSummaryGenerationEvents: 1,
            deletedSummaryQualityEvaluations: 1,
            deletedSummaryGenerationQuotas: 1,
          },
          startedAt: 1,
          updatedAt: 3,
          completedAt: 3,
          userDeletedAt: 3,
        },
      ],
    });

    const syncUserFromClerk = handler<
      {
        clerkUserId: string;
        email: string;
        firstName?: string;
        lastName?: string;
      },
      unknown
    >(usersModule.syncUserFromClerk);

    await expect(
      syncUserFromClerk(createAuthCtx(db, "clerk_deleted_target_001"), {
        clerkUserId: "clerk_deleted_target_001",
        email: "deleted-target@example.com",
      }),
    ).resolves.toBeNull();
  });

  it("marks deletion jobs as failed when a step throws", async () => {
    const targetUserId = "user_fail_target_001" as Id<"user">;
    const targetJobId = "deletion_job_fail_001" as Id<"userDeletionJobs">;

    const db = createInMemoryDb({
      ...baseSeed(),
      user: [
        ...baseSeed().user,
        {
          _id: targetUserId,
          _creationTime: 100,
          clerkUserId: "clerk_fail_target_001",
          email: "fail-target@example.com",
          isAdmin: false,
        },
      ],
      userDeletionJobs: [
        {
          _id: targetJobId,
          _creationTime: 101,
          userId: targetUserId,
          clerkUserId: "clerk_fail_target_001",
          status: "requested",
          stage: "unsupported_stage",
          processedBatches: 0,
          checkpoints: 0,
          progress: {
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
            deletedSummaryGenerationEvents: 0,
            deletedSummaryQualityEvaluations: 0,
            deletedSummaryGenerationQuotas: 0,
          },
          startedAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const runUserDeletionCascadeJobStepInternal = handler<
      { jobId: Id<"userDeletionJobs">; batchSize?: number },
      {
        success: boolean;
        done: boolean;
        status?: string;
        reason?: string;
        error?: string;
      }
    >(usersModule.runUserDeletionCascadeJobStepInternal);
    const getUserDeletionJobByIdInternal = handler<
      { jobId: Id<"userDeletionJobs"> },
      { status: string; lastError?: string; failedAt?: number } | null
    >(usersModule.getUserDeletionJobByIdInternal);

    const ctx = createAuthCtx(db, "clerk_admin_001");

    const firstStep = await runUserDeletionCascadeJobStepInternal(ctx, {
      jobId: targetJobId,
      batchSize: 1,
    });

    expect(firstStep.success).toBe(false);
    expect(firstStep.done).toBe(true);
    expect(firstStep.status).toBe("failed");
    expect(firstStep.reason).toBe("job_failed");
    expect(firstStep.error).toContain("Unsupported user deletion stage");

    const failedJob = await getUserDeletionJobByIdInternal(ctx, {
      jobId: targetJobId,
    });
    expect(failedJob?.status).toBe("failed");
    expect(failedJob?.lastError).toContain("Unsupported user deletion stage");
    expect(typeof failedJob?.failedAt).toBe("number");

    const replay = await runUserDeletionCascadeJobStepInternal(ctx, {
      jobId: targetJobId,
      batchSize: 1,
    });
    expect(replay.success).toBe(false);
    expect(replay.done).toBe(true);
    expect(replay.status).toBe("failed");
  });
});
