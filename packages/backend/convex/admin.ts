import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./authz";
import { clampLimit, validateDayKey, validateRating } from "./validators";
import { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { assertIntegrationProvider } from "./integrationProviders";
import { isOpaqueTokenRef, normalizeTokenRef } from "./integrations.auth";
import {
  deleteDayCascadeData,
  deleteMemoryMediaByMemoryId,
} from "./cascadeCleanup";
import {
  applyDashboardMetricsDelta,
  type DashboardMetricsSnapshot,
} from "./dashboardMetrics";
import {
  buildDaySensitiveWritePayload,
  buildMemorySensitiveWritePayload,
  buildSummarySensitiveWritePayload,
  needsDaySensitiveMigration,
  needsSummarySensitiveMigration,
  readDaySensitiveFields,
  readMemorySensitiveFields,
  readSummarySensitiveFields,
  type DaySensitiveRecord,
  type MemorySensitiveRecord,
  type SummarySensitiveRecord,
} from "./sensitiveDataFields";
import {
  mapAdminDayRecord,
  mapAdminMemoryRecord,
  mapAdminSummaryRecord,
} from "./admin/utilities/adminRecordMappers";
import { logAdminAction } from "./admin/services/adminAuditService";
import { listAuditLogsPaginatedImpl } from "./admin/services/auditLogsService";
import {
  buildAdminIntegrationUpdatePatch,
  deleteIntegrationCascadeData,
} from "./admin/services/adminIntegrationsService";
import { listIntegrationsPaginatedImpl } from "./admin/services/adminIntegrationsQueryService";
import {
  listAllUserPreferencesWithEmailImpl,
  listUserPreferencesPaginatedWithEmailImpl,
} from "./admin/services/adminPreferencesService";
import { listMemoriesPaginatedImpl } from "./admin/services/adminMemoriesQueryService";
import { listDaysPaginatedImpl } from "./admin/services/adminDaysQueryService";
import { listSummariesPaginatedImpl } from "./admin/services/adminSummariesQueryService";
import {
  adminDeleteAuditLogImpl,
  listAuditLogsImpl,
  writeAuditLogImpl,
} from "./admin/services/adminAuditLogsService";
import {
  getDashboardMetricsController,
  rebuildDashboardMetricsController,
} from "./admin/controllers/adminDashboardController";
import {
  adminCreateUserController,
  adminGetUserController,
  adminUpdateUserController,
  listAllUsersController,
  listUsersByIdsController,
  listUsersPaginatedController,
} from "./admin/controllers/adminUsersController";

type AdminMemoryRecord = Doc<"memories"> & MemorySensitiveRecord;
type AdminDayRecord = Doc<"days"> & DaySensitiveRecord;
type AdminSummaryRecord = Doc<"daySummaries"> & SummarySensitiveRecord;

// ────────────────────────────────────────────────────────────
// All functions in this file require admin privileges.
// ────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════
// Dashboard
// ══════════════════════════════════════════════════════════════

export const getDashboardMetrics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await getDashboardMetricsController(ctx);
  },
});

export const adminRebuildDashboardMetrics = mutation({
  args: {},
  handler: async (ctx): Promise<DashboardMetricsSnapshot> => {
    const admin = await requireAdmin(ctx);
    return await rebuildDashboardMetricsController(ctx, admin._id);
  },
});

// ══════════════════════════════════════════════════════════════
// Users CRUD
// ══════════════════════════════════════════════════════════════

export const adminCreateUser = mutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    isAdmin: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    return await adminCreateUserController(ctx, args, admin._id);
  },
});

export const listAllUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await listAllUsersController(ctx);
  },
});

export const listUsersByIds = query({
  args: {
    userIds: v.array(v.id("user")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await listUsersByIdsController(ctx, args.userIds);
  },
});

export const listUsersPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await listUsersPaginatedController(ctx, args.paginationOpts);
  },
});

export const adminGetUser = query({
  args: { userId: v.id("user") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await adminGetUserController(ctx, args.userId);
  },
});

export const adminUpdateUser = mutation({
  args: {
    userId: v.id("user"),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    isAdmin: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    return await adminUpdateUserController(ctx, args, admin._id);
  },
});

export const adminDeleteUser = mutation({
  args: { userId: v.id("user") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    queued: boolean;
    jobId: Id<"userDeletionJobs">;
    status: "requested" | "processing" | "completed" | "failed";
    stage: string;
    created: boolean;
  }> => {
    const admin = await requireAdmin(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    const now = Date.now();
    await ctx.db.patch(args.userId, {
      accountStatus: "deletion_requested",
      accountDeletionRequestedAt: user.accountDeletionRequestedAt ?? now,
    });

    const deletionJob = await ctx.runMutation(
      internal.users.enqueueUserDeletionJobInternal,
      {
        userId: args.userId,
        clerkUserId: user.clerkUserId,
        requestedByUserId: admin._id,
      },
    );

    await logAdminAction(ctx, admin._id, "delete_user_requested", user.email);

    return {
      success: true,
      queued: true,
      jobId: deletionJob.jobId,
      status: deletionJob.status,
      stage: deletionJob.stage,
      created: deletionJob.created,
    };
  },
});

export const adminGetUserDeletionJob = query({
  args: {
    jobId: v.id("userDeletionJobs"),
    pollToken: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    void args.pollToken;

    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("User deletion job not found");
    }

    return job;
  },
});

export const adminListRecentUserDeletionJobs = query({
  args: {
    limit: v.optional(v.number()),
    pollToken: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    void args.pollToken;

    const limit = clampLimit(args.limit ?? 15, 100);
    const jobs = await ctx.db
      .query("userDeletionJobs")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(limit);

    if (jobs.length === 0) {
      return [];
    }

    const uniqueUserIds = Array.from(new Set(jobs.map((job) => job.userId)));

    const userRows = await Promise.all(
      uniqueUserIds.map((userId) => ctx.db.get(userId)),
    );

    const userEmailById = new Map<string, string>();
    userRows.forEach((row) => {
      if (!row) {
        return;
      }
      userEmailById.set(String(row._id), row.email);
    });

    return jobs.map((job) => ({
      ...job,
      userEmail: userEmailById.get(String(job.userId)) ?? null,
    }));
  },
});

export const adminMigrateUserDeletionJobStatuses = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const dryRun = args.dryRun ?? false;
    const pageSize = clampLimit(args.pageSize ?? 256, 512);
    const maxPages = clampLimit(args.maxPages ?? 64, 512);

    let cursor: string | null = args.cursor ?? null;
    let pagesScanned = 0;
    let scanned = 0;
    let migratedRequested = 0;
    let migratedProcessing = 0;
    const migrationTs = Date.now();

    while (pagesScanned < maxPages) {
      const page = await ctx.db
        .query("userDeletionJobs")
        .withIndex("by_updatedAt")
        .paginate({
          numItems: pageSize,
          cursor,
        });

      pagesScanned += 1;

      for (const row of page.page) {
        scanned += 1;

        const status = (row as { status?: unknown }).status;
        const nextStatus =
          status === "queued"
            ? "requested"
            : status === "running"
              ? "processing"
              : null;

        if (!nextStatus) {
          continue;
        }

        if (!dryRun) {
          await ctx.db.patch((row as { _id: Id<"userDeletionJobs"> })._id, {
            status: nextStatus,
            updatedAt: migrationTs,
          });
        }

        if (nextStatus === "requested") {
          migratedRequested += 1;
        } else {
          migratedProcessing += 1;
        }
      }

      if (page.isDone) {
        cursor = null;
        break;
      }

      cursor = page.continueCursor;
    }

    const totalMigrated = migratedRequested + migratedProcessing;

    if (!dryRun && totalMigrated > 0) {
      await logAdminAction(
        ctx,
        admin._id,
        "migrate_user_deletion_job_statuses",
        `requested:${migratedRequested},processing:${migratedProcessing}`,
      );
    }

    return {
      success: true,
      dryRun,
      pageSize,
      maxPages,
      pagesScanned,
      scanned,
      migratedRequested,
      migratedProcessing,
      totalMigrated,
      hasMore: cursor !== null,
      nextCursor: cursor,
    };
  },
});

export const adminGetLatestUserDeletionJobByUserId = query({
  args: { userId: v.id("user") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const processing = await ctx.db
      .query("userDeletionJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "processing"),
      )
      .order("desc")
      .take(1);
    if (processing[0]) return processing[0];

    const requested = await ctx.db
      .query("userDeletionJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "requested"),
      )
      .order("desc")
      .take(1);
    if (requested[0]) return requested[0];

    const completed = await ctx.db
      .query("userDeletionJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "completed"),
      )
      .order("desc")
      .take(1);

    const failed = await ctx.db
      .query("userDeletionJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "failed"),
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
  },
});

// ══════════════════════════════════════════════════════════════
// User Preferences CRUD
// ══════════════════════════════════════════════════════════════

export const adminCreateUserPreference = mutation({
  args: {
    clerkUserId: v.string(),
    focusAreas: v.array(v.number()),
    reminderType: v.union(v.literal("daily"), v.literal("weekly")),
    dailyTime: v.string(),
    weeklyDay: v.string(),
    formattedTime: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("userPreferences", {
      clerkUserId: args.clerkUserId,
      focusAreas: args.focusAreas,
      reminderType: args.reminderType,
      dailyTime: args.dailyTime,
      weeklyDay: args.weeklyDay,
      formattedTime: args.formattedTime,
      createdAt: now,
      updatedAt: now,
    });

    await applyDashboardMetricsDelta(ctx.db, {
      totalPreferences: 1,
    });

    await logAdminAction(ctx, admin._id, "create_preference", args.clerkUserId);
    return await ctx.db.get(id);
  },
});

export const listAllUserPreferences = query({
  args: {},
  handler: async (ctx) => await listAllUserPreferencesWithEmailImpl(ctx),
});

export const listUserPreferencesPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) =>
    await listUserPreferencesPaginatedWithEmailImpl(ctx, args),
});

export const adminGetUserPreference = query({
  args: { preferenceId: v.id("userPreferences") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const pref = await ctx.db.get(args.preferenceId);
    if (!pref) throw new Error("Preference not found");
    return pref;
  },
});

export const adminUpdateUserPreference = mutation({
  args: {
    preferenceId: v.id("userPreferences"),
    focusAreas: v.optional(v.array(v.number())),
    reminderType: v.optional(v.union(v.literal("daily"), v.literal("weekly"))),
    dailyTime: v.optional(v.string()),
    weeklyDay: v.optional(v.string()),
    formattedTime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const pref = await ctx.db.get(args.preferenceId);
    if (!pref) throw new Error("Preference not found");

    const updates: Record<string, unknown> = {};
    if (args.focusAreas !== undefined) updates.focusAreas = args.focusAreas;
    if (args.reminderType !== undefined)
      updates.reminderType = args.reminderType;
    if (args.dailyTime !== undefined) updates.dailyTime = args.dailyTime;
    if (args.weeklyDay !== undefined) updates.weeklyDay = args.weeklyDay;
    if (args.formattedTime !== undefined)
      updates.formattedTime = args.formattedTime;
    updates.updatedAt = Date.now();

    await ctx.db.patch(args.preferenceId, updates);
    await logAdminAction(
      ctx,
      admin._id,
      "update_preference",
      String(args.preferenceId),
    );
    return await ctx.db.get(args.preferenceId);
  },
});

export const adminDeleteUserPreference = mutation({
  args: { preferenceId: v.id("userPreferences") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const pref = await ctx.db.get(args.preferenceId);
    if (!pref) throw new Error("Preference not found");
    await ctx.db.delete(args.preferenceId);

    await applyDashboardMetricsDelta(ctx.db, {
      totalPreferences: -1,
    });

    await logAdminAction(
      ctx,
      admin._id,
      "delete_preference",
      String(args.preferenceId),
    );
    return { success: true };
  },
});

// ══════════════════════════════════════════════════════════════
// Memories CRUD
// ══════════════════════════════════════════════════════════════

export const adminCreateMemory = mutation({
  args: {
    userId: v.id("user"),
    title: v.string(),
    description: v.optional(v.string()),
    mood: v.optional(v.string()),
    happenedAt: v.number(),
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    validateDayKey(args.dayKey);

    const encryptedPayload = await buildMemorySensitiveWritePayload({
      userId: args.userId,
      title: args.title,
      description: args.description,
      mood: args.mood,
    });

    const id = await ctx.db.insert("memories", {
      userId: args.userId,
      ...encryptedPayload,
      happenedAt: args.happenedAt,
      dayKey: args.dayKey,
    });

    await applyDashboardMetricsDelta(ctx.db, {
      totalMemories: 1,
    });

    await logAdminAction(ctx, admin._id, "create_memory", args.title);
    return await mapAdminMemoryRecord(
      (await ctx.db.get(id)) as AdminMemoryRecord,
    );
  },
});

export const listAllMemories = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db
      .query("memories")
      .withIndex("by_happenedAt")
      .order("desc")
      .take(200);

    return await Promise.all(
      rows.map(
        async (row) => await mapAdminMemoryRecord(row as AdminMemoryRecord),
      ),
    );
  },
});

export const listMemoriesPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    dayKey: v.optional(v.string()),
    userId: v.optional(v.id("user")),
  },
  handler: async (ctx, args) => await listMemoriesPaginatedImpl(ctx, args),
});

export const adminGetMemory = query({
  args: { memoryId: v.id("memories") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new Error("Memory not found");
    return await mapAdminMemoryRecord(memory as AdminMemoryRecord);
  },
});

export const adminUpdateMemory = mutation({
  args: {
    memoryId: v.id("memories"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    mood: v.optional(v.string()),
    happenedAt: v.optional(v.number()),
    dayKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.dayKey !== undefined) validateDayKey(args.dayKey);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new Error("Memory not found");

    const currentSensitive = await readMemorySensitiveFields(
      memory as AdminMemoryRecord,
    );

    const updates: Record<string, unknown> = {};
    if (args.happenedAt !== undefined) updates.happenedAt = args.happenedAt;
    if (args.dayKey !== undefined) updates.dayKey = args.dayKey;

    const shouldEncryptSensitiveFields =
      args.title !== undefined ||
      args.description !== undefined ||
      args.mood !== undefined ||
      !memory.titleEncrypted ||
      !memory.sensitiveDataNonce;

    if (shouldEncryptSensitiveFields) {
      const encryptedPayload = await buildMemorySensitiveWritePayload({
        userId: memory.userId,
        title: args.title ?? currentSensitive.title,
        description:
          args.description !== undefined
            ? args.description
            : currentSensitive.description,
        mood: args.mood !== undefined ? args.mood : currentSensitive.mood,
        sensitiveDataNonce: memory.sensitiveDataNonce,
      });
      Object.assign(updates, encryptedPayload);
    }

    await ctx.db.patch(args.memoryId, updates);
    await logAdminAction(
      ctx,
      admin._id,
      "update_memory",
      String(args.memoryId),
    );
    return await mapAdminMemoryRecord(
      (await ctx.db.get(args.memoryId)) as AdminMemoryRecord,
    );
  },
});

export const adminDeleteMemory = mutation({
  args: { memoryId: v.id("memories") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new Error("Memory not found");

    const sensitive = await readMemorySensitiveFields(
      memory as AdminMemoryRecord,
    );

    await deleteMemoryMediaByMemoryId(ctx, args.memoryId);

    await ctx.db.delete(args.memoryId);

    await applyDashboardMetricsDelta(ctx.db, {
      totalMemories: -1,
    });

    await logAdminAction(ctx, admin._id, "delete_memory", sensitive.title);
    return { success: true };
  },
});

// ══════════════════════════════════════════════════════════════
// Days CRUD
// ══════════════════════════════════════════════════════════════

export const adminCreateDay = mutation({
  args: {
    userId: v.id("user"),
    dayKey: v.string(),
    rating: v.optional(v.number()),
    manualNotes: v.optional(v.array(v.string())),
    peopleTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    validateDayKey(args.dayKey);
    if (args.rating !== undefined) validateRating(args.rating);

    const encryptedPayload = await buildDaySensitiveWritePayload({
      userId: args.userId,
      manualNotes: args.manualNotes,
      peopleTags: args.peopleTags,
    });

    const id = await ctx.db.insert("days", {
      userId: args.userId,
      dayKey: args.dayKey,
      rating: args.rating,
      ...encryptedPayload,
    });

    await applyDashboardMetricsDelta(ctx.db, {
      totalDays: 1,
    });

    await logAdminAction(ctx, admin._id, "create_day", args.dayKey);
    return await mapAdminDayRecord((await ctx.db.get(id)) as AdminDayRecord);
  },
});

export const listAllDays = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db
      .query("days")
      .withIndex("by_dayKey")
      .order("desc")
      .take(200);

    return await Promise.all(
      rows.map(async (row) => await mapAdminDayRecord(row as AdminDayRecord)),
    );
  },
});

export const listDaysPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    dayKey: v.optional(v.string()),
    userId: v.optional(v.id("user")),
  },
  handler: async (ctx, args) => await listDaysPaginatedImpl(ctx, args),
});

export const adminGetDay = query({
  args: { dayId: v.id("days") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const day = await ctx.db.get(args.dayId);
    if (!day) throw new Error("Day not found");
    return await mapAdminDayRecord(day as AdminDayRecord);
  },
});

export const adminUpdateDay = mutation({
  args: {
    dayId: v.id("days"),
    dayKey: v.optional(v.string()),
    rating: v.optional(v.number()),
    manualNotes: v.optional(v.array(v.string())),
    peopleTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.dayKey !== undefined) validateDayKey(args.dayKey);
    if (args.rating !== undefined) validateRating(args.rating);
    const day = await ctx.db.get(args.dayId);
    if (!day) throw new Error("Day not found");

    const currentSensitive = await readDaySensitiveFields(
      day as AdminDayRecord,
    );

    const updates: Record<string, unknown> = {};
    if (args.dayKey !== undefined) updates.dayKey = args.dayKey;
    if (args.rating !== undefined) updates.rating = args.rating;

    const shouldEncryptSensitiveFields =
      args.manualNotes !== undefined ||
      args.peopleTags !== undefined ||
      needsDaySensitiveMigration(day as AdminDayRecord);

    if (shouldEncryptSensitiveFields) {
      const encryptedPayload = await buildDaySensitiveWritePayload({
        userId: day.userId,
        manualNotes:
          args.manualNotes !== undefined
            ? args.manualNotes
            : currentSensitive.manualNotes,
        peopleTags:
          args.peopleTags !== undefined
            ? args.peopleTags
            : currentSensitive.peopleTags,
        sensitiveDataNonce: day.sensitiveDataNonce,
      });
      Object.assign(updates, encryptedPayload);
    }

    await ctx.db.patch(args.dayId, updates);
    await logAdminAction(ctx, admin._id, "update_day", String(args.dayId));
    return await mapAdminDayRecord(
      (await ctx.db.get(args.dayId)) as AdminDayRecord,
    );
  },
});

export const adminDeleteDay = mutation({
  args: { dayId: v.id("days") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const day = await ctx.db.get(args.dayId);
    if (!day) throw new Error("Day not found");

    const deleted = await deleteDayCascadeData(ctx, {
      userId: day.userId,
      dayKey: day.dayKey,
    });

    await ctx.db.delete(args.dayId);

    await applyDashboardMetricsDelta(ctx.db, {
      totalDays: -1,
      totalMemories: -deleted.deletedMemories,
      totalSummaries: -deleted.deletedSummaries,
    });

    await logAdminAction(ctx, admin._id, "delete_day", day.dayKey);
    return { success: true };
  },
});

// ══════════════════════════════════════════════════════════════
// Day Summaries CRUD
// ══════════════════════════════════════════════════════════════

export const adminCreateSummary = mutation({
  args: {
    userId: v.id("user"),
    dayKey: v.string(),
    story: v.string(),
    highlights: v.array(v.string()),
    sourcesUsed: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    validateDayKey(args.dayKey);

    const encryptedPayload = await buildSummarySensitiveWritePayload({
      userId: args.userId,
      story: args.story,
      highlights: args.highlights,
    });

    const id = await ctx.db.insert("daySummaries", {
      userId: args.userId,
      dayKey: args.dayKey,
      ...encryptedPayload,
      sourcesUsed: args.sourcesUsed,
      generatedAt: Date.now(),
    });

    await applyDashboardMetricsDelta(ctx.db, {
      totalSummaries: 1,
    });

    await logAdminAction(ctx, admin._id, "create_summary", args.dayKey);
    return await mapAdminSummaryRecord(
      (await ctx.db.get(id)) as AdminSummaryRecord,
    );
  },
});

export const listAllSummaries = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db
      .query("daySummaries")
      .withIndex("by_generatedAt")
      .order("desc")
      .take(200);

    return await Promise.all(
      rows.map(
        async (row) => await mapAdminSummaryRecord(row as AdminSummaryRecord),
      ),
    );
  },
});

export const listSummariesPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    dayKey: v.optional(v.string()),
    userId: v.optional(v.id("user")),
  },
  handler: async (ctx, args) => await listSummariesPaginatedImpl(ctx, args),
});

export const adminGetSummary = query({
  args: { summaryId: v.id("daySummaries") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const summary = await ctx.db.get(args.summaryId);
    if (!summary) throw new Error("Summary not found");
    return await mapAdminSummaryRecord(summary as AdminSummaryRecord);
  },
});

export const adminUpdateSummary = mutation({
  args: {
    summaryId: v.id("daySummaries"),
    dayKey: v.optional(v.string()),
    story: v.optional(v.string()),
    highlights: v.optional(v.array(v.string())),
    sourcesUsed: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.dayKey !== undefined) validateDayKey(args.dayKey);
    const summary = await ctx.db.get(args.summaryId);
    if (!summary) throw new Error("Summary not found");

    const currentSensitive = await readSummarySensitiveFields(
      summary as AdminSummaryRecord,
    );

    const updates: Record<string, unknown> = {};
    if (args.dayKey !== undefined) updates.dayKey = args.dayKey;
    if (args.sourcesUsed !== undefined) updates.sourcesUsed = args.sourcesUsed;
    updates.generatedAt = Date.now();

    const shouldEncryptSensitiveFields =
      args.story !== undefined ||
      args.highlights !== undefined ||
      needsSummarySensitiveMigration(summary as AdminSummaryRecord);

    if (shouldEncryptSensitiveFields) {
      const encryptedPayload = await buildSummarySensitiveWritePayload({
        userId: summary.userId,
        story: args.story ?? currentSensitive.story,
        highlights:
          args.highlights !== undefined
            ? args.highlights
            : currentSensitive.highlights,
        sensitiveDataNonce: summary.sensitiveDataNonce,
      });
      Object.assign(updates, encryptedPayload);
    }

    await ctx.db.patch(args.summaryId, updates);
    await logAdminAction(
      ctx,
      admin._id,
      "update_summary",
      String(args.summaryId),
    );
    return await mapAdminSummaryRecord(
      (await ctx.db.get(args.summaryId)) as AdminSummaryRecord,
    );
  },
});

export const adminDeleteSummary = mutation({
  args: { summaryId: v.id("daySummaries") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const summary = await ctx.db.get(args.summaryId);
    if (!summary) throw new Error("Summary not found");
    await ctx.db.delete(args.summaryId);

    await applyDashboardMetricsDelta(ctx.db, {
      totalSummaries: -1,
    });

    await logAdminAction(
      ctx,
      admin._id,
      "delete_summary",
      String(args.summaryId),
    );
    return { success: true };
  },
});

// ══════════════════════════════════════════════════════════════
// Integrations CRUD
// ══════════════════════════════════════════════════════════════

export const adminCreateIntegration = mutation({
  args: {
    userId: v.id("user"),
    provider: v.string(),
    status: v.union(
      v.literal("connected"),
      v.literal("disconnected"),
      v.literal("error"),
    ),
    scopes: v.optional(v.array(v.string())),
    tokenRef: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const admin = await requireAdmin(ctx);
    const provider = assertIntegrationProvider(args.provider);

    const normalizedTokenRef = normalizeTokenRef(args.tokenRef);
    let nextTokenRef: string | undefined;

    if (normalizedTokenRef === null) {
      nextTokenRef = undefined;
    } else if (!isOpaqueTokenRef(normalizedTokenRef)) {
      throw new Error(
        'adminCreateIntegration.tokenRef must be an opaque tokenRef prefixed with "tokref_". Raw token values are rejected.',
      );
    } else {
      nextTokenRef = normalizedTokenRef;
    }

    const id: Id<"integrations"> = await ctx.db.insert("integrations", {
      userId: args.userId,
      provider,
      status: args.status,
      scopes: args.scopes,
      tokenRef: nextTokenRef,
    });

    await applyDashboardMetricsDelta(ctx.db, {
      totalIntegrations: 1,
    });

    await logAdminAction(ctx, admin._id, "create_integration", provider);
    return await ctx.db.get(id);
  },
});

export const listAllIntegrations = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("integrations")
      .withIndex("by_provider")
      .take(200);
  },
});

export const listIntegrationsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(
      v.union(
        v.literal("connected"),
        v.literal("disconnected"),
        v.literal("error"),
      ),
    ),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listIntegrationsPaginatedImpl(ctx, args);
  },
});

export const adminGetIntegration = query({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Integration not found");
    return integration;
  },
});

export const adminUpdateIntegration = mutation({
  args: {
    integrationId: v.id("integrations"),
    provider: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("connected"),
        v.literal("disconnected"),
        v.literal("error"),
      ),
    ),
    scopes: v.optional(v.array(v.string())),
    tokenRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Integration not found");
    const updates = buildAdminIntegrationUpdatePatch(integration, {
      provider: args.provider,
      status: args.status,
      scopes: args.scopes,
      tokenRef: args.tokenRef,
    });

    await ctx.db.patch(args.integrationId, updates);
    await logAdminAction(
      ctx,
      admin._id,
      "update_integration",
      String(args.integrationId),
    );
    return await ctx.db.get(args.integrationId);
  },
});

export const adminDeleteIntegration = mutation({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Integration not found");
    await deleteIntegrationCascadeData(ctx.db, integration);

    await ctx.db.delete(args.integrationId);

    await applyDashboardMetricsDelta(ctx.db, {
      totalIntegrations: -1,
    });

    await logAdminAction(
      ctx,
      admin._id,
      "delete_integration",
      String(args.integrationId),
    );
    return { success: true };
  },
});

// ══════════════════════════════════════════════════════════════
// Audit Logs (read + delete)
// ══════════════════════════════════════════════════════════════

export const listAuditLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => await listAuditLogsImpl(ctx, args),
});

export const listAuditLogsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    userId: v.optional(v.id("user")),
    // Backward compatibility for older clients.
    actorUserId: v.optional(v.id("user")),
    action: v.optional(v.string()),
    fromTs: v.optional(v.number()),
    toTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await listAuditLogsPaginatedImpl(ctx, args);
  },
});

export const writeAuditLog = mutation({
  args: {
    action: v.string(),
    target: v.optional(v.string()),
  },
  handler: async (ctx, args) => await writeAuditLogImpl(ctx, args),
});

export const adminDeleteAuditLog = mutation({
  args: { auditLogId: v.id("auditLogs") },
  handler: async (ctx, args) => await adminDeleteAuditLogImpl(ctx, args),
});
