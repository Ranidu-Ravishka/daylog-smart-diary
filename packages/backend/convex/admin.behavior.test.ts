import { describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as adminModule from "./admin";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const ADMIN_ID = "user_admin_001" as Id<"user">;
const MEMBER_ID = "user_member_001" as Id<"user">;

function seededDb() {
  return createInMemoryDb({
    user: [
      {
        _id: ADMIN_ID,
        _creationTime: 1,
        clerkUserId: "clerk_admin_001",
        email: "admin@example.com",
        isAdmin: true,
      },
      {
        _id: MEMBER_ID,
        _creationTime: 2,
        clerkUserId: "clerk_member_001",
        email: "member@example.com",
        isAdmin: false,
      },
    ],
  });
}

function adminCtx(db: ReturnType<typeof createInMemoryDb>) {
  return {
    ...createAuthCtx(db, "clerk_admin_001"),
    storage: {
      delete: vi.fn(async () => undefined),
    },
    runMutation: vi.fn(async () => "tokref_generated_001"),
  };
}

describe("admin behavior", () => {
  it("enforces admin-only access", async () => {
    const db = seededDb();

    const listAllUsers = handler<Record<string, never>, unknown[]>(
      adminModule.listAllUsers,
    );

    await expect(
      listAllUsers(createAuthCtx(db, "clerk_member_001"), {}),
    ).rejects.toThrow("Forbidden");
  });

  it("rejects plaintext tokenRef writes for integrations", async () => {
    const db = seededDb();
    const ctx = adminCtx(db);

    const adminCreateIntegration = handler<
      {
        userId: Id<"user">;
        provider: string;
        status: "connected" | "disconnected" | "error";
        tokenRef?: string;
      },
      { _id: Id<"integrations">; tokenRef?: string } | null
    >(adminModule.adminCreateIntegration);

    const adminUpdateIntegration = handler<
      {
        integrationId: Id<"integrations">;
        tokenRef?: string;
      },
      { _id: Id<"integrations">; tokenRef?: string } | null
    >(adminModule.adminUpdateIntegration);

    await expect(
      adminCreateIntegration(ctx, {
        userId: MEMBER_ID,
        provider: "spotify",
        status: "connected",
        tokenRef: "legacy_plaintext_token_001",
      }),
    ).rejects.toThrow("opaque tokenRef");

    const created = await adminCreateIntegration(ctx, {
      userId: MEMBER_ID,
      provider: "spotify",
      status: "connected",
      tokenRef: "tokref_admin_secure_001",
    });

    await expect(
      adminUpdateIntegration(ctx, {
        integrationId: created!._id,
        tokenRef: "legacy_plaintext_token_002",
      }),
    ).rejects.toThrow("opaque tokenRef");
  });

  it("covers core admin CRUD and pagination flows", async () => {
    const db = seededDb();
    const ctx = adminCtx(db);

    const getDashboardMetrics = handler<
      Record<string, never>,
      { totalUsers: number }
    >(adminModule.getDashboardMetrics);
    const adminRebuildDashboardMetrics = handler<
      Record<string, never>,
      { totalUsers: number }
    >(adminModule.adminRebuildDashboardMetrics);

    const adminCreateUser = handler<
      {
        clerkUserId: string;
        email: string;
        firstName?: string;
        lastName?: string;
        isAdmin?: boolean;
      },
      { _id: Id<"user">; email: string } | null
    >(adminModule.adminCreateUser);
    const listAllUsers = handler<
      Record<string, never>,
      Array<{ _id: Id<"user"> }>
    >(adminModule.listAllUsers);
    const listUsersPaginated = handler<
      { paginationOpts: { numItems: number; cursor: string | null } },
      { page: Array<{ _id: Id<"user"> }> }
    >(adminModule.listUsersPaginated);
    const adminGetUser = handler<{ userId: Id<"user"> }, { _id: Id<"user"> }>(
      adminModule.adminGetUser,
    );
    const adminUpdateUser = handler<
      {
        userId: Id<"user">;
        email?: string;
        firstName?: string;
        lastName?: string;
        isAdmin?: boolean;
      },
      { email: string } | null
    >(adminModule.adminUpdateUser);
    const adminDeleteUser = handler<
      { userId: Id<"user"> },
      { success: boolean }
    >(adminModule.adminDeleteUser);

    const dashboardBefore = await getDashboardMetrics(ctx, {});
    expect(dashboardBefore.totalUsers).toBe(0);

    const createdUser = await adminCreateUser(ctx, {
      clerkUserId: "clerk_new_001",
      email: "new@example.com",
      firstName: "New",
      isAdmin: false,
    });
    const createdUserId = createdUser?._id as Id<"user">;

    const createdUserRow = await db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", "clerk_new_001"))
      .unique();
    expect(createdUserRow?.adminAuthVersion).toBe(0);
    expect(createdUserRow?.adminRoleUpdatedAt).toBeGreaterThan(0);

    const allUsers = await listAllUsers(ctx, {});
    expect(allUsers.map((user) => user._id)).toContain(createdUserId);

    const usersPage = await listUsersPaginated(ctx, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(usersPage.page.length).toBeGreaterThanOrEqual(1);

    const gotUser = await adminGetUser(ctx, { userId: createdUserId });
    expect(gotUser._id).toBe(createdUserId);

    const updatedUser = await adminUpdateUser(ctx, {
      userId: createdUserId,
      email: "updated@example.com",
      isAdmin: true,
    });
    expect(updatedUser?.email).toBe("updated@example.com");

    const updatedUserRow = await db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", "clerk_new_001"))
      .unique();
    expect(updatedUserRow?.adminAuthVersion).toBe(1);
    expect(updatedUserRow?.adminRoleUpdatedAt).toBeGreaterThan(0);

    const adminCreateUserPreference = handler<
      {
        clerkUserId: string;
        focusAreas: number[];
        reminderType: "daily" | "weekly";
        dailyTime: string;
        weeklyDay: string;
        formattedTime: string;
      },
      { _id: Id<"userPreferences"> } | null
    >(adminModule.adminCreateUserPreference);
    const listAllUserPreferences = handler<
      Record<string, never>,
      Array<{ _id: Id<"userPreferences"> }>
    >(adminModule.listAllUserPreferences);
    const listUserPreferencesPaginated = handler<
      {
        paginationOpts: { numItems: number; cursor: string | null };
        clerkUserId?: string;
      },
      { page: Array<{ _id: Id<"userPreferences"> }> }
    >(adminModule.listUserPreferencesPaginated);
    const adminGetUserPreference = handler<
      { preferenceId: Id<"userPreferences"> },
      { _id: Id<"userPreferences"> }
    >(adminModule.adminGetUserPreference);
    const adminUpdateUserPreference = handler<
      {
        preferenceId: Id<"userPreferences">;
        focusAreas?: number[];
        reminderType?: "daily" | "weekly";
        dailyTime?: string;
        weeklyDay?: string;
        formattedTime?: string;
      },
      { _id: Id<"userPreferences"> } | null
    >(adminModule.adminUpdateUserPreference);
    const adminDeleteUserPreference = handler<
      { preferenceId: Id<"userPreferences"> },
      { success: boolean }
    >(adminModule.adminDeleteUserPreference);

    const createdPref = await adminCreateUserPreference(ctx, {
      clerkUserId: "clerk_new_001",
      focusAreas: [0, 1],
      reminderType: "daily",
      dailyTime: "09:00",
      weeklyDay: "monday",
      formattedTime: "9:00 AM",
    });
    const prefId = createdPref?._id as Id<"userPreferences">;

    expect((await listAllUserPreferences(ctx, {})).length).toBe(1);
    expect(
      (
        await listUserPreferencesPaginated(ctx, {
          paginationOpts: { numItems: 10, cursor: null },
          clerkUserId: "clerk_new_001",
        })
      ).page,
    ).toHaveLength(1);
    expect(
      (await adminGetUserPreference(ctx, { preferenceId: prefId }))._id,
    ).toBe(prefId);

    await adminUpdateUserPreference(ctx, {
      preferenceId: prefId,
      reminderType: "weekly",
      weeklyDay: "friday",
    });
    expect(
      (await adminDeleteUserPreference(ctx, { preferenceId: prefId })).success,
    ).toBe(true);

    const adminCreateMemory = handler<
      {
        userId: Id<"user">;
        title: string;
        description?: string;
        mood?: string;
        happenedAt: number;
        dayKey: string;
      },
      { _id: Id<"memories">; title: string } | null
    >(adminModule.adminCreateMemory);
    const listAllMemories = handler<
      Record<string, never>,
      Array<{ _id: Id<"memories"> }>
    >(adminModule.listAllMemories);
    const listMemoriesPaginated = handler<
      {
        paginationOpts: { numItems: number; cursor: string | null };
        dayKey?: string;
        userId?: Id<"user">;
      },
      { page: Array<{ _id: Id<"memories"> }> }
    >(adminModule.listMemoriesPaginated);
    const adminGetMemory = handler<
      { memoryId: Id<"memories"> },
      { _id: Id<"memories"> }
    >(adminModule.adminGetMemory);
    const adminUpdateMemory = handler<
      {
        memoryId: Id<"memories">;
        title?: string;
        description?: string;
        mood?: string;
        happenedAt?: number;
        dayKey?: string;
      },
      { _id: Id<"memories">; title: string } | null
    >(adminModule.adminUpdateMemory);
    const adminDeleteMemory = handler<
      { memoryId: Id<"memories"> },
      { success: boolean }
    >(adminModule.adminDeleteMemory);

    const createdMemory = await adminCreateMemory(ctx, {
      userId: createdUserId,
      title: "Admin memory",
      happenedAt: 100,
      dayKey: "2026-04-02",
    });
    const memoryId = createdMemory?._id as Id<"memories">;

    expect((await listAllMemories(ctx, {})).length).toBe(1);
    expect(
      (
        await listMemoriesPaginated(ctx, {
          paginationOpts: { numItems: 10, cursor: null },
          userId: createdUserId,
        })
      ).page,
    ).toHaveLength(1);
    expect(
      (
        await listMemoriesPaginated(ctx, {
          paginationOpts: { numItems: 10, cursor: null },
          dayKey: "2026-04-02",
        })
      ).page,
    ).toHaveLength(1);

    expect((await adminGetMemory(ctx, { memoryId }))._id).toBe(memoryId);
    await adminUpdateMemory(ctx, {
      memoryId,
      title: "Admin memory updated",
    });
    expect((await adminDeleteMemory(ctx, { memoryId })).success).toBe(true);

    const adminCreateDay = handler<
      {
        userId: Id<"user">;
        dayKey: string;
        rating?: number;
        manualNotes?: string[];
        peopleTags?: string[];
      },
      { _id: Id<"days">; dayKey: string } | null
    >(adminModule.adminCreateDay);
    const listAllDays = handler<
      Record<string, never>,
      Array<{ _id: Id<"days"> }>
    >(adminModule.listAllDays);
    const listDaysPaginated = handler<
      {
        paginationOpts: { numItems: number; cursor: string | null };
        dayKey?: string;
        userId?: Id<"user">;
      },
      { page: Array<{ _id: Id<"days"> }> }
    >(adminModule.listDaysPaginated);
    const adminGetDay = handler<
      { dayId: Id<"days"> },
      { _id: Id<"days">; dayKey: string }
    >(adminModule.adminGetDay);
    const adminUpdateDay = handler<
      {
        dayId: Id<"days">;
        dayKey?: string;
        rating?: number;
        manualNotes?: string[];
        peopleTags?: string[];
      },
      { _id: Id<"days">; dayKey: string } | null
    >(adminModule.adminUpdateDay);
    const adminDeleteDay = handler<{ dayId: Id<"days"> }, { success: boolean }>(
      adminModule.adminDeleteDay,
    );

    const createdDay = await adminCreateDay(ctx, {
      userId: createdUserId,
      dayKey: "2026-04-03",
      rating: 4,
    });
    const dayId = createdDay?._id as Id<"days">;

    expect((await listAllDays(ctx, {})).length).toBe(1);
    expect(
      (
        await listDaysPaginated(ctx, {
          paginationOpts: { numItems: 10, cursor: null },
          userId: createdUserId,
        })
      ).page,
    ).toHaveLength(1);
    expect(
      (
        await listDaysPaginated(ctx, {
          paginationOpts: { numItems: 10, cursor: null },
          dayKey: "2026-04-03",
        })
      ).page,
    ).toHaveLength(1);

    expect((await adminGetDay(ctx, { dayId }))._id).toBe(dayId);
    await adminUpdateDay(ctx, {
      dayId,
      rating: 5,
    });
    expect((await adminDeleteDay(ctx, { dayId })).success).toBe(true);

    const adminCreateSummary = handler<
      {
        userId: Id<"user">;
        dayKey: string;
        story: string;
        highlights: string[];
        sourcesUsed: string[];
      },
      { _id: Id<"daySummaries">; dayKey: string } | null
    >(adminModule.adminCreateSummary);
    const listAllSummaries = handler<
      Record<string, never>,
      Array<{ _id: Id<"daySummaries"> }>
    >(adminModule.listAllSummaries);
    const listSummariesPaginated = handler<
      {
        paginationOpts: { numItems: number; cursor: string | null };
        dayKey?: string;
        userId?: Id<"user">;
      },
      { page: Array<{ _id: Id<"daySummaries"> }> }
    >(adminModule.listSummariesPaginated);
    const adminGetSummary = handler<
      { summaryId: Id<"daySummaries"> },
      { _id: Id<"daySummaries"> }
    >(adminModule.adminGetSummary);
    const adminUpdateSummary = handler<
      {
        summaryId: Id<"daySummaries">;
        dayKey?: string;
        story?: string;
        highlights?: string[];
        sourcesUsed?: string[];
      },
      { _id: Id<"daySummaries"> } | null
    >(adminModule.adminUpdateSummary);
    const adminDeleteSummary = handler<
      { summaryId: Id<"daySummaries"> },
      { success: boolean }
    >(adminModule.adminDeleteSummary);

    const createdSummary = await adminCreateSummary(ctx, {
      userId: createdUserId,
      dayKey: "2026-04-04",
      story: "Summary",
      highlights: ["h1"],
      sourcesUsed: ["Memories"],
    });
    const summaryId = createdSummary?._id as Id<"daySummaries">;

    expect((await listAllSummaries(ctx, {})).length).toBe(1);
    expect(
      (
        await listSummariesPaginated(ctx, {
          paginationOpts: { numItems: 10, cursor: null },
          userId: createdUserId,
        })
      ).page,
    ).toHaveLength(1);
    expect(
      (
        await listSummariesPaginated(ctx, {
          paginationOpts: { numItems: 10, cursor: null },
          dayKey: "2026-04-04",
        })
      ).page,
    ).toHaveLength(1);

    expect((await adminGetSummary(ctx, { summaryId }))._id).toBe(summaryId);
    await adminUpdateSummary(ctx, { summaryId, story: "Summary v2" });
    expect((await adminDeleteSummary(ctx, { summaryId })).success).toBe(true);

    const adminCreateIntegration = handler<
      {
        userId: Id<"user">;
        provider: string;
        status: "connected" | "disconnected" | "error";
        scopes?: string[];
        tokenRef?: string;
      },
      { _id: Id<"integrations">; provider: string; tokenRef?: string } | null
    >(adminModule.adminCreateIntegration);
    const listAllIntegrations = handler<
      Record<string, never>,
      Array<{ _id: Id<"integrations"> }>
    >(adminModule.listAllIntegrations);
    const listIntegrationsPaginated = handler<
      {
        paginationOpts: { numItems: number; cursor: string | null };
        status?: "connected" | "disconnected" | "error";
        provider?: string;
      },
      { page: Array<{ _id: Id<"integrations"> }> }
    >(adminModule.listIntegrationsPaginated);
    const adminGetIntegration = handler<
      { integrationId: Id<"integrations"> },
      { _id: Id<"integrations">; provider: string; tokenRef?: string }
    >(adminModule.adminGetIntegration);
    const adminUpdateIntegration = handler<
      {
        integrationId: Id<"integrations">;
        provider?: string;
        status?: "connected" | "disconnected" | "error";
        scopes?: string[];
        tokenRef?: string;
      },
      { _id: Id<"integrations">; status: string } | null
    >(adminModule.adminUpdateIntegration);
    const adminDeleteIntegration = handler<
      { integrationId: Id<"integrations"> },
      { success: boolean }
    >(adminModule.adminDeleteIntegration);

    const createdIntegration = await adminCreateIntegration(ctx, {
      userId: createdUserId,
      provider: "spotify",
      status: "connected",
      scopes: ["user-read-recently-played"],
      tokenRef: "tokref_secret_001",
    });
    const integrationId = createdIntegration?._id as Id<"integrations">;

    await db.insert("integrationDailyData", {
      userId: createdUserId,
      provider: "spotify",
      dayKey: "2026-04-04",
      syncedAt: 100,
    });
    await db.insert("integrationSecrets", {
      userId: createdUserId,
      provider: "spotify",
      tokenRef: "tokref_secret_001",
      createdAt: 1,
      updatedAt: 1,
    });
    await db.insert("integrationSyncRuns", {
      userId: createdUserId,
      provider: "spotify",
      dayKey: "2026-04-04",
      status: "success",
      startedAt: 1,
      updatedAt: 1,
    });

    expect((await listAllIntegrations(ctx, {})).length).toBe(1);
    expect(
      (
        await listIntegrationsPaginated(ctx, {
          paginationOpts: { numItems: 10, cursor: null },
          status: "connected",
        })
      ).page,
    ).toHaveLength(1);
    expect(
      (
        await listIntegrationsPaginated(ctx, {
          paginationOpts: { numItems: 10, cursor: null },
          provider: "spotify",
        })
      ).page,
    ).toHaveLength(1);
    expect(
      (
        await listIntegrationsPaginated(ctx, {
          paginationOpts: { numItems: 10, cursor: null },
          status: "connected",
          provider: "spotify",
        })
      ).page,
    ).toHaveLength(1);

    expect((await adminGetIntegration(ctx, { integrationId }))._id).toBe(
      integrationId,
    );
    await adminUpdateIntegration(ctx, {
      integrationId,
      status: "error",
      scopes: ["scope-updated"],
    });
    expect((await adminDeleteIntegration(ctx, { integrationId })).success).toBe(
      true,
    );

    const listAuditLogs = handler<
      { limit?: number },
      Array<{ _id: Id<"auditLogs"> }>
    >(adminModule.listAuditLogs);
    const listAuditLogsPaginated = handler<
      {
        paginationOpts: { numItems: number; cursor: string | null };
        userId?: Id<"user">;
        actorUserId?: Id<"user">;
        action?: string;
        fromTs?: number;
        toTs?: number;
      },
      { page: Array<{ _id: Id<"auditLogs"> }> }
    >(adminModule.listAuditLogsPaginated);
    const writeAuditLog = handler<
      { action: string; target?: string },
      { _id: Id<"auditLogs">; action: string } | null
    >(adminModule.writeAuditLog);
    const adminDeleteAuditLog = handler<
      { auditLogId: Id<"auditLogs"> },
      { success: boolean }
    >(adminModule.adminDeleteAuditLog);

    const writtenAudit = await writeAuditLog(ctx, {
      action: "manual_audit",
      target: "test",
    });
    const auditId = writtenAudit?._id as Id<"auditLogs">;

    expect(
      (await listAuditLogs(ctx, { limit: 20 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      (
        await listAuditLogsPaginated(ctx, {
          paginationOpts: { numItems: 20, cursor: null },
          action: "manual_audit",
        })
      ).page,
    ).toHaveLength(1);

    expect(
      (await adminDeleteAuditLog(ctx, { auditLogId: auditId })).success,
    ).toBe(true);

    expect(
      (await adminDeleteUser(ctx, { userId: createdUserId })).success,
    ).toBe(true);

    const rebuilt = await adminRebuildDashboardMetrics(ctx, {});
    expect(rebuilt.totalUsers).toBeGreaterThanOrEqual(1);
  });

  it("migrates legacy user deletion statuses safely and idempotently", async () => {
    const db = seededDb();
    const ctx = adminCtx(db);

    const adminMigrateUserDeletionJobStatuses = handler<
      {
        dryRun?: boolean;
        cursor?: string;
        pageSize?: number;
        maxPages?: number;
      },
      {
        success: boolean;
        dryRun: boolean;
        pageSize: number;
        maxPages: number;
        pagesScanned: number;
        scanned: number;
        migratedRequested: number;
        migratedProcessing: number;
        totalMigrated: number;
        hasMore: boolean;
        nextCursor: string | null;
      }
    >(adminModule.adminMigrateUserDeletionJobStatuses);

    const emptyProgress = {
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
    };

    const queuedJobId = (await db.insert("userDeletionJobs", {
      userId: MEMBER_ID,
      clerkUserId: "clerk_member_001",
      requestedByUserId: ADMIN_ID,
      status: "queued",
      stage: "memoryMedia",
      processedBatches: 0,
      checkpoints: 0,
      progress: emptyProgress,
      startedAt: 10,
      updatedAt: 10,
    })) as Id<"userDeletionJobs">;

    const runningJobId = (await db.insert("userDeletionJobs", {
      userId: MEMBER_ID,
      clerkUserId: "clerk_member_001",
      requestedByUserId: ADMIN_ID,
      status: "running",
      stage: "memoryMedia",
      processedBatches: 1,
      checkpoints: 1,
      progress: emptyProgress,
      startedAt: 20,
      updatedAt: 20,
    })) as Id<"userDeletionJobs">;

    const completedJobId = (await db.insert("userDeletionJobs", {
      userId: MEMBER_ID,
      clerkUserId: "clerk_member_001",
      requestedByUserId: ADMIN_ID,
      status: "completed",
      stage: "summaryGenerationQuotas",
      processedBatches: 2,
      checkpoints: 2,
      progress: emptyProgress,
      startedAt: 30,
      updatedAt: 30,
      completedAt: 35,
    })) as Id<"userDeletionJobs">;

    const dryRun = await adminMigrateUserDeletionJobStatuses(ctx, {
      dryRun: true,
      pageSize: 10,
      maxPages: 10,
    });
    expect(dryRun.success).toBe(true);
    expect(dryRun.totalMigrated).toBe(2);
    expect(dryRun.migratedRequested).toBe(1);
    expect(dryRun.migratedProcessing).toBe(1);
    expect((await db.get(queuedJobId))?.status).toBe("queued");
    expect((await db.get(runningJobId))?.status).toBe("running");

    const migrated = await adminMigrateUserDeletionJobStatuses(ctx, {
      dryRun: false,
      pageSize: 10,
      maxPages: 10,
    });
    expect(migrated.totalMigrated).toBe(2);
    expect((await db.get(queuedJobId))?.status).toBe("requested");
    expect((await db.get(runningJobId))?.status).toBe("processing");
    expect((await db.get(completedJobId))?.status).toBe("completed");

    const secondPass = await adminMigrateUserDeletionJobStatuses(ctx, {
      dryRun: false,
      pageSize: 10,
      maxPages: 10,
    });
    expect(secondPass.totalMigrated).toBe(0);
  });

  it("lists recent user deletion jobs for admin monitoring", async () => {
    const db = seededDb();
    const ctx = adminCtx(db);

    const adminListRecentUserDeletionJobs = handler<
      { limit?: number; pollToken?: number },
      Array<{
        _id: Id<"userDeletionJobs">;
        userId: Id<"user">;
        clerkUserId: string;
        userEmail: string | null;
        status: "requested" | "processing" | "completed" | "failed";
        updatedAt: number;
      }>
    >(adminModule.adminListRecentUserDeletionJobs);

    const emptyProgress = {
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
    };

    const olderJobId = (await db.insert("userDeletionJobs", {
      userId: MEMBER_ID,
      clerkUserId: "clerk_member_001",
      requestedByUserId: ADMIN_ID,
      status: "failed",
      stage: "memories",
      processedBatches: 1,
      checkpoints: 1,
      progress: emptyProgress,
      startedAt: 100,
      updatedAt: 100,
      failedAt: 100,
      lastError: "failed_once",
    })) as Id<"userDeletionJobs">;

    const deletedUserId = "user_deleted_001" as Id<"user">;
    const newerJobId = (await db.insert("userDeletionJobs", {
      userId: deletedUserId,
      clerkUserId: "clerk_deleted_001",
      requestedByUserId: ADMIN_ID,
      status: "processing",
      stage: "days",
      processedBatches: 3,
      checkpoints: 3,
      progress: emptyProgress,
      startedAt: 200,
      updatedAt: 200,
    })) as Id<"userDeletionJobs">;

    const recent = await adminListRecentUserDeletionJobs(ctx, {
      limit: 10,
      pollToken: 1,
    });

    expect(recent).toHaveLength(2);
    expect(recent[0]?._id).toBe(newerJobId);
    expect(recent[0]?.userEmail).toBeNull();
    expect(recent[0]?.clerkUserId).toBe("clerk_deleted_001");
    expect(recent[1]?._id).toBe(olderJobId);
    expect(recent[1]?.userEmail).toBe("member@example.com");
  });
});
