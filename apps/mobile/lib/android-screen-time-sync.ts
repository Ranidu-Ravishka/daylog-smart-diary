import { Platform } from "react-native";
import { getDayWindow, getResolvedTimeZone } from "@repo/ui/lib/day-window";

declare const require: (name: string) => unknown;

type AndroidScreenTimeMetrics = {
  screenTimeMinutes?: number;
};

type AndroidScreenTimePayload = {
  metrics: AndroidScreenTimeMetrics;
  summary: string;
  signals: string[];
};

type UsageRecord = {
  totalTimeInForeground?: number;
  totalTimeVisible?: number;
  usageTime?: number;
  foregroundTime?: number;
};

type AndroidUsageStatsBridge = {
  queryUsageStats?: (
    interval: "daily" | "weekly" | "monthly",
    startMs: number,
    endMs: number,
  ) => Promise<UsageRecord[] | null | undefined>;
  requestUsageStatsPermission?: () => Promise<boolean>;
  showUsageStatsPermissionPage?: () => Promise<void> | void;
};

function parseDayRange(
  dayKey: string,
  timeZone: string,
): { startMs: number; endMs: number } {
  const window = getDayWindow(dayKey, timeZone);
  return {
    startMs: window.startMs,
    endMs: window.endMs,
  };
}

function getAndroidUsageBridge(): AndroidUsageStatsBridge {
  let bridge: unknown;

  try {
    bridge = require("react-native-usage-stats-manager");
  } catch {
    throw new Error(
      "Android usage stats native module is not installed. Install react-native-usage-stats-manager and run an Android dev build.",
    );
  }

  const resolved = (bridge as { default?: unknown }).default ?? bridge;
  return resolved as AndroidUsageStatsBridge;
}

async function ensureUsageAccessPermission(
  bridge: AndroidUsageStatsBridge,
): Promise<void> {
  if (bridge.requestUsageStatsPermission) {
    const granted = await bridge.requestUsageStatsPermission();
    if (granted) return;
  }

  if (bridge.showUsageStatsPermissionPage) {
    await bridge.showUsageStatsPermissionPage();
  }

  throw new Error(
    "Usage access permission is required. Enable Usage Access for DayLog in Android settings, then sync again.",
  );
}

function recordDurationMs(record: UsageRecord): number {
  const candidates = [
    record.totalTimeInForeground,
    record.totalTimeVisible,
    record.usageTime,
    record.foregroundTime,
  ];

  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return 0;
}

export async function collectAndroidScreenTimeDailyDataForDay(
  dayKey: string,
  timeZone = getResolvedTimeZone(),
): Promise<AndroidScreenTimePayload> {
  if (Platform.OS !== "android") {
    throw new Error("Android screen time sync is available only on Android.");
  }

  const bridge = getAndroidUsageBridge();

  if (!bridge.queryUsageStats) {
    throw new Error(
      "Android usage stats bridge is missing queryUsageStats. Check package version/setup.",
    );
  }

  const { startMs, endMs } = parseDayRange(dayKey, timeZone);

  await ensureUsageAccessPermission(bridge);

  const usageRecords = await bridge.queryUsageStats("daily", startMs, endMs);
  const totalMs = (usageRecords ?? []).reduce(
    (sum, record) => sum + recordDurationMs(record),
    0,
  );

  const minutes = Math.round(totalMs / 60000);

  return {
    metrics: {
      screenTimeMinutes: minutes > 0 ? minutes : undefined,
    },
    summary:
      minutes > 0
        ? `Android usage stats: ${minutes} screen minutes.`
        : "Android usage stats: no measurable screen time for this day.",
    signals: [
      minutes > 0 ? `${minutes} screen minutes` : "No measurable screen time",
    ],
  };
}
