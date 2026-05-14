import { z } from "zod";

export const TWENTY_FOUR_HOUR_TIME_REGEX = /^([01]\\d|2[0-3]):([0-5]\\d)$/;

export const USER_SETTINGS_THEME_VALUES = ["light", "dark", "system"] as const;

export const LOCATION_PERMISSION_STATUS_VALUES = [
  "unknown",
  "granted",
  "denied",
] as const;

export const MEMORY_MOOD_VALUES = [
  "happy",
  "peaceful",
  "excited",
  "loved",
  "sad",
  "angry",
  "anxious",
  "neutral",
] as const;

export type UserSettingsTheme = (typeof USER_SETTINGS_THEME_VALUES)[number];
export type LocationPermissionStatus =
  (typeof LOCATION_PERMISSION_STATUS_VALUES)[number];

export const userSettingsSchema = z.object({
  theme: z.enum(USER_SETTINGS_THEME_VALUES),
  notificationsEnabled: z.boolean(),
  dailySummaryEnabled: z.boolean(),
  weeklyInsightsEnabled: z.boolean(),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: z.string().regex(TWENTY_FOUR_HOUR_TIME_REGEX),
  quietHoursEnd: z.string().regex(TWENTY_FOUR_HOUR_TIME_REGEX),
  autoSyncIntegrations: z.boolean(),
  defaultMemoryMood: z.string().min(1),
  locationTrackingEnabled: z.boolean(),
  callLogsTrackingEnabled: z.boolean(),
  moodDetectionFaceRecognitionEnabled: z.boolean(),
  fitnessTrackingEnabled: z.boolean(),
  calendarNotificationsTrackingEnabled: z.boolean(),
  backgroundLocationTrackingEnabled: z.boolean(),
  locationPermissionStatus: z.enum(LOCATION_PERMISSION_STATUS_VALUES),
});

export const userSettingsPatchSchema = userSettingsSchema.partial();

export const lifeContextUserSettingsPatchSchema = userSettingsPatchSchema.pick({
  locationTrackingEnabled: true,
  callLogsTrackingEnabled: true,
  moodDetectionFaceRecognitionEnabled: true,
  fitnessTrackingEnabled: true,
  calendarNotificationsTrackingEnabled: true,
  backgroundLocationTrackingEnabled: true,
  locationPermissionStatus: true,
});

export type UserSettingsDto = z.infer<typeof userSettingsSchema>;
export type UserSettingsPatchDto = z.infer<typeof userSettingsPatchSchema>;
export type LifeContextUserSettingsPatchDto = z.infer<
  typeof lifeContextUserSettingsPatchSchema
>;

export const USER_SETTINGS_DEFAULTS: UserSettingsDto = {
  theme: "system",
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
  locationPermissionStatus: "unknown",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assignParsedField<K extends keyof UserSettingsDto>(
  target: UserSettingsPatchDto,
  key: K,
  value: unknown,
  schema: z.ZodType<UserSettingsDto[K]>,
): void {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    target[key] = parsed.data;
  }
}

export function normalizeUserSettingsPatch(
  input: unknown,
): UserSettingsPatchDto {
  if (!isRecord(input)) {
    return {};
  }

  const normalized: UserSettingsPatchDto = {};
  const schemaFields = userSettingsSchema.shape;

  assignParsedField(normalized, "theme", input.theme, schemaFields.theme);
  assignParsedField(
    normalized,
    "notificationsEnabled",
    input.notificationsEnabled,
    schemaFields.notificationsEnabled,
  );
  assignParsedField(
    normalized,
    "dailySummaryEnabled",
    input.dailySummaryEnabled,
    schemaFields.dailySummaryEnabled,
  );
  assignParsedField(
    normalized,
    "weeklyInsightsEnabled",
    input.weeklyInsightsEnabled,
    schemaFields.weeklyInsightsEnabled,
  );
  assignParsedField(
    normalized,
    "quietHoursEnabled",
    input.quietHoursEnabled,
    schemaFields.quietHoursEnabled,
  );
  assignParsedField(
    normalized,
    "quietHoursStart",
    input.quietHoursStart,
    schemaFields.quietHoursStart,
  );
  assignParsedField(
    normalized,
    "quietHoursEnd",
    input.quietHoursEnd,
    schemaFields.quietHoursEnd,
  );
  assignParsedField(
    normalized,
    "autoSyncIntegrations",
    input.autoSyncIntegrations,
    schemaFields.autoSyncIntegrations,
  );
  assignParsedField(
    normalized,
    "defaultMemoryMood",
    input.defaultMemoryMood,
    schemaFields.defaultMemoryMood,
  );
  assignParsedField(
    normalized,
    "locationTrackingEnabled",
    input.locationTrackingEnabled,
    schemaFields.locationTrackingEnabled,
  );
  assignParsedField(
    normalized,
    "callLogsTrackingEnabled",
    input.callLogsTrackingEnabled,
    schemaFields.callLogsTrackingEnabled,
  );
  assignParsedField(
    normalized,
    "moodDetectionFaceRecognitionEnabled",
    input.moodDetectionFaceRecognitionEnabled,
    schemaFields.moodDetectionFaceRecognitionEnabled,
  );
  assignParsedField(
    normalized,
    "fitnessTrackingEnabled",
    input.fitnessTrackingEnabled,
    schemaFields.fitnessTrackingEnabled,
  );
  assignParsedField(
    normalized,
    "calendarNotificationsTrackingEnabled",
    input.calendarNotificationsTrackingEnabled,
    schemaFields.calendarNotificationsTrackingEnabled,
  );
  assignParsedField(
    normalized,
    "backgroundLocationTrackingEnabled",
    input.backgroundLocationTrackingEnabled,
    schemaFields.backgroundLocationTrackingEnabled,
  );
  assignParsedField(
    normalized,
    "locationPermissionStatus",
    input.locationPermissionStatus,
    schemaFields.locationPermissionStatus,
  );

  return normalized;
}

export function normalizeLifeContextUserSettingsPatch(
  input: unknown,
): LifeContextUserSettingsPatchDto {
  const normalized = normalizeUserSettingsPatch(input);

  return {
    locationTrackingEnabled: normalized.locationTrackingEnabled,
    callLogsTrackingEnabled: normalized.callLogsTrackingEnabled,
    moodDetectionFaceRecognitionEnabled:
      normalized.moodDetectionFaceRecognitionEnabled,
    fitnessTrackingEnabled: normalized.fitnessTrackingEnabled,
    calendarNotificationsTrackingEnabled:
      normalized.calendarNotificationsTrackingEnabled,
    backgroundLocationTrackingEnabled:
      normalized.backgroundLocationTrackingEnabled,
    locationPermissionStatus: normalized.locationPermissionStatus,
  };
}

export function normalizeUserSettings(input: unknown): UserSettingsDto {
  return {
    ...USER_SETTINGS_DEFAULTS,
    ...normalizeUserSettingsPatch(input),
  };
}

export function mergeUserSettings(
  base: unknown,
  patch: unknown,
): UserSettingsDto {
  return {
    ...normalizeUserSettings(base),
    ...normalizeUserSettingsPatch(patch),
  };
}
