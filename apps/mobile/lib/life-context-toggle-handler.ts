import {
  decideLifeContextTogglePress,
  getPermissionDeniedReason,
  getPermissionPreconditionError,
  type LifeContextFeatureKey,
} from "./life-context-toggle-policy";

export type LifeContextPermissionResult =
  | { ok: true }
  | { ok: false; reason: string };

export type LifeContextTogglePressFlowInput = {
  hasPreferences: boolean;
  isCurrentlyEnabled: boolean;
  promptSetup: () => void;
  openDisclosure: (feature: LifeContextFeatureKey) => void;
  applyDisable: (feature: LifeContextFeatureKey) => Promise<void> | void;
};

export type LifeContextPermissionInput = {
  feature: LifeContextFeatureKey;
  platform: "ios" | "android" | "web";
  locationTrackingEnabled: boolean;
  backgroundTrackingRuntimeEnabled: boolean;
  ensureForegroundLocationPermission: () => Promise<boolean>;
  ensureBackgroundLocationPermission: () => Promise<boolean>;
  ensureCallLogsPermission: () => Promise<boolean>;
  ensureMoodDetectionPermission: () => Promise<boolean>;
  ensureCalendarNotificationPermission: () => Promise<boolean>;
  ensureFitnessPermission: () => Promise<{ ok: boolean; reason?: string }>;
};

export function handleLifeContextTogglePressFlow(
  feature: LifeContextFeatureKey,
  input: LifeContextTogglePressFlowInput,
): void {
  const decision = decideLifeContextTogglePress({
    hasPreferences: input.hasPreferences,
    isCurrentlyEnabled: input.isCurrentlyEnabled,
  });

  if (decision.action === "prompt_setup") {
    input.promptSetup();
    return;
  }

  if (decision.action === "open_disclosure") {
    input.openDisclosure(feature);
    return;
  }

  void input.applyDisable(feature);
}

export async function evaluateLifeContextFeaturePermission(
  input: LifeContextPermissionInput,
): Promise<LifeContextPermissionResult> {
  const preconditionError = getPermissionPreconditionError({
    feature: input.feature,
    platform: input.platform,
    locationTrackingEnabled: input.locationTrackingEnabled,
    backgroundTrackingRuntimeEnabled: input.backgroundTrackingRuntimeEnabled,
  });

  if (preconditionError) {
    return {
      ok: false,
      reason: preconditionError,
    };
  }

  if (input.feature === "location") {
    const granted = await input.ensureForegroundLocationPermission();
    return granted
      ? { ok: true }
      : { ok: false, reason: getPermissionDeniedReason("location") };
  }

  if (input.feature === "backgroundLocation") {
    const foregroundGranted = await input.ensureForegroundLocationPermission();
    if (!foregroundGranted) {
      return {
        ok: false,
        reason: "Foreground location permission is required first.",
      };
    }

    const backgroundGranted = await input.ensureBackgroundLocationPermission();
    return backgroundGranted
      ? { ok: true }
      : { ok: false, reason: getPermissionDeniedReason("backgroundLocation") };
  }

  if (input.feature === "callLogs") {
    const granted = await input.ensureCallLogsPermission();
    return granted
      ? { ok: true }
      : { ok: false, reason: getPermissionDeniedReason("callLogs") };
  }

  if (input.feature === "moodDetection") {
    const granted = await input.ensureMoodDetectionPermission();
    return granted
      ? { ok: true }
      : { ok: false, reason: getPermissionDeniedReason("moodDetection") };
  }

  if (input.feature === "calendarNotifications") {
    const granted = await input.ensureCalendarNotificationPermission();
    return granted
      ? { ok: true }
      : {
          ok: false,
          reason: getPermissionDeniedReason("calendarNotifications"),
        };
  }

  if (input.feature === "fitness") {
    const result = await input.ensureFitnessPermission();
    if (result.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      reason: result.reason ?? getPermissionDeniedReason("fitness"),
    };
  }

  return { ok: true };
}
