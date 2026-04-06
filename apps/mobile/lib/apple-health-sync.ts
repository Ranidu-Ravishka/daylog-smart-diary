import { Platform } from "react-native";
import Constants from "expo-constants";

declare const require: (name: string) => unknown;

type AppleHealthSyncMetrics = {
  steps?: number;
  sleepMinutes?: number;
  screenTimeMinutes?: number;
  spendingTotal?: number;
};

type AppleHealthSyncPayload = {
  metrics: AppleHealthSyncMetrics;
  summary: string;
  signals: string[];
};

type StepResult = { value?: number };

type SleepSample = {
  startDate?: string;
  endDate?: string;
};

type HealthKitBridge = {
  Constants?: {
    Permissions?: {
      Steps?: string;
      SleepAnalysis?: string;
    };
  };
  initHealthKit?: (
    permissions: {
      permissions?: {
        read?: string[];
        write?: string[];
      };
    },
    callback: (error?: string) => void,
  ) => void;
  getStepCount?: (
    options: { date: string },
    callback: (error?: string, result?: StepResult) => void,
  ) => void;
  getSleepSamples?: (
    options: { startDate: string; endDate: string },
    callback: (error?: string, samples?: SleepSample[]) => void,
  ) => void;
};

function parseDayRange(dayKey: string): { startIso: string; endIso: string } {
  const start = new Date(`${dayKey}T00:00:00.000Z`);
  const end = new Date(`${dayKey}T23:59:59.999Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid day key. Expected YYYY-MM-DD.");
  }

  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function getHealthKitBridge(): HealthKitBridge {
  if (Constants.appOwnership === "expo") {
    throw new Error(
      "Apple Health is unavailable in Expo Go. Run `pnpm --filter mobile ios:dev-client` (simulator) or `pnpm --filter mobile ios:dev-client-device` (physical iPhone), then retry.",
    );
  }

  let bridge: unknown;

  try {
    bridge = require("react-native-health");
  } catch {
    throw new Error(
      "Apple Health native module is not installed. Install react-native-health and run an iOS dev build.",
    );
  }

  const resolved = (bridge as { default?: unknown }).default ?? bridge;
  return resolved as HealthKitBridge;
}

export function getAppleHealthSetupIssue(): string | null {
  if (Platform.OS !== "ios") {
    return "Apple Health sync is available only on iOS devices.";
  }

  if (Constants.appOwnership === "expo") {
    return "Apple Health is unavailable in Expo Go. Run `pnpm --filter mobile ios:dev-client` (simulator) or `pnpm --filter mobile ios:dev-client-device` (physical iPhone), then retry.";
  }

  try {
    const healthKit = getHealthKitBridge();
    if (!healthKit.initHealthKit) {
      return "Apple Health bridge is not configured. Check react-native-health installation and iOS native build setup.";
    }

    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Apple Health setup is incomplete.";
  }
}

function initHealthKit(healthKit: HealthKitBridge): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!healthKit.initHealthKit) {
      reject(
        new Error(
          "Apple Health bridge does not expose initHealthKit. Check package version/setup.",
        ),
      );
      return;
    }

    const permissions = {
      permissions: {
        read: [
          healthKit.Constants?.Permissions?.Steps ?? "Steps",
          healthKit.Constants?.Permissions?.SleepAnalysis ?? "SleepAnalysis",
        ],
        write: [],
      },
    };

    healthKit.initHealthKit(permissions, (error?: string) => {
      if (error) {
        reject(new Error(`Apple Health permission/init failed: ${error}`));
        return;
      }
      resolve();
    });
  });
}

function readStepCount(
  healthKit: HealthKitBridge,
  dateIso: string,
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    if (!healthKit.getStepCount) {
      resolve(undefined);
      return;
    }

    healthKit.getStepCount({ date: dateIso }, (error, result) => {
      if (error) {
        reject(new Error(`Apple Health steps read failed: ${error}`));
        return;
      }

      const steps = result?.value;
      resolve(
        typeof steps === "number" && Number.isFinite(steps) && steps >= 0
          ? Math.round(steps)
          : undefined,
      );
    });
  });
}

function readSleepMinutes(
  healthKit: HealthKitBridge,
  startIso: string,
  endIso: string,
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    if (!healthKit.getSleepSamples) {
      resolve(undefined);
      return;
    }

    healthKit.getSleepSamples(
      { startDate: startIso, endDate: endIso },
      (error, samples) => {
        if (error) {
          reject(new Error(`Apple Health sleep read failed: ${error}`));
          return;
        }

        const totalMinutes = (samples ?? []).reduce((sum, sample) => {
          const from = sample.startDate
            ? new Date(sample.startDate).getTime()
            : NaN;
          const to = sample.endDate ? new Date(sample.endDate).getTime() : NaN;
          if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
            return sum;
          }
          return sum + Math.round((to - from) / 60000);
        }, 0);

        resolve(totalMinutes > 0 ? totalMinutes : undefined);
      },
    );
  });
}

export async function collectAppleHealthDailyDataForDay(
  dayKey: string,
): Promise<AppleHealthSyncPayload> {
  const setupIssue = getAppleHealthSetupIssue();
  if (setupIssue) {
    throw new Error(setupIssue);
  }

  const { startIso, endIso } = parseDayRange(dayKey);
  const healthKit = getHealthKitBridge();

  await initHealthKit(healthKit);

  const [steps, sleepMinutes] = await Promise.all([
    readStepCount(healthKit, startIso),
    readSleepMinutes(healthKit, startIso, endIso),
  ]);

  const metrics: AppleHealthSyncMetrics = {
    steps,
    sleepMinutes,
  };

  const signals = [
    typeof steps === "number"
      ? `${steps.toLocaleString()} steps`
      : "No step count available",
    typeof sleepMinutes === "number"
      ? `${sleepMinutes} sleep minutes`
      : "No sleep samples available",
  ];

  const summary =
    typeof steps === "number" || typeof sleepMinutes === "number"
      ? `Apple Health: ${steps ?? 0} steps, ${sleepMinutes ?? 0} sleep minutes.`
      : "Apple Health: no measurable activity for this day.";

  return {
    metrics,
    summary,
    signals,
  };
}
