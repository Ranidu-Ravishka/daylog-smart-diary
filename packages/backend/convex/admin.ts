import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, MutationCtx } from "./_generated/server";
import { requireAdmin } from "./authz";
import { validateDayKey, validateRating } from "./validators";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

const OPAQUE_TOKEN_REF_PREFIX = "tokref_";

// ────────────────────────────────────────────────────────────
// All functions in this file require admin privileges.
// ────────────────────────────────────────────────────────────

/** Inline audit-log helper — call after the main action succeeds. */
async function logAdminAction(
  ctx: MutationCtx,
  adminId: Id<"user">,
  action: string,
  target?: string,
) {
  await ctx.db.insert("auditLogs", {
    actorUserId: adminId,
    action,
    target,
    at: Date.now(),
  });
}

// ══════════════════════════════════════════════════════════════
// Dashboard
// ══════════════════════════════════════════════════════════════

export const getDashboardMetrics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const [
      users,
      memories,
      days,
      summaries,
      integrations,
      preferences,
      auditLogs,
    ] = await Promise.all([
      ctx.db.query("user").collect(),
      ctx.db.query("memories").collect(),
      ctx.db.query("days").collect(),
      ctx.db.query("daySummaries").collect(),
      ctx.db.query("integrations").collect(),
      ctx.db.query("userPreferences").collect(),
      ctx.db.query("auditLogs").collect(),
    ]);

    return {
      totalUsers: users.length,
      totalMemories: memories.length,
      totalDays: days.length,
      totalSummaries: summaries.length,
      totalIntegrations: integrations.length,
      totalPreferences: preferences.length,
      totalAuditLogs: auditLogs.length,
    };
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
    const id = await ctx.db.insert("user", {
      clerkUserId: args.clerkUserId,
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      isAdmin: args.isAdmin,
    });
    await logAdminAction(ctx, admin._id, "create_user", args.email);
    return await ctx.db.get(id);
  },
});

export const listAllUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("user").withIndex("by_email").take(200);
  },
});

export const listUsersPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("user")
      .withIndex("by_email")
      .paginate(args.paginationOpts);
  },
});

export const adminGetUser = query({
  args: { userId: v.id("user") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    return user;
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
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    const updates: Record<string, unknown> = {};
    if (args.email !== undefined) updates.email = args.email;
    if (args.firstName !== undefined) updates.firstName = args.firstName;
    if (args.lastName !== undefined) updates.lastName = args.lastName;
    if (args.isAdmin !== undefined) updates.isAdmin = args.isAdmin;

    await ctx.db.patch(args.userId, updates);
    await logAdminAction(ctx, admin._id, "update_user", args.userId);
    return await ctx.db.get(args.userId);
  },
});

export const adminDeleteUser = mutation({
  args: { userId: v.id("user") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    // Cascade: delete all memories and their media
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user_day", (q) => q.eq("userId", args.userId))
      .collect();
    for (const memory of memories) {
      const media = await ctx.db
        .query("memoryMedia")
        .withIndex("by_memory", (q) => q.eq("memoryId", memory._id))
        .collect();
      for (const m of media) {
        try {
          await ctx.storage.delete(m.storageId as any);
        } catch {
          // Storage blob may already be gone — continue cleanup
        }
        await ctx.db.delete(m._id);
      }
      await ctx.db.delete(memory._id);
    }

    // Cascade: delete all days
    const days = await ctx.db
      .query("days")
      .withIndex("by_user_day", (q) => q.eq("userId", args.userId))
      .collect();
    for (const day of days) {
      await ctx.db.delete(day._id);
    }

    // Cascade: delete all day summaries
    const summaries = await ctx.db
      .query("daySummaries")
      .withIndex("by_user_day", (q) => q.eq("userId", args.userId))
      .collect();
    for (const summary of summaries) {
      await ctx.db.delete(summary._id);
    }

    // Cascade: delete all integrations
    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) => q.eq("userId", args.userId))
      .collect();
    for (const integration of integrations) {
      await ctx.db.delete(integration._id);
    }

    // Cascade: delete user preferences (keyed by clerkUserId)
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", user.clerkUserId))
      .collect();
    for (const pref of prefs) {
      await ctx.db.delete(pref._id);
    }

    // Cascade: delete audit logs by this user
    const auditLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_actor", (q) => q.eq("actorUserId", args.userId))
      .collect();
    for (const log of auditLogs) {
      await ctx.db.delete(log._id);
    }

    // Cascade: delete summary quota counters for this user
    const quotas = await ctx.db
      .query("summaryGenerationQuotas")
      .withIndex("by_user_day", (q) => q.eq("userId", args.userId))
      .collect();
    for (const quota of quotas) {
      await ctx.db.delete(quota._id);
    }

    // Cascade: delete normalized integration sync data for this user
    const integrationDailyData = await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_day", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of integrationDailyData) {
      await ctx.db.delete(row._id);
    }

    // Cascade: delete integration secrets for this user
    const integrationSecrets = await ctx.db
      .query("integrationSecrets")
      .withIndex("by_user_provider", (q) => q.eq("userId", args.userId))
      .collect();
    for (const secret of integrationSecrets) {
      await ctx.db.delete(secret._id);
    }

    // Cascade: delete integration sync runs for this user
    const integrationSyncRuns = await ctx.db
      .query("integrationSyncRuns")
      .withIndex("by_user_provider", (q) => q.eq("userId", args.userId))
      .collect();
    for (const run of integrationSyncRuns) {
      await ctx.db.delete(run._id);
    }

    await ctx.db.delete(args.userId);
    await logAdminAction(ctx, admin._id, "delete_user", user.email);
    return { success: true };
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
    await logAdminAction(ctx, admin._id, "create_preference", args.clerkUserId);
    return await ctx.db.get(id);
  },
});

export const listAllUserPreferences = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(200);

    // Join user email from the user table via clerkUserId
    return await Promise.all(
      prefs.map(async (pref) => {
        const user = await ctx.db
          .query("user")
          .withIndex("by_clerkUserId", (q) =>
            q.eq("clerkUserId", pref.clerkUserId),
          )
          .unique();
        return { ...pref, email: user?.email ?? null };
      }),
    );
  },
});

export const listUserPreferencesPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const page = await ctx.db
      .query("userPreferences")
      .withIndex("by_updatedAt")
      .order("desc")
      .paginate(args.paginationOpts);

    const pageWithUserEmail = await Promise.all(
      page.page.map(async (pref) => {
        const user = await ctx.db
          .query("user")
          .withIndex("by_clerkUserId", (q) =>
            q.eq("clerkUserId", pref.clerkUserId),
          )
          .unique();
        return { ...pref, email: user?.email ?? null };
      }),
    );

    return {
      ...page,
      page: pageWithUserEmail,
    };
  },
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
    const id = await ctx.db.insert("memories", {
      userId: args.userId,
      title: args.title,
      description: args.description,
      mood: args.mood,
      happenedAt: args.happenedAt,
      dayKey: args.dayKey,
    });
    await logAdminAction(ctx, admin._id, "create_memory", args.title);
    return await ctx.db.get(id);
  },
});

export const listAllMemories = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("memories")
      .withIndex("by_happenedAt")
      .order("desc")
      .take(200);
  },
});

export const listMemoriesPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    dayKey: v.optional(v.string()),
    userId: v.optional(v.id("user")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    if (args.userId) {
      return await ctx.db
        .query("memories")
        .withIndex("by_user_happenedAt", (q) => q.eq("userId", args.userId!))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    if (args.dayKey) {
      return await ctx.db
        .query("memories")
        .withIndex("by_day_happenedAt", (q) => q.eq("dayKey", args.dayKey!))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return await ctx.db
      .query("memories")
      .withIndex("by_happenedAt")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const adminGetMemory = query({
  args: { memoryId: v.id("memories") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new Error("Memory not found");
    return memory;
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

    const updates: Record<string, unknown> = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.mood !== undefined) updates.mood = args.mood;
    if (args.happenedAt !== undefined) updates.happenedAt = args.happenedAt;
    if (args.dayKey !== undefined) updates.dayKey = args.dayKey;

    await ctx.db.patch(args.memoryId, updates);
    await logAdminAction(
      ctx,
      admin._id,
      "update_memory",
      String(args.memoryId),
    );
    return await ctx.db.get(args.memoryId);
  },
});

export const adminDeleteMemory = mutation({
  args: { memoryId: v.id("memories") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new Error("Memory not found");

    // Cascade delete media (DB rows + storage blobs)
    const media = await ctx.db
      .query("memoryMedia")
      .withIndex("by_memory", (q) => q.eq("memoryId", args.memoryId))
      .collect();
    for (const m of media) {
      try {
        await ctx.storage.delete(m.storageId as any);
      } catch {
        // Storage blob may already be gone — continue cleanup
      }
      await ctx.db.delete(m._id);
    }

    await ctx.db.delete(args.memoryId);
    await logAdminAction(ctx, admin._id, "delete_memory", memory.title);
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
    const id = await ctx.db.insert("days", {
      userId: args.userId,
      dayKey: args.dayKey,
      rating: args.rating,
      manualNotes: args.manualNotes,
      peopleTags: args.peopleTags,
    });
    await logAdminAction(ctx, admin._id, "create_day", args.dayKey);
    return await ctx.db.get(id);
  },
});

export const listAllDays = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("days")
      .withIndex("by_dayKey")
      .order("desc")
      .take(200);
  },
});

export const listDaysPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    dayKey: v.optional(v.string()),
    userId: v.optional(v.id("user")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    if (args.userId && args.dayKey) {
      return await ctx.db
        .query("days")
        .withIndex("by_user_day", (q) =>
          q.eq("userId", args.userId!).eq("dayKey", args.dayKey!),
        )
        .paginate(args.paginationOpts);
    }

    if (args.userId) {
      return await ctx.db
        .query("days")
        .withIndex("by_user_day", (q) => q.eq("userId", args.userId!))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    if (args.dayKey) {
      return await ctx.db
        .query("days")
        .withIndex("by_dayKey", (q) => q.eq("dayKey", args.dayKey!))
        .paginate(args.paginationOpts);
    }

    return await ctx.db
      .query("days")
      .withIndex("by_dayKey")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const adminGetDay = query({
  args: { dayId: v.id("days") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const day = await ctx.db.get(args.dayId);
    if (!day) throw new Error("Day not found");
    return day;
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

    const updates: Record<string, unknown> = {};
    if (args.dayKey !== undefined) updates.dayKey = args.dayKey;
    if (args.rating !== undefined) updates.rating = args.rating;
    if (args.manualNotes !== undefined) updates.manualNotes = args.manualNotes;
    if (args.peopleTags !== undefined) updates.peopleTags = args.peopleTags;

    await ctx.db.patch(args.dayId, updates);
    await logAdminAction(ctx, admin._id, "update_day", String(args.dayId));
    return await ctx.db.get(args.dayId);
  },
});

export const adminDeleteDay = mutation({
  args: { dayId: v.id("days") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const day = await ctx.db.get(args.dayId);
    if (!day) throw new Error("Day not found");

    // Cascade: delete summaries for this day
    const summaries = await ctx.db
      .query("daySummaries")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", day.userId).eq("dayKey", day.dayKey),
      )
      .collect();
    for (const summary of summaries) {
      await ctx.db.delete(summary._id);
    }

    // Cascade: delete memories for this day (and their media)
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", day.userId).eq("dayKey", day.dayKey),
      )
      .collect();
    for (const memory of memories) {
      const media = await ctx.db
        .query("memoryMedia")
        .withIndex("by_memory", (q) => q.eq("memoryId", memory._id))
        .collect();
      for (const m of media) {
        try {
          await ctx.storage.delete(m.storageId as any);
        } catch {
          // Storage blob may already be gone — continue cleanup
        }
        await ctx.db.delete(m._id);
      }
      await ctx.db.delete(memory._id);
    }

    await ctx.db.delete(args.dayId);
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
    const id = await ctx.db.insert("daySummaries", {
      userId: args.userId,
      dayKey: args.dayKey,
      story: args.story,
      highlights: args.highlights,
      sourcesUsed: args.sourcesUsed,
      generatedAt: Date.now(),
    });
    await logAdminAction(ctx, admin._id, "create_summary", args.dayKey);
    return await ctx.db.get(id);
  },
});

export const listAllSummaries = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("daySummaries")
      .withIndex("by_generatedAt")
      .order("desc")
      .take(200);
  },
});

export const listSummariesPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    dayKey: v.optional(v.string()),
    userId: v.optional(v.id("user")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    if (args.userId && args.dayKey) {
      return await ctx.db
        .query("daySummaries")
        .withIndex("by_user_day", (q) =>
          q.eq("userId", args.userId!).eq("dayKey", args.dayKey!),
        )
        .paginate(args.paginationOpts);
    }

    if (args.userId) {
      return await ctx.db
        .query("daySummaries")
        .withIndex("by_user_generatedAt", (q) => q.eq("userId", args.userId!))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    if (args.dayKey) {
      return await ctx.db
        .query("daySummaries")
        .withIndex("by_day_generatedAt", (q) => q.eq("dayKey", args.dayKey!))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return await ctx.db
      .query("daySummaries")
      .withIndex("by_generatedAt")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const adminGetSummary = query({
  args: { summaryId: v.id("daySummaries") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const summary = await ctx.db.get(args.summaryId);
    if (!summary) throw new Error("Summary not found");
    return summary;
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

    const updates: Record<string, unknown> = {};
    if (args.dayKey !== undefined) updates.dayKey = args.dayKey;
    if (args.story !== undefined) updates.story = args.story;
    if (args.highlights !== undefined) updates.highlights = args.highlights;
    if (args.sourcesUsed !== undefined) updates.sourcesUsed = args.sourcesUsed;
    updates.generatedAt = Date.now();

    await ctx.db.patch(args.summaryId, updates);
    await logAdminAction(
      ctx,
      admin._id,
      "update_summary",
      String(args.summaryId),
    );
    return await ctx.db.get(args.summaryId);
  },
});

export const adminDeleteSummary = mutation({
  args: { summaryId: v.id("daySummaries") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const summary = await ctx.db.get(args.summaryId);
    if (!summary) throw new Error("Summary not found");
    await ctx.db.delete(args.summaryId);
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

    const nextTokenRef: string | undefined =
      args.tokenRef && !args.tokenRef.startsWith(OPAQUE_TOKEN_REF_PREFIX)
        ? (await ctx.runMutation(internal.integrations.storeIntegrationSecretInternal, {
            userId: args.userId,
            provider: args.provider,
            accessToken: args.tokenRef,
          }))
        : args.tokenRef;

    const id: Id<"integrations"> = await ctx.db.insert("integrations", {
      userId: args.userId,
      provider: args.provider,
      status: args.status,
      scopes: args.scopes,
      tokenRef: nextTokenRef,
    });
    await logAdminAction(ctx, admin._id, "create_integration", args.provider);
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
    await requireAdmin(ctx);

    if (args.status && args.provider) {
      return await ctx.db
        .query("integrations")
        .withIndex("by_status_provider", (q) =>
          q.eq("status", args.status!).eq("provider", args.provider!),
        )
        .paginate(args.paginationOpts);
    }

    if (args.status) {
      return await ctx.db
        .query("integrations")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .paginate(args.paginationOpts);
    }

    if (args.provider) {
      return await ctx.db
        .query("integrations")
        .withIndex("by_provider", (q) => q.eq("provider", args.provider!))
        .paginate(args.paginationOpts);
    }

    return await ctx.db
      .query("integrations")
      .withIndex("by_provider")
      .paginate(args.paginationOpts);
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

    const updates: Record<string, unknown> = {};
    if (args.provider !== undefined) updates.provider = args.provider;
    if (args.status !== undefined) updates.status = args.status;
    if (args.scopes !== undefined) updates.scopes = args.scopes;
    if (args.tokenRef !== undefined) {
      if (
        args.tokenRef &&
        !args.tokenRef.startsWith(OPAQUE_TOKEN_REF_PREFIX)
      ) {
        const nextProvider = args.provider ?? integration.provider;
        updates.tokenRef = await ctx.runMutation(
          internal.integrations.storeIntegrationSecretInternal,
          {
            userId: integration.userId,
            provider: nextProvider,
            accessToken: args.tokenRef,
            existingTokenRef: integration.tokenRef,
          },
        );
      } else {
        updates.tokenRef = args.tokenRef;
      }
    }

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

    const linkedDailyRows = await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", integration.userId).eq("provider", integration.provider),
      )
      .collect();
    for (const row of linkedDailyRows) {
      await ctx.db.delete(row._id);
    }

    const tokenRef = integration.tokenRef;
    if (tokenRef && tokenRef.startsWith(OPAQUE_TOKEN_REF_PREFIX)) {
      const secret = await ctx.db
        .query("integrationSecrets")
        .withIndex("by_tokenRef", (q) => q.eq("tokenRef", tokenRef))
        .unique();
      if (secret) {
        await ctx.db.delete(secret._id);
      }
    }

    const syncRuns = await ctx.db
      .query("integrationSyncRuns")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", integration.userId).eq("provider", integration.provider),
      )
      .collect();
    for (const run of syncRuns) {
      await ctx.db.delete(run._id);
    }

    await ctx.db.delete(args.integrationId);
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
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_at")
      .order("desc")
      .take(limit);
  },
});

export const listAuditLogsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    actorUserId: v.optional(v.id("user")),
    action: v.optional(v.string()),
    fromTs: v.optional(v.number()),
    toTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    let page;

    if (args.actorUserId) {
      page = await ctx.db
        .query("auditLogs")
        .withIndex("by_actor_at", (q) => q.eq("actorUserId", args.actorUserId!))
        .order("desc")
        .paginate(args.paginationOpts);
    } else if (args.action) {
      page = await ctx.db
        .query("auditLogs")
        .withIndex("by_action_at", (q) => q.eq("action", args.action!))
        .order("desc")
        .paginate(args.paginationOpts);
    } else {
      page = await ctx.db
        .query("auditLogs")
        .withIndex("by_at")
        .order("desc")
        .paginate(args.paginationOpts);
    }

    const filteredPage = page.page.filter((row) => {
      if (args.action && row.action !== args.action) return false;
      if (args.fromTs !== undefined && row.at < args.fromTs) return false;
      if (args.toTs !== undefined && row.at > args.toTs) return false;
      return true;
    });

    return {
      ...page,
      page: filteredPage,
    };
  },
});

export const writeAuditLog = mutation({
  args: {
    action: v.string(),
    target: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const id = await ctx.db.insert("auditLogs", {
      actorUserId: admin._id,
      action: args.action,
      target: args.target,
      at: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

export const adminDeleteAuditLog = mutation({
  args: { auditLogId: v.id("auditLogs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const log = await ctx.db.get(args.auditLogId);
    if (!log) throw new Error("Audit log not found");
    await ctx.db.delete(args.auditLogId);
    return { success: true };
  },
});
