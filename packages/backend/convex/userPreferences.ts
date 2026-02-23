import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  getCurrentUser,
  requireUser,
  requireAdmin,
  requireIdentityMatch,
} from "./authz";

// ── Sync preferences using an explicit clerkUserId arg.
//    Identity must match the arg (prevents horizontal escalation).
export const syncUserPreferencesFromClerk = mutation({
  args: {
    clerkUserId: v.string(),
    focusAreas: v.array(v.number()),
    reminderType: v.union(v.literal("daily"), v.literal("weekly")),
    dailyTime: v.string(),
    weeklyDay: v.string(),
    formattedTime: v.string(),
  },
  handler: async (ctx, args) => {
    await requireIdentityMatch(ctx, args.clerkUserId);

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        focusAreas: args.focusAreas,
        reminderType: args.reminderType,
        dailyTime: args.dailyTime,
        weeklyDay: args.weeklyDay,
        formattedTime: args.formattedTime,
        updatedAt: now,
      });

      return await ctx.db.get(existing._id);
    }

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

    return await ctx.db.get(id);
  },
});

// ── Get preferences by Clerk ID (admin-only — prevents
//    one user from reading another user's preferences).
export const getUserPreferencesByClerkId = query({
  args: {
    clerkUserId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    return await ctx.db
      .query("userPreferences")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();
  },
});

// ── List all user preferences (admin-only).
export const listUserPreferences = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("userPreferences").collect();
  },
});

// ── Get the authenticated user's own preferences.
//    Returns null if not signed in (safe for pre-auth screens).
export const getMyUserPreferences = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    return await ctx.db
      .query("userPreferences")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", user.clerkUserId))
      .unique();
  },
});

// ── Upsert the authenticated user's own preferences.
export const syncMyUserPreferences = mutation({
  args: {
    focusAreas: v.array(v.number()),
    reminderType: v.union(v.literal("daily"), v.literal("weekly")),
    dailyTime: v.string(),
    weeklyDay: v.string(),
    formattedTime: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", user.clerkUserId))
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        focusAreas: args.focusAreas,
        reminderType: args.reminderType,
        dailyTime: args.dailyTime,
        weeklyDay: args.weeklyDay,
        formattedTime: args.formattedTime,
        updatedAt: now,
      });

      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("userPreferences", {
      clerkUserId: user.clerkUserId,
      focusAreas: args.focusAreas,
      reminderType: args.reminderType,
      dailyTime: args.dailyTime,
      weeklyDay: args.weeklyDay,
      formattedTime: args.formattedTime,
      createdAt: now,
      updatedAt: now,
    });

    return await ctx.db.get(id);
  },
});
