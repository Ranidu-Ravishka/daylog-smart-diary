import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  getCurrentUser,
  requireUser,
  requireAdmin,
  requireIdentityMatch,
} from "./authz";
import { applyDashboardMetricsDelta } from "./dashboardMetrics";
import {
  LOCATION_PERMISSION_STATUS_VALUES,
  USER_SETTINGS_THEME_VALUES,
  normalizeUserSettings,
  normalizeUserSettingsPatch,
  type UserSettingsDto,
} from "@repo/user-settings/lib/user-settings";

const preferenceThemeValidator = v.union(
  v.literal(USER_SETTINGS_THEME_VALUES[0]),
  v.literal(USER_SETTINGS_THEME_VALUES[1]),
  v.literal(USER_SETTINGS_THEME_VALUES[2]),
);

const locationPermissionStatusValidator = v.union(
  v.literal(LOCATION_PERMISSION_STATUS_VALUES[0]),
  v.literal(LOCATION_PERMISSION_STATUS_VALUES[1]),
  v.literal(LOCATION_PERMISSION_STATUS_VALUES[2]),
);

function resolveNextUserSettings(
  patchInput: Partial<UserSettingsDto>,
  existingPreferenceDoc?: Record<string, unknown> | null,
): UserSettingsDto {
  return {
    ...normalizeUserSettings(existingPreferenceDoc),
    ...normalizeUserSettingsPatch(patchInput),
  };
}

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

  const normalizedSettings = normalizeUserSettings(preferenceDoc);

  return {
    ...preferenceDoc,
    ...normalizedSettings,
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
    const nextSettings = resolveNextUserSettings(args, existing);

    if (existing) {
      await ctx.db.patch(existing._id, {
        focusAreas: normalizedFocusAreas,
        reminderType: args.reminderType,
        dailyTime: args.dailyTime,
        weeklyDay: args.weeklyDay,
        formattedTime: args.formattedTime,
        ...nextSettings,
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
      ...nextSettings,
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
    const nextSettings = resolveNextUserSettings(args, existing);

    if (existing) {
      await ctx.db.patch(existing._id, {
        focusAreas: normalizedFocusAreas,
        reminderType: args.reminderType,
        dailyTime: args.dailyTime,
        weeklyDay: args.weeklyDay,
        formattedTime: args.formattedTime,
        ...nextSettings,
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
      ...nextSettings,
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

    const nextSettings = resolveNextUserSettings(args, existing);

    await ctx.db.patch(existing._id, {
      ...nextSettings,
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
