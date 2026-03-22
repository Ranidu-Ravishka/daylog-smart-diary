import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  getCurrentUser,
  requireUser,
  requireAdmin,
  requireIdentityMatch,
} from "./authz";

const preferenceThemeValidator = v.union(
  v.literal("light"),
  v.literal("dark"),
  v.literal("system"),
);

const defaultPreferenceSettings = {
  theme: "system" as const,
  notificationsEnabled: true,
  dailySummaryEnabled: true,
  weeklyInsightsEnabled: true,
  quietHoursEnabled: false,
  autoSyncIntegrations: true,
  defaultMemoryMood: "happy",
};

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
    theme: v.optional(preferenceThemeValidator),
    notificationsEnabled: v.optional(v.boolean()),
    dailySummaryEnabled: v.optional(v.boolean()),
    weeklyInsightsEnabled: v.optional(v.boolean()),
    quietHoursEnabled: v.optional(v.boolean()),
    autoSyncIntegrations: v.optional(v.boolean()),
    defaultMemoryMood: v.optional(v.string()),
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
        theme: args.theme ?? existing.theme ?? defaultPreferenceSettings.theme,
        notificationsEnabled:
          args.notificationsEnabled ??
          existing.notificationsEnabled ??
          defaultPreferenceSettings.notificationsEnabled,
        dailySummaryEnabled:
          args.dailySummaryEnabled ??
          existing.dailySummaryEnabled ??
          defaultPreferenceSettings.dailySummaryEnabled,
        weeklyInsightsEnabled:
          args.weeklyInsightsEnabled ??
          existing.weeklyInsightsEnabled ??
          defaultPreferenceSettings.weeklyInsightsEnabled,
        quietHoursEnabled:
          args.quietHoursEnabled ??
          existing.quietHoursEnabled ??
          defaultPreferenceSettings.quietHoursEnabled,
        autoSyncIntegrations:
          args.autoSyncIntegrations ??
          existing.autoSyncIntegrations ??
          defaultPreferenceSettings.autoSyncIntegrations,
        defaultMemoryMood:
          args.defaultMemoryMood ??
          existing.defaultMemoryMood ??
          defaultPreferenceSettings.defaultMemoryMood,
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
      theme: args.theme ?? defaultPreferenceSettings.theme,
      notificationsEnabled:
        args.notificationsEnabled ??
        defaultPreferenceSettings.notificationsEnabled,
      dailySummaryEnabled:
        args.dailySummaryEnabled ??
        defaultPreferenceSettings.dailySummaryEnabled,
      weeklyInsightsEnabled:
        args.weeklyInsightsEnabled ??
        defaultPreferenceSettings.weeklyInsightsEnabled,
      quietHoursEnabled:
        args.quietHoursEnabled ?? defaultPreferenceSettings.quietHoursEnabled,
      autoSyncIntegrations:
        args.autoSyncIntegrations ??
        defaultPreferenceSettings.autoSyncIntegrations,
      defaultMemoryMood:
        args.defaultMemoryMood ?? defaultPreferenceSettings.defaultMemoryMood,
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
    theme: v.optional(preferenceThemeValidator),
    notificationsEnabled: v.optional(v.boolean()),
    dailySummaryEnabled: v.optional(v.boolean()),
    weeklyInsightsEnabled: v.optional(v.boolean()),
    quietHoursEnabled: v.optional(v.boolean()),
    autoSyncIntegrations: v.optional(v.boolean()),
    defaultMemoryMood: v.optional(v.string()),
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
        theme: args.theme ?? existing.theme ?? defaultPreferenceSettings.theme,
        notificationsEnabled:
          args.notificationsEnabled ??
          existing.notificationsEnabled ??
          defaultPreferenceSettings.notificationsEnabled,
        dailySummaryEnabled:
          args.dailySummaryEnabled ??
          existing.dailySummaryEnabled ??
          defaultPreferenceSettings.dailySummaryEnabled,
        weeklyInsightsEnabled:
          args.weeklyInsightsEnabled ??
          existing.weeklyInsightsEnabled ??
          defaultPreferenceSettings.weeklyInsightsEnabled,
        quietHoursEnabled:
          args.quietHoursEnabled ??
          existing.quietHoursEnabled ??
          defaultPreferenceSettings.quietHoursEnabled,
        autoSyncIntegrations:
          args.autoSyncIntegrations ??
          existing.autoSyncIntegrations ??
          defaultPreferenceSettings.autoSyncIntegrations,
        defaultMemoryMood:
          args.defaultMemoryMood ??
          existing.defaultMemoryMood ??
          defaultPreferenceSettings.defaultMemoryMood,
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
      theme: args.theme ?? defaultPreferenceSettings.theme,
      notificationsEnabled:
        args.notificationsEnabled ??
        defaultPreferenceSettings.notificationsEnabled,
      dailySummaryEnabled:
        args.dailySummaryEnabled ??
        defaultPreferenceSettings.dailySummaryEnabled,
      weeklyInsightsEnabled:
        args.weeklyInsightsEnabled ??
        defaultPreferenceSettings.weeklyInsightsEnabled,
      quietHoursEnabled:
        args.quietHoursEnabled ?? defaultPreferenceSettings.quietHoursEnabled,
      autoSyncIntegrations:
        args.autoSyncIntegrations ??
        defaultPreferenceSettings.autoSyncIntegrations,
      defaultMemoryMood:
        args.defaultMemoryMood ?? defaultPreferenceSettings.defaultMemoryMood,
      createdAt: now,
      updatedAt: now,
    });

    return await ctx.db.get(id);
  },
});
