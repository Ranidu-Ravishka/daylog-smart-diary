import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser, requireOwnership } from "./authz";
import { validateDayKey, validateRating, clampLimit } from "./validators";
import { deleteDayCascadeData } from "./cascadeCleanup";
import { applyDashboardMetricsDelta } from "./dashboardMetrics";

// ── Get or create a day record ──────────────────────────────
export const upsertDay = mutation({
  args: {
    dayKey: v.string(),
    rating: v.optional(v.number()),
    manualNotes: v.optional(v.array(v.string())),
    peopleTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    validateDayKey(args.dayKey);
    if (args.rating !== undefined) validateRating(args.rating);

    const existing = await ctx.db
      .query("days")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .unique();

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (args.rating !== undefined) updates.rating = args.rating;
      if (args.manualNotes !== undefined)
        updates.manualNotes = args.manualNotes;
      if (args.peopleTags !== undefined) updates.peopleTags = args.peopleTags;

      await ctx.db.patch(existing._id, updates);
      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("days", {
      userId: user._id,
      dayKey: args.dayKey,
      rating: args.rating,
      manualNotes: args.manualNotes,
      peopleTags: args.peopleTags,
    });

    await applyDashboardMetricsDelta(ctx.db, {
      totalDays: 1,
    });

    return await ctx.db.get(id);
  },
});

// ── Get a single day record ─────────────────────────────────
export const getDay = query({
  args: {
    dayKey: v.string(),
    refreshToken: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    return await ctx.db
      .query("days")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .unique();
  },
});

// ── Get a day by its document ID ────────────────────────────
export const getDayById = query({
  args: { dayId: v.id("days") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const day = await ctx.db.get(args.dayId);

    if (!day) {
      throw new Error("Day not found");
    }

    requireOwnership(user, day.userId);
    return day;
  },
});

// ── List recent days (up to N) ──────────────────────────────
export const listRecentDays = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const limit = clampLimit(args.limit ?? 30);

    return await ctx.db
      .query("days")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
  },
});

// ── Update day rating ───────────────────────────────────────
export const updateDayRating = mutation({
  args: {
    dayKey: v.string(),
    rating: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    validateDayKey(args.dayKey);
    validateRating(args.rating);

    const day = await ctx.db
      .query("days")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .unique();

    if (!day) {
      const id = await ctx.db.insert("days", {
        userId: user._id,
        dayKey: args.dayKey,
        rating: args.rating,
      });

      await applyDashboardMetricsDelta(ctx.db, {
        totalDays: 1,
      });

      return await ctx.db.get(id);
    }

    await ctx.db.patch(day._id, { rating: args.rating });
    return await ctx.db.get(day._id);
  },
});

// ── Delete a day record ─────────────────────────────────────
export const deleteDay = mutation({
  args: { dayId: v.id("days") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const day = await ctx.db.get(args.dayId);

    if (!day) {
      throw new Error("Day not found");
    }

    requireOwnership(user, day.userId);

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

    return { success: true };
  },
});
