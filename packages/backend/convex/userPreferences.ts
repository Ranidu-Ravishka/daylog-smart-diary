import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  getCurrentUser,
  requireUser,
  requireAdmin,
  requireIdentityMatch,
} from "./authz";
import { applyDashboardMetricsDelta } from "./dashboardMetrics";

const preferenceThemeValidator = v.union(
  v.literal("light"),
  v.literal("dark"),
  v.literal("system"),
);

const locationPermissionStatusValidator = v.union(
  v.literal("unknown"),
  v.literal("granted"),
  v.literal("denied"),
);

const defaultPreferenceSettings = {
  theme: "system" as const,
  notificationsEnabled: true,
  dailySummaryEnabled: true,
  weeklyInsightsEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  autoSyncIntegrations: true,
  defaultMemoryMood: "happy",
  locationTrackingEnabled: false,
  callLogsTrackingEnabled: false,
  moodDetectionFaceRecognitionEnabled: false,
  fitnessTrackingEnabled: false,
  calendarNotificationsTrackingEnabled: false,
  backgroundLocationTrackingEnabled: false,
  locationPermissionStatus: "unknown" as const,
};

const canonicalFocusAreaIds = new Set([0, 1, 2, 3, 4]);

function normalizeFocusAreas(focusAreas: number[]): number[] {
  const normalized: number[] = [];

  for (const focusAreaId of focusAreas) {
    const mappedFocusAreaId = focusAreaId === 5 ? 4 : focusAreaId;
    if (!canonicalFocusAreaIds.has(mappedFocusAreaId)) continue;
    if (!normalized.includes(mappedFocusAreaId)) {
      normalized.push(mappedFocusAreaId);
    }
  }

  return normalized;
}

function normalizePreferenceDoc<T extends { focusAreas: number[] } | null>(
  preferenceDoc: T,
): T {
  if (!preferenceDoc) return preferenceDoc;

  return {
    ...preferenceDoc,
    focusAreas: normalizeFocusAreas(preferenceDoc.focusAreas),
  };
}

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
    quietHoursStart: v.optional(v.string()),
    quietHoursEnd: v.optional(v.string()),
    autoSyncIntegrations: v.optional(v.boolean()),
    defaultMemoryMood: v.optional(v.string()),
    locationTrackingEnabled: v.optional(v.boolean()),
    callLogsTrackingEnabled: v.optional(v.boolean()),
    moodDetectionFaceRecognitionEnabled: v.optional(v.boolean()),
    fitnessTrackingEnabled: v.optional(v.boolean()),
    calendarNotificationsTrackingEnabled: v.optional(v.boolean()),
    backgroundLocationTrackingEnabled: v.optional(v.boolean()),
    locationPermissionStatus: v.optional(locationPermissionStatusValidator),
    locationLastUpdatedAt: v.optional(v.number()),
    locationLastArea: v.optional(v.string()),
    backgroundLocationAutoDisabledAt: v.optional(v.number()),
    backgroundLocationAutoDisableReason: v.optional(v.string()),
    backgroundLocationBatteryImpactScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireIdentityMatch(ctx, args.clerkUserId);
    const normalizedFocusAreas = normalizeFocusAreas(args.focusAreas);

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        focusAreas: normalizedFocusAreas,
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
        quietHoursStart:
          args.quietHoursStart ??
          existing.quietHoursStart ??
          defaultPreferenceSettings.quietHoursStart,
        quietHoursEnd:
          args.quietHoursEnd ??
          existing.quietHoursEnd ??
          defaultPreferenceSettings.quietHoursEnd,
        autoSyncIntegrations:
          args.autoSyncIntegrations ??
          existing.autoSyncIntegrations ??
          defaultPreferenceSettings.autoSyncIntegrations,
        defaultMemoryMood:
          args.defaultMemoryMood ??
          existing.defaultMemoryMood ??
          defaultPreferenceSettings.defaultMemoryMood,
        locationTrackingEnabled:
          args.locationTrackingEnabled ??
          existing.locationTrackingEnabled ??
          defaultPreferenceSettings.locationTrackingEnabled,
        callLogsTrackingEnabled:
          args.callLogsTrackingEnabled ??
          existing.callLogsTrackingEnabled ??
          defaultPreferenceSettings.callLogsTrackingEnabled,
        moodDetectionFaceRecognitionEnabled:
          args.moodDetectionFaceRecognitionEnabled ??
          existing.moodDetectionFaceRecognitionEnabled ??
          defaultPreferenceSettings.moodDetectionFaceRecognitionEnabled,
        fitnessTrackingEnabled:
          args.fitnessTrackingEnabled ??
          existing.fitnessTrackingEnabled ??
          defaultPreferenceSettings.fitnessTrackingEnabled,
        calendarNotificationsTrackingEnabled:
          args.calendarNotificationsTrackingEnabled ??
          existing.calendarNotificationsTrackingEnabled ??
          defaultPreferenceSettings.calendarNotificationsTrackingEnabled,
        backgroundLocationTrackingEnabled:
          args.backgroundLocationTrackingEnabled ??
          existing.backgroundLocationTrackingEnabled ??
          defaultPreferenceSettings.backgroundLocationTrackingEnabled,
        locationPermissionStatus:
          args.locationPermissionStatus ??
          existing.locationPermissionStatus ??
          defaultPreferenceSettings.locationPermissionStatus,
        locationLastUpdatedAt:
          args.locationLastUpdatedAt ?? existing.locationLastUpdatedAt,
        locationLastArea: args.locationLastArea ?? existing.locationLastArea,
        backgroundLocationAutoDisabledAt:
          args.backgroundLocationAutoDisabledAt ??
          existing.backgroundLocationAutoDisabledAt,
        backgroundLocationAutoDisableReason:
          args.backgroundLocationAutoDisableReason ??
          existing.backgroundLocationAutoDisableReason,
        backgroundLocationBatteryImpactScore:
          args.backgroundLocationBatteryImpactScore ??
          existing.backgroundLocationBatteryImpactScore,
        updatedAt: now,
      });

      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("userPreferences", {
      clerkUserId: args.clerkUserId,
      focusAreas: normalizedFocusAreas,
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
      quietHoursStart:
        args.quietHoursStart ?? defaultPreferenceSettings.quietHoursStart,
      quietHoursEnd:
        args.quietHoursEnd ?? defaultPreferenceSettings.quietHoursEnd,
      autoSyncIntegrations:
        args.autoSyncIntegrations ??
        defaultPreferenceSettings.autoSyncIntegrations,
      defaultMemoryMood:
        args.defaultMemoryMood ?? defaultPreferenceSettings.defaultMemoryMood,
      locationTrackingEnabled:
        args.locationTrackingEnabled ??
        defaultPreferenceSettings.locationTrackingEnabled,
      callLogsTrackingEnabled:
        args.callLogsTrackingEnabled ??
        defaultPreferenceSettings.callLogsTrackingEnabled,
      moodDetectionFaceRecognitionEnabled:
        args.moodDetectionFaceRecognitionEnabled ??
        defaultPreferenceSettings.moodDetectionFaceRecognitionEnabled,
      fitnessTrackingEnabled:
        args.fitnessTrackingEnabled ??
        defaultPreferenceSettings.fitnessTrackingEnabled,
      calendarNotificationsTrackingEnabled:
        args.calendarNotificationsTrackingEnabled ??
        defaultPreferenceSettings.calendarNotificationsTrackingEnabled,
      backgroundLocationTrackingEnabled:
        args.backgroundLocationTrackingEnabled ??
        defaultPreferenceSettings.backgroundLocationTrackingEnabled,
      locationPermissionStatus:
        args.locationPermissionStatus ??
        defaultPreferenceSettings.locationPermissionStatus,
      locationLastUpdatedAt: args.locationLastUpdatedAt,
      locationLastArea: args.locationLastArea,
      backgroundLocationAutoDisabledAt: args.backgroundLocationAutoDisabledAt,
      backgroundLocationAutoDisableReason:
        args.backgroundLocationAutoDisableReason,
      backgroundLocationBatteryImpactScore:
        args.backgroundLocationBatteryImpactScore,
      createdAt: now,
      updatedAt: now,
    });

    await applyDashboardMetricsDelta(ctx.db, {
      totalPreferences: 1,
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

    const preferenceDoc = await ctx.db
      .query("userPreferences")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    return normalizePreferenceDoc(preferenceDoc);
  },
});

// ── List all user preferences (admin-only).
export const listUserPreferences = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const preferenceDocs = await ctx.db.query("userPreferences").collect();
    return preferenceDocs.map((preferenceDoc) =>
      normalizePreferenceDoc(preferenceDoc),
    );
  },
});

// ── Get the authenticated user's own preferences.
//    Returns null if not signed in (safe for pre-auth screens).
export const getMyUserPreferences = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const preferenceDoc = await ctx.db
      .query("userPreferences")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", user.clerkUserId))
      .unique();

    return normalizePreferenceDoc(preferenceDoc);
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
    quietHoursStart: v.optional(v.string()),
    quietHoursEnd: v.optional(v.string()),
    autoSyncIntegrations: v.optional(v.boolean()),
    defaultMemoryMood: v.optional(v.string()),
    locationTrackingEnabled: v.optional(v.boolean()),
    callLogsTrackingEnabled: v.optional(v.boolean()),
    moodDetectionFaceRecognitionEnabled: v.optional(v.boolean()),
    fitnessTrackingEnabled: v.optional(v.boolean()),
    calendarNotificationsTrackingEnabled: v.optional(v.boolean()),
    backgroundLocationTrackingEnabled: v.optional(v.boolean()),
    locationPermissionStatus: v.optional(locationPermissionStatusValidator),
    locationLastUpdatedAt: v.optional(v.number()),
    locationLastArea: v.optional(v.string()),
    backgroundLocationAutoDisabledAt: v.optional(v.number()),
    backgroundLocationAutoDisableReason: v.optional(v.string()),
    backgroundLocationBatteryImpactScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const normalizedFocusAreas = normalizeFocusAreas(args.focusAreas);

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", user.clerkUserId))
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        focusAreas: normalizedFocusAreas,
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
        quietHoursStart:
          args.quietHoursStart ??
          existing.quietHoursStart ??
          defaultPreferenceSettings.quietHoursStart,
        quietHoursEnd:
          args.quietHoursEnd ??
          existing.quietHoursEnd ??
          defaultPreferenceSettings.quietHoursEnd,
        autoSyncIntegrations:
          args.autoSyncIntegrations ??
          existing.autoSyncIntegrations ??
          defaultPreferenceSettings.autoSyncIntegrations,
        defaultMemoryMood:
          args.defaultMemoryMood ??
          existing.defaultMemoryMood ??
          defaultPreferenceSettings.defaultMemoryMood,
        locationTrackingEnabled:
          args.locationTrackingEnabled ??
          existing.locationTrackingEnabled ??
          defaultPreferenceSettings.locationTrackingEnabled,
        callLogsTrackingEnabled:
          args.callLogsTrackingEnabled ??
          existing.callLogsTrackingEnabled ??
          defaultPreferenceSettings.callLogsTrackingEnabled,
        moodDetectionFaceRecognitionEnabled:
          args.moodDetectionFaceRecognitionEnabled ??
          existing.moodDetectionFaceRecognitionEnabled ??
          defaultPreferenceSettings.moodDetectionFaceRecognitionEnabled,
        fitnessTrackingEnabled:
          args.fitnessTrackingEnabled ??
          existing.fitnessTrackingEnabled ??
          defaultPreferenceSettings.fitnessTrackingEnabled,
        calendarNotificationsTrackingEnabled:
          args.calendarNotificationsTrackingEnabled ??
          existing.calendarNotificationsTrackingEnabled ??
          defaultPreferenceSettings.calendarNotificationsTrackingEnabled,
        backgroundLocationTrackingEnabled:
          args.backgroundLocationTrackingEnabled ??
          existing.backgroundLocationTrackingEnabled ??
          defaultPreferenceSettings.backgroundLocationTrackingEnabled,
        locationPermissionStatus:
          args.locationPermissionStatus ??
          existing.locationPermissionStatus ??
          defaultPreferenceSettings.locationPermissionStatus,
        locationLastUpdatedAt:
          args.locationLastUpdatedAt ?? existing.locationLastUpdatedAt,
        locationLastArea: args.locationLastArea ?? existing.locationLastArea,
        backgroundLocationAutoDisabledAt:
          args.backgroundLocationAutoDisabledAt ??
          existing.backgroundLocationAutoDisabledAt,
        backgroundLocationAutoDisableReason:
          args.backgroundLocationAutoDisableReason ??
          existing.backgroundLocationAutoDisableReason,
        backgroundLocationBatteryImpactScore:
          args.backgroundLocationBatteryImpactScore ??
          existing.backgroundLocationBatteryImpactScore,
        updatedAt: now,
      });

      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("userPreferences", {
      clerkUserId: user.clerkUserId,
      focusAreas: normalizedFocusAreas,
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
      quietHoursStart:
        args.quietHoursStart ?? defaultPreferenceSettings.quietHoursStart,
      quietHoursEnd:
        args.quietHoursEnd ?? defaultPreferenceSettings.quietHoursEnd,
      autoSyncIntegrations:
        args.autoSyncIntegrations ??
        defaultPreferenceSettings.autoSyncIntegrations,
      defaultMemoryMood:
        args.defaultMemoryMood ?? defaultPreferenceSettings.defaultMemoryMood,
      locationTrackingEnabled:
        args.locationTrackingEnabled ??
        defaultPreferenceSettings.locationTrackingEnabled,
      callLogsTrackingEnabled:
        args.callLogsTrackingEnabled ??
        defaultPreferenceSettings.callLogsTrackingEnabled,
      moodDetectionFaceRecognitionEnabled:
        args.moodDetectionFaceRecognitionEnabled ??
        defaultPreferenceSettings.moodDetectionFaceRecognitionEnabled,
      fitnessTrackingEnabled:
        args.fitnessTrackingEnabled ??
        defaultPreferenceSettings.fitnessTrackingEnabled,
      calendarNotificationsTrackingEnabled:
        args.calendarNotificationsTrackingEnabled ??
        defaultPreferenceSettings.calendarNotificationsTrackingEnabled,
      backgroundLocationTrackingEnabled:
        args.backgroundLocationTrackingEnabled ??
        defaultPreferenceSettings.backgroundLocationTrackingEnabled,
      locationPermissionStatus:
        args.locationPermissionStatus ??
        defaultPreferenceSettings.locationPermissionStatus,
      locationLastUpdatedAt: args.locationLastUpdatedAt,
      locationLastArea: args.locationLastArea,
      backgroundLocationAutoDisabledAt: args.backgroundLocationAutoDisabledAt,
      backgroundLocationAutoDisableReason:
        args.backgroundLocationAutoDisableReason,
      backgroundLocationBatteryImpactScore:
        args.backgroundLocationBatteryImpactScore,
      createdAt: now,
      updatedAt: now,
    });

    await applyDashboardMetricsDelta(ctx.db, {
      totalPreferences: 1,
    });

    return await ctx.db.get(id);
  },
});

export const updateMyLocationTrackingState = mutation({
  args: {
    locationTrackingEnabled: v.optional(v.boolean()),
    callLogsTrackingEnabled: v.optional(v.boolean()),
    moodDetectionFaceRecognitionEnabled: v.optional(v.boolean()),
    fitnessTrackingEnabled: v.optional(v.boolean()),
    calendarNotificationsTrackingEnabled: v.optional(v.boolean()),
    backgroundLocationTrackingEnabled: v.optional(v.boolean()),
    locationPermissionStatus: v.optional(locationPermissionStatusValidator),
    locationLastUpdatedAt: v.optional(v.number()),
    locationLastArea: v.optional(v.string()),
    backgroundLocationAutoDisabledAt: v.optional(v.number()),
    backgroundLocationAutoDisableReason: v.optional(v.string()),
    backgroundLocationBatteryImpactScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", user.clerkUserId))
      .unique();

    if (!existing) return null;

    await ctx.db.patch(existing._id, {
      locationTrackingEnabled:
        args.locationTrackingEnabled ?? existing.locationTrackingEnabled,
      callLogsTrackingEnabled:
        args.callLogsTrackingEnabled ?? existing.callLogsTrackingEnabled,
      moodDetectionFaceRecognitionEnabled:
        args.moodDetectionFaceRecognitionEnabled ??
        existing.moodDetectionFaceRecognitionEnabled,
      fitnessTrackingEnabled:
        args.fitnessTrackingEnabled ?? existing.fitnessTrackingEnabled,
      calendarNotificationsTrackingEnabled:
        args.calendarNotificationsTrackingEnabled ??
        existing.calendarNotificationsTrackingEnabled,
      backgroundLocationTrackingEnabled:
        args.backgroundLocationTrackingEnabled ??
        existing.backgroundLocationTrackingEnabled,
      locationPermissionStatus:
        args.locationPermissionStatus ?? existing.locationPermissionStatus,
      locationLastUpdatedAt:
        args.locationLastUpdatedAt ?? existing.locationLastUpdatedAt,
      locationLastArea: args.locationLastArea ?? existing.locationLastArea,
      backgroundLocationAutoDisabledAt:
        args.backgroundLocationAutoDisabledAt ??
        existing.backgroundLocationAutoDisabledAt,
      backgroundLocationAutoDisableReason:
        args.backgroundLocationAutoDisableReason ??
        existing.backgroundLocationAutoDisableReason,
      backgroundLocationBatteryImpactScore:
        args.backgroundLocationBatteryImpactScore ??
        existing.backgroundLocationBatteryImpactScore,
      updatedAt: Date.now(),
    });

    return await ctx.db.get(existing._id);
  },
});
