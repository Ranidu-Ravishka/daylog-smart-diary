import { Platform } from "react-native";

declare const require: (name: string) => unknown;

type IosScreenTimeMetrics = {
  screenTimeMinutes?: number;
};

type IosScreenTimePayload = {
  metrics: IosScreenTimeMetrics;
  summary: string;
  signals: string[];
};

type IosScreenTimeBridge = {
  requestAuthorization?: () => Promise<boolean>;
  getDailyScreenTimeMinutes?: (options: {
    dayKey: string;
  }) => Promise<number | null | undefined>;
};

function getIosScreenTimeBridge(): IosScreenTimeBridge {
  try {
    const mod = require("react-native-device-activity") as
      | { default?: unknown }
      | unknown;
    const resolved =
      typeof mod === "object" && mod !== null && "default" in mod
        ? (mod as { default?: unknown }).default
        : mod;
    return resolved as IosScreenTimeBridge;
  } catch {
    // Try fallback bridge
  }

  try {
    const mod = require("react-native-screen-time") as
      | { default?: unknown }
      | unknown;
    const resolved =
      typeof mod === "object" && mod !== null && "default" in mod
        ? (mod as { default?: unknown }).default
        : mod;
    return resolved as IosScreenTimeBridge;
  } catch {
    // No supported bridge found
  }

  throw new Error(
    "iOS screen time native module is not installed. Add a Screen Time bridge module and run an iOS dev build.",
  );
}

export async function collectIosScreenTimeDailyDataForDay(
  dayKey: string,
): Promise<IosScreenTimePayload> {
  if (Platform.OS !== "ios") {
    throw new Error("iOS screen time sync is available only on iOS.");
  }

  const bridge = getIosScreenTimeBridge();

  if (!bridge.getDailyScreenTimeMinutes) {
    throw new Error(
      "iOS screen time bridge is missing getDailyScreenTimeMinutes. Check module setup/version.",
    );
  }

  if (bridge.requestAuthorization) {
    const authorized = await bridge.requestAuthorization();
    if (!authorized) {
      throw new Error(
        "Screen Time authorization denied. Enable permissions and required Family Controls entitlement.",
      );
    }
  }

  const minutes = await bridge.getDailyScreenTimeMinutes({ dayKey });
  const safeMinutes =
    typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
      ? Math.round(minutes)
      : undefined;

  return {
    metrics: {
      screenTimeMinutes: safeMinutes,
    },
    summary:
      typeof safeMinutes === "number"
        ? `iOS Screen Time: ${safeMinutes} screen minutes.`
        : "iOS Screen Time: no measurable screen time for this day.",
    signals: [
      typeof safeMinutes === "number"
        ? `${safeMinutes} screen minutes`
        : "No measurable screen time",
    ],
  };
}
