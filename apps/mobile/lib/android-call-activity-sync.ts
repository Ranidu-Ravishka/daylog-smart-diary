import { Platform } from "react-native";
import { getDayWindow, getResolvedTimeZone } from "@repo/ui/lib/day-window";

declare const require: (name: string) => unknown;

type AndroidCallActivityMetrics = {
  callsCount?: number;
  callDurationMinutes?: number;
};

export type AndroidCallActivityPayload = {
  metrics: AndroidCallActivityMetrics;
  summary: string;
  signals: string[];
};

export type CallActivityModuleStatus =
  | "available"
  | "missing"
  | "not_supported"
  | "unknown";

export type CallActivityPermissionStatus =
  | "granted"
  | "denied"
  | "not_supported"
  | "unknown";

export type AndroidCallActivityRuntimeDiagnostics = {
  moduleStatus: CallActivityModuleStatus;
  permissionStatus: CallActivityPermissionStatus;
  detail: string;
};

type CallLogRecord = {
  timestamp?: number | string;
  dateTime?: number | string;
  duration?: number | string;
  type?: string;
};

type AndroidCallLogBridge = {
  loadAll?: () => Promise<CallLogRecord[] | null | undefined>;
  getAll?: () => Promise<CallLogRecord[] | null | undefined>;
  checkPermission?: () => Promise<boolean>;
  requestReadPermission?: () => Promise<boolean>;
};

type CallLogModuleLoader = (name: string) => unknown;

const defaultCallLogModuleLoader: CallLogModuleLoader = (name) => {
  // Metro requires static string literals for require() so this stays fixed.
  void name;
  return require("react-native-call-log");
};
let callLogModuleLoader: CallLogModuleLoader = defaultCallLogModuleLoader;

// Test hook used by unit tests to inject a fake native bridge loader.
export function __setCallLogModuleLoaderForTests(
  loader: CallLogModuleLoader | null,
): void {
  callLogModuleLoader = loader ?? defaultCallLogModuleLoader;
}

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

function getAndroidCallLogBridge(): AndroidCallLogBridge {
  let bridge: unknown;

  try {
    bridge = callLogModuleLoader("react-native-call-log");
  } catch {
    throw new Error(
      "Android call activity module is not installed. Add react-native-call-log and run an Android dev build.",
    );
  }

  const resolved = (bridge as { default?: unknown }).default ?? bridge;
  return resolved as AndroidCallLogBridge;
}

function toTimestampMs(record: CallLogRecord): number | undefined {
  const raw = record.timestamp ?? record.dateTime;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === "string" && raw.trim().length > 0) {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }

    const asDate = new Date(raw).getTime();
    if (Number.isFinite(asDate)) {
      return asDate;
    }
  }

  return undefined;
}

function toDurationSeconds(record: CallLogRecord): number {
  const raw = record.duration;

  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }

  if (typeof raw === "string" && raw.trim().length > 0) {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber;
    }
  }

  return 0;
}

function isMissedOrRejectedType(type: string | undefined): boolean {
  const value = type?.toLowerCase().trim();
  if (!value) return false;

  return (
    value.includes("miss") ||
    value.includes("reject") ||
    value.includes("blocked") ||
    value.includes("voicemail")
  );
}

export function isAndroidCallActivityCollectionSupported(): boolean {
  if (Platform.OS !== "android") return false;

  try {
    getAndroidCallLogBridge();
    return true;
  } catch {
    return false;
  }
}

export async function requestAndroidCallActivityPermission(
  bridge = getAndroidCallLogBridge(),
): Promise<boolean> {
  if (Platform.OS !== "android") return false;

  try {
    if (bridge.checkPermission) {
      const hasPermission = await bridge.checkPermission();
      if (hasPermission) return true;
    }

    if (bridge.requestReadPermission) {
      return await bridge.requestReadPermission();
    }
  } catch {
    return false;
  }

  return false;
}

export async function getAndroidCallActivityRuntimeDiagnostics(): Promise<AndroidCallActivityRuntimeDiagnostics> {
  if (Platform.OS !== "android") {
    return {
      moduleStatus: "not_supported",
      permissionStatus: "not_supported",
      detail: "Call activity is supported only on Android.",
    };
  }

  let bridge: AndroidCallLogBridge;
  try {
    bridge = getAndroidCallLogBridge();
  } catch {
    return {
      moduleStatus: "missing",
      permissionStatus: "unknown",
      detail: "Native call activity module is unavailable in this build.",
    };
  }

  if (!bridge.checkPermission) {
    return {
      moduleStatus: "available",
      permissionStatus: "unknown",
      detail:
        "Permission check API is unavailable on the call activity bridge.",
    };
  }

  try {
    const granted = await bridge.checkPermission();

    return {
      moduleStatus: "available",
      permissionStatus: granted ? "granted" : "denied",
      detail: granted
        ? "Call activity permission granted."
        : "Call activity permission not granted.",
    };
  } catch {
    return {
      moduleStatus: "available",
      permissionStatus: "unknown",
      detail: "Permission check failed unexpectedly.",
    };
  }
}

export async function collectAndroidCallActivityForDay(
  dayKey: string,
  timeZone = getResolvedTimeZone(),
): Promise<AndroidCallActivityPayload> {
  if (Platform.OS !== "android") {
    throw new Error("Call activity sync is available only on Android.");
  }

  const bridge = getAndroidCallLogBridge();
  const hasPermission = await requestAndroidCallActivityPermission(bridge);

  if (!hasPermission) {
    throw new Error(
      "Call activity permission denied. Enable call log access in system settings.",
    );
  }

  const reader = bridge.loadAll ?? bridge.getAll;
  if (!reader) {
    throw new Error(
      "Call activity bridge does not expose loadAll/getAll. Check module setup.",
    );
  }

  const { startMs, endMs } = parseDayRange(dayKey, timeZone);
  const records = (await reader()) ?? [];

  const relevantCalls = records.filter((record) => {
    const timestampMs = toTimestampMs(record);
    if (timestampMs === undefined) return false;
    if (timestampMs < startMs || timestampMs > endMs) return false;
    if (isMissedOrRejectedType(record.type)) return false;
    return toDurationSeconds(record) > 0;
  });

  const callsCount = relevantCalls.length;
  const totalDurationSeconds = relevantCalls.reduce(
    (sum, record) => sum + toDurationSeconds(record),
    0,
  );
  const callDurationMinutes =
    totalDurationSeconds > 0
      ? Math.max(1, Math.round(totalDurationSeconds / 60))
      : 0;

  return {
    metrics: {
      callsCount: callsCount > 0 ? callsCount : undefined,
      callDurationMinutes:
        callDurationMinutes > 0 ? callDurationMinutes : undefined,
    },
    summary:
      callsCount > 0
        ? `You had ${callsCount} call${callsCount === 1 ? "" : "s"} totaling ${callDurationMinutes} minutes.`
        : "No completed calls detected for this day.",
    signals: [
      callsCount > 0 ? `${callsCount} calls` : "No calls",
      callDurationMinutes > 0
        ? `${callDurationMinutes} total call minutes`
        : "No call duration",
    ],
  };
}
