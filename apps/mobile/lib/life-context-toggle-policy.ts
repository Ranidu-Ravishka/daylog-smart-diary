export type LifeContextFeatureKey =
  | "location"
  | "callLogs"
  | "moodDetection"
  | "fitness"
  | "calendarNotifications"
  | "backgroundLocation";

export type FeatureState = "enabled" | "disabled" | "error";

export type LifeContextDisclosure = {
  title: string;
  description: string;
  consentLabel: string;
};

export const LIFE_CONTEXT_DISCLOSURE: Record<
  LifeContextFeatureKey,
  LifeContextDisclosure
> = {
  location: {
    title: "Enable location context",
    description:
      "DayLog stores coarse area-level movement context and stay durations to enrich summaries. Exact routes are not required.",
    consentLabel: "I consent to location context tracking",
  },
  callLogs: {
    title: "Enable call log context",
    description:
      "DayLog can use call count and duration metadata as daily context. DayLog does not require call audio or contact content.",
    consentLabel: "I consent to call metadata tracking",
  },
  moodDetection: {
    title: "Enable mood assistance",
    description:
      "Mood assistance uses lightweight non-camera inference from time and activity patterns to suggest a coarse mood hint.",
    consentLabel: "I consent to non-camera mood assistance",
  },
  fitness: {
    title: "Enable fitness context",
    description:
      "DayLog can include movement and activity signals from connected health providers to improve day-level summaries.",
    consentLabel: "I consent to fitness context tracking",
  },
  calendarNotifications: {
    title: "Enable calendar and notification context",
    description:
      "DayLog can merge schedule density and notification/reminder state into context summaries.",
    consentLabel: "I consent to calendar and notification context tracking",
  },
  backgroundLocation: {
    title: "Enable background location",
    description:
      "Background location runs in controlled batches with battery safeguards and auto-disable rules. Enable only if you want context while app is closed.",
    consentLabel: "I consent to background location tracking",
  },
};

export type TogglePressDecision =
  | { action: "prompt_setup" }
  | { action: "open_disclosure" }
  | { action: "apply_disable" };

export function decideLifeContextTogglePress(input: {
  hasPreferences: boolean;
  isCurrentlyEnabled: boolean;
}): TogglePressDecision {
  if (!input.hasPreferences) {
    return { action: "prompt_setup" };
  }

  if (!input.isCurrentlyEnabled) {
    return { action: "open_disclosure" };
  }

  return { action: "apply_disable" };
}

export function deriveLifeContextFeatureState(input: {
  enabled: boolean;
  errorMessage?: string;
}): FeatureState {
  if (input.errorMessage) {
    return "error";
  }

  return input.enabled ? "enabled" : "disabled";
}

type PermissionPreconditionInput = {
  feature: LifeContextFeatureKey;
  platform: "ios" | "android" | "web";
  locationTrackingEnabled: boolean;
  backgroundTrackingRuntimeEnabled: boolean;
};

export function getPermissionPreconditionError(
  input: PermissionPreconditionInput,
): string | null {
  if (input.feature === "backgroundLocation") {
    if (!input.locationTrackingEnabled) {
      return "Enable location context first before turning on background tracking.";
    }

    if (!input.backgroundTrackingRuntimeEnabled) {
      return "Background location tracking is currently disabled by server runtime policy.";
    }
  }

  if (input.feature === "callLogs" && input.platform !== "android") {
    return "Call log tracking is currently only available on Android.";
  }

  return null;
}

export function getPermissionDeniedReason(
  feature: LifeContextFeatureKey,
): string {
  switch (feature) {
    case "location":
      return "Foreground location permission was denied. Enable location in system settings and try again.";
    case "backgroundLocation":
      return "Background location permission was denied. DayLog cannot run controlled background tracking without it.";
    case "callLogs":
      return "Call-log permissions were denied.";
    case "moodDetection":
      return "Mood assistance permission requirement was not satisfied.";
    case "calendarNotifications":
      return "Notification permission is required to enable calendar and notification context.";
    case "fitness":
      return "Fitness permission requirement was not satisfied.";
    default:
      return "Permission requirement was not satisfied.";
  }
}
