import * as Location from "expo-location";

export type LocationPermissionState = "unknown" | "granted" | "denied";

export type ForegroundLocationUploadPayload = {
  dayKey: string;
  summary: string;
  signals: string[];
  observedAt: number;
  areaLabel: string;
};

type TrackerStatusUpdate = {
  isTracking: boolean;
  permissionStatus: LocationPermissionState;
  lastUpdatedAt?: number;
  areaLabel?: string;
  error?: string;
};

type StartForegroundLocationTrackerOptions = {
  onUpload: (payload: ForegroundLocationUploadPayload) => Promise<void>;
  onStatusUpdate?: (status: TrackerStatusUpdate) => void;
};

const TRACKING_TIME_INTERVAL_MS = 2 * 60 * 1000;
const TRACKING_DISTANCE_INTERVAL_METERS = 200;
const MAX_ACCEPTABLE_ACCURACY_METERS = 2000;
const MIN_UPLOAD_INTERVAL_MS = 10 * 60 * 1000;

function getLocalDayKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getApproxAreaLabel(latitude: number, longitude: number): string {
  const roundedLatitude = latitude.toFixed(2);
  const roundedLongitude = longitude.toFixed(2);
  return `${roundedLatitude}, ${roundedLongitude}`;
}

function formatObservedTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildSignals(areaLabel: string, observedAt: number): string[] {
  return [
    "Foreground location tracking active",
    `Approx area ${areaLabel}`,
    `Last foreground update at ${formatObservedTime(observedAt)}`,
  ];
}

export async function startForegroundLocationTracker(
  options: StartForegroundLocationTrackerOptions,
): Promise<() => void> {
  let lastUploadedAt = 0;
  let lastUploadedArea = "";
  let stopped = false;

  const emitStatus = (status: TrackerStatusUpdate) => {
    options.onStatusUpdate?.(status);
  };

  try {
    const currentPermission = await Location.getForegroundPermissionsAsync();

    if (currentPermission.status !== "granted") {
      const requestedPermission =
        await Location.requestForegroundPermissionsAsync();

      if (requestedPermission.status !== "granted") {
        emitStatus({
          isTracking: false,
          permissionStatus: "denied",
          error: "Foreground location permission is not granted.",
        });

        return () => {
          stopped = true;
        };
      }
    }

    emitStatus({
      isTracking: true,
      permissionStatus: "granted",
    });

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: TRACKING_TIME_INTERVAL_MS,
        distanceInterval: TRACKING_DISTANCE_INTERVAL_METERS,
      },
      (position) => {
        void (async () => {
          if (stopped) return;

          const observedAt = position.timestamp || Date.now();
          const { latitude, longitude, accuracy } = position.coords;

          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return;
          }

          if (
            typeof accuracy === "number" &&
            accuracy > MAX_ACCEPTABLE_ACCURACY_METERS
          ) {
            return;
          }

          const areaLabel = getApproxAreaLabel(latitude, longitude);
          const shouldThrottleUpload =
            observedAt - lastUploadedAt < MIN_UPLOAD_INTERVAL_MS &&
            areaLabel === lastUploadedArea;

          if (shouldThrottleUpload) {
            return;
          }

          try {
            await options.onUpload({
              dayKey: getLocalDayKey(observedAt),
              summary: `Foreground location update near ${areaLabel}.`,
              signals: buildSignals(areaLabel, observedAt),
              observedAt,
              areaLabel,
            });

            lastUploadedAt = observedAt;
            lastUploadedArea = areaLabel;

            emitStatus({
              isTracking: true,
              permissionStatus: "granted",
              lastUpdatedAt: observedAt,
              areaLabel,
            });
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Failed to upload location signal.";
            emitStatus({
              isTracking: true,
              permissionStatus: "granted",
              error: message,
            });
          }
        })();
      },
    );

    return () => {
      stopped = true;
      subscription.remove();
      emitStatus({
        isTracking: false,
        permissionStatus: "granted",
      });
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start foreground location tracking.";

    emitStatus({
      isTracking: false,
      permissionStatus: "unknown",
      error: message,
    });

    return () => {
      stopped = true;
    };
  }
}
