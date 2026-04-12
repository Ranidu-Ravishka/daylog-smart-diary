import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Battery from "expo-battery";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import {
  getDayKeyForTimestamp,
  getDayWindow,
  getResolvedTimeZone,
} from "@repo/ui/lib/day-window";
import { Platform } from "react-native";
import {
  buildLocationContextFromPoints,
  type LocationContextPayload,
  type LocationTrackPoint,
} from "./location-stay-points";
import {
  getLocationQueueSize,
  loadLocationQueueForSync,
  saveLocationQueue,
  setLocationQueueSessionScope,
} from "./secure-location-queue";

export type BackgroundLocationRuntimeConfig = {
  enabled: boolean;
  batchMaxPoints: number;
  maxUpdatesPerHour: number;
  batchFlushIntervalMinutes: number;
  maxBatteryDrainPercentPerHour: number;
};

export type BackgroundLocationUploadPayload = {
  dayKey: string;
  summary: string;
  signals: string[];
  context?: LocationContextPayload;
  observedAt: number;
  areaLabel: string;
};

export type BackgroundLocationTelemetry = {
  updatesInWindow: number;
  windowStartedAt: number;
  batteryDrainPercentPerHour?: number;
  autoDisabled: boolean;
  autoDisableReason?: string;
  autoDisabledAt?: number;
  queueSize: number;
  lastUpdatedAt?: number;
};

type StartBackgroundLocationTrackerOptions = {
  runtimeConfig: BackgroundLocationRuntimeConfig;
  explicitOptIn: boolean;
  onAutoDisabled?: (
    telemetry: BackgroundLocationTelemetry,
  ) => Promise<void> | void;
};

type PersistedTelemetry = {
  updatesInWindow: number;
  windowStartedAt: number;
  windowStartBatteryLevel?: number;
  batteryDrainPercentPerHour?: number;
  autoDisabledAt?: number;
  autoDisableReason?: string;
  lastUpdatedAt?: number;
};

type StartTrackerResult = {
  started: boolean;
  reason?: string;
};

export type BackgroundLocationEnablementStatus = {
  fullyEnabled: boolean;
  isRunning: boolean;
  backgroundModeAvailable: boolean;
  backgroundPermissionStatus: "granted" | "denied" | "undetermined";
  reason?: string;
};

const TASK_NAME = "daylog.background_location.context.batch";
const STORAGE_TELEMETRY_KEY = "daylog.background_location.telemetry";
// Keep raw queued points intentionally small; only short-lived coarse context is needed.
const MAX_POINT_RETENTION = 480;

const DEFAULT_RUNTIME_CONFIG: BackgroundLocationRuntimeConfig = {
  enabled: false,
  batchMaxPoints: 32,
  maxUpdatesPerHour: 120,
  batchFlushIntervalMinutes: 15,
  maxBatteryDrainPercentPerHour: 12,
};

let activeRuntimeConfig = DEFAULT_RUNTIME_CONFIG;
let autoDisabledListener:
  | ((telemetry: BackgroundLocationTelemetry) => Promise<void> | void)
  | undefined;

function getCurrentUserTimeZone(): string {
  return getResolvedTimeZone();
}

function toAreaLabel(latitude: number, longitude: number): string {
  return `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
}

function sanitizeRuntimeConfig(
  config: BackgroundLocationRuntimeConfig,
): BackgroundLocationRuntimeConfig {
  return {
    enabled: config.enabled,
    batchMaxPoints: Math.min(Math.max(config.batchMaxPoints, 8), 500),
    maxUpdatesPerHour: Math.min(Math.max(config.maxUpdatesPerHour, 20), 2000),
    batchFlushIntervalMinutes: Math.min(
      Math.max(config.batchFlushIntervalMinutes, 5),
      240,
    ),
    maxBatteryDrainPercentPerHour: Math.min(
      Math.max(config.maxBatteryDrainPercentPerHour, 1),
      60,
    ),
  };
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

function sanitizeTrackPoint(
  point: LocationTrackPoint,
): LocationTrackPoint | null {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    return null;
  }

  if (!Number.isFinite(point.timestampMs)) {
    return null;
  }

  if (point.latitude < -90 || point.latitude > 90) return null;
  if (point.longitude < -180 || point.longitude > 180) return null;

  const roundedLatitude = Math.round(point.latitude * 10_000) / 10_000;
  const roundedLongitude = Math.round(point.longitude * 10_000) / 10_000;
  const roundedTimestampMs = Math.round(point.timestampMs / 1_000) * 1_000;

  return {
    latitude: roundedLatitude,
    longitude: roundedLongitude,
    timestampMs: roundedTimestampMs,
    accuracyMeters:
      typeof point.accuracyMeters === "number" &&
      Number.isFinite(point.accuracyMeters)
        ? Math.round(point.accuracyMeters)
        : undefined,
  };
}

function dedupeSignals(signals: string[]): string[] {
  return Array.from(
    new Set(signals.map((signal) => signal.trim()).filter(Boolean)),
  ).slice(0, 24);
}

async function loadQueuedPoints(): Promise<LocationTrackPoint[]> {
  const decrypted = await loadLocationQueueForSync();

  return decrypted
    .map((point) => sanitizeTrackPoint(point))
    .filter((point): point is LocationTrackPoint => point !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .slice(-MAX_POINT_RETENTION);
}

async function saveQueuedPoints(points: LocationTrackPoint[]): Promise<void> {
  const normalized = points
    .map((point) => sanitizeTrackPoint(point))
    .filter((point): point is LocationTrackPoint => point !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .slice(-MAX_POINT_RETENTION);

  await saveLocationQueue(normalized);
}

export async function setBackgroundLocationEncryptionSession(
  sessionScope: string | null,
): Promise<void> {
  if (Platform.OS === "web") return;
  await setLocationQueueSessionScope(sessionScope);
}

async function loadTelemetry(): Promise<PersistedTelemetry> {
  const now = Date.now();
  return await readJson<PersistedTelemetry>(STORAGE_TELEMETRY_KEY, {
    updatesInWindow: 0,
    windowStartedAt: now,
  });
}

async function saveTelemetry(telemetry: PersistedTelemetry): Promise<void> {
  await writeJson(STORAGE_TELEMETRY_KEY, telemetry);
}

async function clearAutoDisableMarkers(): Promise<void> {
  const telemetry = await loadTelemetry();
  const nextTelemetry: PersistedTelemetry = {
    ...telemetry,
    autoDisabledAt: undefined,
    autoDisableReason: undefined,
  };
  await saveTelemetry(nextTelemetry);
}

async function getBatteryLevelOrUndefined(): Promise<number | undefined> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    if (!Number.isFinite(level)) return undefined;
    return Math.min(Math.max(level, 0), 1);
  } catch {
    return undefined;
  }
}

async function updateTelemetryWithPoints(
  points: LocationTrackPoint[],
): Promise<PersistedTelemetry> {
  const now = Date.now();
  const telemetry = await loadTelemetry();
  const windowDurationMs = now - telemetry.windowStartedAt;

  let nextTelemetry: PersistedTelemetry;

  if (
    !Number.isFinite(windowDurationMs) ||
    windowDurationMs < 0 ||
    windowDurationMs >= 60 * 60 * 1000
  ) {
    nextTelemetry = {
      updatesInWindow: 0,
      windowStartedAt: now,
      windowStartBatteryLevel: await getBatteryLevelOrUndefined(),
    };
  } else {
    nextTelemetry = { ...telemetry };
  }

  nextTelemetry.updatesInWindow += points.length;
  nextTelemetry.lastUpdatedAt = now;

  const windowStartBatteryLevel =
    typeof nextTelemetry.windowStartBatteryLevel === "number"
      ? nextTelemetry.windowStartBatteryLevel
      : await getBatteryLevelOrUndefined();
  nextTelemetry.windowStartBatteryLevel = windowStartBatteryLevel;

  const currentBatteryLevel = await getBatteryLevelOrUndefined();
  if (
    typeof windowStartBatteryLevel === "number" &&
    typeof currentBatteryLevel === "number"
  ) {
    const drainFraction = Math.max(
      0,
      windowStartBatteryLevel - currentBatteryLevel,
    );
    const elapsedHours = Math.max(
      (now - nextTelemetry.windowStartedAt) / 3_600_000,
      1 / 60,
    );
    nextTelemetry.batteryDrainPercentPerHour =
      Math.round(((drainFraction * 100) / elapsedHours) * 10) / 10;
  }

  await saveTelemetry(nextTelemetry);
  return nextTelemetry;
}

async function maybeAutoDisableTracking(): Promise<void> {
  const telemetry = await loadTelemetry();

  const exceededUpdateRate =
    telemetry.updatesInWindow > activeRuntimeConfig.maxUpdatesPerHour;
  const exceededBatteryDrain =
    (telemetry.batteryDrainPercentPerHour ?? 0) >
    activeRuntimeConfig.maxBatteryDrainPercentPerHour;

  if (!exceededUpdateRate && !exceededBatteryDrain) {
    return;
  }

  const reason = exceededBatteryDrain
    ? `Auto-disabled: battery impact estimate ${telemetry.batteryDrainPercentPerHour ?? 0}%/h exceeded policy threshold.`
    : "Auto-disabled: background location update rate exceeded policy threshold.";

  const now = Date.now();
  const nextTelemetry: PersistedTelemetry = {
    ...telemetry,
    autoDisabledAt: now,
    autoDisableReason: reason,
  };
  await saveTelemetry(nextTelemetry);

  try {
    const started = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
    if (started) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
    }
  } catch {
    // Ignore stop errors.
  }

  const queueSize = await getLocationQueueSize();
  await autoDisabledListener?.({
    updatesInWindow: nextTelemetry.updatesInWindow,
    windowStartedAt: nextTelemetry.windowStartedAt,
    batteryDrainPercentPerHour: nextTelemetry.batteryDrainPercentPerHour,
    autoDisabled: true,
    autoDisableReason: reason,
    autoDisabledAt: now,
    queueSize,
    lastUpdatedAt: nextTelemetry.lastUpdatedAt,
  });
}

function defineBackgroundTaskOnce(): void {
  const maybeTaskManager = TaskManager as unknown as {
    isTaskDefined?: (taskName: string) => boolean;
  };

  if (maybeTaskManager.isTaskDefined?.(TASK_NAME)) {
    return;
  }

  try {
    TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
      if (error || !data) return;

      const payload = data as {
        locations?: {
          timestamp?: number;
          coords?: {
            latitude?: number;
            longitude?: number;
            accuracy?: number | null;
          };
        }[];
      };

      const points = (payload.locations ?? [])
        .map((entry) => {
          const latitude = entry.coords?.latitude;
          const longitude = entry.coords?.longitude;
          if (
            typeof latitude !== "number" ||
            !Number.isFinite(latitude) ||
            typeof longitude !== "number" ||
            !Number.isFinite(longitude)
          ) {
            return null;
          }

          return sanitizeTrackPoint({
            latitude,
            longitude,
            timestampMs:
              typeof entry.timestamp === "number"
                ? entry.timestamp
                : Date.now(),
            accuracyMeters:
              typeof entry.coords?.accuracy === "number"
                ? entry.coords.accuracy
                : undefined,
          });
        })
        .filter((point): point is LocationTrackPoint => point !== null);

      if (points.length === 0) return;

      const queuedPoints = await loadQueuedPoints();
      const mergedPoints = [...queuedPoints, ...points];
      await saveQueuedPoints(mergedPoints);

      await updateTelemetryWithPoints(points);
      await maybeAutoDisableTracking();
    });
  } catch {
    // Task might already be defined in hot-reload scenarios.
  }
}

export async function startBackgroundLocationTracker(
  options: StartBackgroundLocationTrackerOptions,
): Promise<StartTrackerResult> {
  activeRuntimeConfig = sanitizeRuntimeConfig(options.runtimeConfig);
  autoDisabledListener = options.onAutoDisabled;

  if (Platform.OS === "web") {
    return {
      started: false,
      reason: "Background location is unavailable on web.",
    };
  }

  if (!activeRuntimeConfig.enabled) {
    return {
      started: false,
      reason: "Background tracking feature flag is disabled.",
    };
  }

  if (!options.explicitOptIn) {
    return {
      started: false,
      reason: "Background tracking requires explicit opt-in.",
    };
  }

  const backgroundModeAvailable =
    await Location.isBackgroundLocationAvailableAsync().catch(() => false);
  if (!backgroundModeAvailable) {
    return {
      started: false,
      reason:
        "Background location is not fully enabled at OS level. Verify native location background configuration.",
    };
  }

  defineBackgroundTaskOnce();

  const foregroundPermission = await Location.getForegroundPermissionsAsync();
  if (foregroundPermission.status !== "granted") {
    const requestedForeground =
      await Location.requestForegroundPermissionsAsync();
    if (requestedForeground.status !== "granted") {
      return {
        started: false,
        reason:
          "Foreground location permission is required for background tracking.",
      };
    }
  }

  const backgroundPermission = await Location.getBackgroundPermissionsAsync();
  if (backgroundPermission.status !== "granted") {
    const requestedBackground =
      await Location.requestBackgroundPermissionsAsync();
    if (requestedBackground.status !== "granted") {
      return {
        started: false,
        reason: "Background location permission was not granted.",
      };
    }
  }

  const alreadyStarted =
    await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
  if (alreadyStarted) {
    return { started: true };
  }

  await clearAutoDisableMarkers();

  try {
    await Location.startLocationUpdatesAsync(TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 200,
      timeInterval: Math.max(
        60_000,
        Math.floor(
          (activeRuntimeConfig.batchFlushIntervalMinutes * 60_000) / 3,
        ),
      ),
      deferredUpdatesInterval:
        activeRuntimeConfig.batchFlushIntervalMinutes * 60_000,
      pausesUpdatesAutomatically: true,
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: false,
      foregroundService:
        Platform.OS === "android"
          ? {
              notificationTitle: "DayLog background tracking",
              notificationBody:
                "Collecting coarse movement trends to improve daily context summaries.",
            }
          : undefined,
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.message.trim().length > 0
        ? `Background location is not fully enabled: ${error.message}`
        : "Background location is not fully enabled at OS level.";

    return {
      started: false,
      reason,
    };
  }

  return { started: true };
}

export async function stopBackgroundLocationTracker(): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    const started = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
    if (started) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
    }
  } catch {
    // Ignore stop errors.
  }
}

export async function isBackgroundLocationTrackerRunning(): Promise<boolean> {
  if (Platform.OS === "web") return false;

  try {
    return await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
  } catch {
    return false;
  }
}

export async function getBackgroundLocationEnablementStatus(): Promise<BackgroundLocationEnablementStatus> {
  if (Platform.OS === "web") {
    return {
      fullyEnabled: false,
      isRunning: false,
      backgroundModeAvailable: false,
      backgroundPermissionStatus: "denied",
      reason: "Background location is unavailable on web.",
    };
  }

  const backgroundModeAvailable =
    await Location.isBackgroundLocationAvailableAsync().catch(() => false);
  if (!backgroundModeAvailable) {
    return {
      fullyEnabled: false,
      isRunning: false,
      backgroundModeAvailable,
      backgroundPermissionStatus: "undetermined",
      reason:
        "Background location is not fully enabled at OS level. Verify native location background configuration.",
    };
  }

  const permission = await Location.getBackgroundPermissionsAsync().catch(
    () => null,
  );
  const permissionStatus = permission?.status ?? "undetermined";
  if (permissionStatus !== "granted") {
    return {
      fullyEnabled: false,
      isRunning: false,
      backgroundModeAvailable,
      backgroundPermissionStatus: permissionStatus,
      reason: "Background location permission is not granted.",
    };
  }

  const isRunning = await isBackgroundLocationTrackerRunning();
  if (!isRunning) {
    return {
      fullyEnabled: false,
      isRunning,
      backgroundModeAvailable,
      backgroundPermissionStatus: permissionStatus,
      reason: "Background tracker is not actively running.",
    };
  }

  return {
    fullyEnabled: true,
    isRunning,
    backgroundModeAvailable,
    backgroundPermissionStatus: permissionStatus,
  };
}

export async function flushBackgroundLocationBatches(): Promise<
  BackgroundLocationUploadPayload[]
> {
  // Decrypt queue only for upload/sync path; callers should not access raw queue directly.
  const queuedPoints = await loadQueuedPoints();
  if (queuedPoints.length === 0) return [];

  const userTimeZone = getCurrentUserTimeZone();

  const groupedByDay = new Map<string, LocationTrackPoint[]>();
  for (const point of queuedPoints) {
    const dayKey = getDayKeyForTimestamp(point.timestampMs, userTimeZone);
    const existing = groupedByDay.get(dayKey);
    if (existing) {
      existing.push(point);
    } else {
      groupedByDay.set(dayKey, [point]);
    }
  }

  const telemetry = await loadTelemetry();
  const telemetrySignals: string[] = [];
  if (typeof telemetry.batteryDrainPercentPerHour === "number") {
    telemetrySignals.push(
      `Estimated battery impact ${telemetry.batteryDrainPercentPerHour}%/hour`,
    );
  }

  const payloads: BackgroundLocationUploadPayload[] = [];
  for (const [dayKey, points] of groupedByDay) {
    const dayWindow = getDayWindow(dayKey, userTimeZone);
    const pointsInDayWindow = points.filter(
      (point) =>
        point.timestampMs >= dayWindow.startMs &&
        point.timestampMs <= dayWindow.endMs,
    );

    const sortedPoints = [...pointsInDayWindow].sort(
      (a, b) => a.timestampMs - b.timestampMs,
    );
    const cappedPoints = sortedPoints.slice(
      -activeRuntimeConfig.batchMaxPoints,
    );
    const locationContext = buildLocationContextFromPoints(cappedPoints, {
      minStayDurationMinutes: 10,
      maxStayRadiusMeters: 150,
      maxAcceptedAccuracyMeters: 250,
    });

    const firstPoint = cappedPoints[0];
    const lastPoint = cappedPoints[cappedPoints.length - 1];
    if (!firstPoint || !lastPoint) continue;

    payloads.push({
      dayKey,
      summary:
        locationContext.summary ||
        `Background movement collected near ${toAreaLabel(firstPoint.latitude, firstPoint.longitude)}.`,
      signals: dedupeSignals([
        ...locationContext.signals,
        ...telemetrySignals,
        `Background batch with ${cappedPoints.length} points`,
      ]),
      context: {
        ...locationContext.context,
        location: {
          ...locationContext.context.location,
          mode: "background_controlled",
        },
      },
      observedAt: lastPoint.timestampMs,
      areaLabel: toAreaLabel(firstPoint.latitude, firstPoint.longitude),
    });
  }

  await saveQueuedPoints([]);
  return payloads;
}

export async function getBackgroundLocationTelemetry(): Promise<BackgroundLocationTelemetry> {
  const telemetry = await loadTelemetry();
  const queueSize = await getLocationQueueSize();

  return {
    updatesInWindow: telemetry.updatesInWindow,
    windowStartedAt: telemetry.windowStartedAt,
    batteryDrainPercentPerHour: telemetry.batteryDrainPercentPerHour,
    autoDisabled: typeof telemetry.autoDisabledAt === "number",
    autoDisableReason: telemetry.autoDisableReason,
    autoDisabledAt: telemetry.autoDisabledAt,
    queueSize,
    lastUpdatedAt: telemetry.lastUpdatedAt,
  };
}
