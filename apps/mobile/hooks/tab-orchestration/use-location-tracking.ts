import React from "react";

import { useMutation } from "convex/react";

import { api } from "@repo/backend/convex";
import {
  setBackgroundLocationEncryptionSession,
  startBackgroundLocationTracker,
  stopBackgroundLocationTracker,
} from "@/lib/background-location-tracker";
import { startForegroundLocationTracker } from "@/lib/foreground-location-tracker";
import { captureException, logInfo } from "@/lib/observability";
import { type LocationTrackingRuntimeConfig } from "@/hooks/tab-orchestration/types";

type UseLocationTrackingParams = {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  sessionId: string | null | undefined;
  userId: string | null | undefined;
  isAuthenticated: boolean;
  hasLoadedLaunchPreferences: boolean;
  locationTrackingEnabled: boolean;
  backgroundLocationTrackingEnabled: boolean;
  locationTrackingRuntimeConfig: LocationTrackingRuntimeConfig | undefined;
};

export function useLocationTracking({
  isLoaded,
  isSignedIn,
  sessionId,
  userId,
  isAuthenticated,
  hasLoadedLaunchPreferences,
  locationTrackingEnabled,
  backgroundLocationTrackingEnabled,
  locationTrackingRuntimeConfig,
}: UseLocationTrackingParams): void {
  const upsertMyIntegrationDailyData = useMutation(
    api.integrations.upsertMyIntegrationDailyData,
  );
  const updateMyLocationTrackingState = useMutation(
    api.userPreferences.updateMyLocationTrackingState,
  );

  React.useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!isSignedIn || !userId) {
      void setBackgroundLocationEncryptionSession(null).catch((error) => {
        captureException(
          "mobile_location_tracking_encryption_session_failed",
          error,
          {
            hasUserId: Boolean(userId),
            isSignedIn,
          },
        );
      });
      return;
    }

    const sessionScope = sessionId ? `${userId}:${sessionId}` : userId;

    void setBackgroundLocationEncryptionSession(sessionScope).catch((error) => {
      captureException(
        "mobile_location_tracking_encryption_session_failed",
        error,
        {
          hasUserId: true,
          hasSessionId: Boolean(sessionId),
        },
      );
    });
  }, [isLoaded, isSignedIn, sessionId, userId]);

  React.useEffect(() => {
    if (!isAuthenticated || !hasLoadedLaunchPreferences) {
      return;
    }

    if (!locationTrackingEnabled) {
      return;
    }

    let stopTracker: (() => void) | undefined;
    let isCancelled = false;

    logInfo("mobile_location_tracking_foreground_started", {
      locationTrackingEnabled,
    });

    void (async () => {
      try {
        stopTracker = await startForegroundLocationTracker({
          onUpload: async (payload) => {
            try {
              await upsertMyIntegrationDailyData({
                provider: "location",
                dayKey: payload.dayKey,
                summary: payload.summary,
                signals: payload.signals,
                context: payload.context,
              });

              await updateMyLocationTrackingState({
                locationTrackingEnabled: true,
                locationPermissionStatus: "granted",
                locationLastUpdatedAt: payload.observedAt,
                locationLastArea: payload.areaLabel,
              });
            } catch (error) {
              captureException(
                "mobile_location_tracking_foreground_upload_failed",
                error,
                {
                  dayKey: payload.dayKey,
                },
              );
              throw error;
            }
          },
          onStatusUpdate: (status) => {
            if (status.permissionStatus === "denied") {
              void updateMyLocationTrackingState({
                locationTrackingEnabled: false,
                locationPermissionStatus: "denied",
              }).catch((error) => {
                captureException(
                  "mobile_location_tracking_status_update_failed",
                  error,
                  {
                    permissionStatus: "denied",
                  },
                );
              });
              return;
            }

            if (status.permissionStatus === "unknown") {
              void updateMyLocationTrackingState({
                locationPermissionStatus: "unknown",
              }).catch((error) => {
                captureException(
                  "mobile_location_tracking_status_update_failed",
                  error,
                  {
                    permissionStatus: "unknown",
                  },
                );
              });
            }
          },
        });

        if (isCancelled) {
          stopTracker?.();
        }
      } catch (error) {
        if (isCancelled) {
          return;
        }

        captureException("mobile_location_tracking_foreground_failed", error);
      }
    })();

    return () => {
      isCancelled = true;
      stopTracker?.();
      logInfo("mobile_location_tracking_foreground_stopped", {
        locationTrackingEnabled,
      });
    };
  }, [
    hasLoadedLaunchPreferences,
    isAuthenticated,
    locationTrackingEnabled,
    updateMyLocationTrackingState,
    upsertMyIntegrationDailyData,
  ]);

  React.useEffect(() => {
    if (
      !isAuthenticated ||
      !hasLoadedLaunchPreferences ||
      locationTrackingRuntimeConfig === undefined
    ) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const runtimeEnabled =
          locationTrackingRuntimeConfig.enableBackgroundLocationTracking;
        const explicitOptIn =
          locationTrackingEnabled && backgroundLocationTrackingEnabled;

        if (!runtimeEnabled || !explicitOptIn) {
          await stopBackgroundLocationTracker();
          logInfo("mobile_location_tracking_background_stopped", {
            runtimeEnabled,
            explicitOptIn,
          });
          return;
        }

        const started = await startBackgroundLocationTracker({
          runtimeConfig: {
            enabled: runtimeEnabled,
            batchMaxPoints: locationTrackingRuntimeConfig.batchMaxPoints,
            maxUpdatesPerHour: locationTrackingRuntimeConfig.maxUpdatesPerHour,
            batchFlushIntervalMinutes:
              locationTrackingRuntimeConfig.batchFlushIntervalMinutes,
            maxBatteryDrainPercentPerHour:
              locationTrackingRuntimeConfig.maxBatteryDrainPercentPerHour,
          },
          explicitOptIn: true,
          onAutoDisabled: async (telemetry) => {
            if (cancelled) return;

            const payload: {
              backgroundLocationTrackingEnabled: boolean;
              backgroundLocationAutoDisabledAt?: number;
              backgroundLocationAutoDisableReason?: string;
              backgroundLocationBatteryImpactScore?: number;
            } = {
              backgroundLocationTrackingEnabled: false,
            };

            if (typeof telemetry.autoDisabledAt === "number") {
              payload.backgroundLocationAutoDisabledAt =
                telemetry.autoDisabledAt;
            }
            if (telemetry.autoDisableReason) {
              payload.backgroundLocationAutoDisableReason =
                telemetry.autoDisableReason;
            }
            if (typeof telemetry.batteryDrainPercentPerHour === "number") {
              payload.backgroundLocationBatteryImpactScore =
                telemetry.batteryDrainPercentPerHour;
            }

            await updateMyLocationTrackingState(payload);
          },
        });

        if (cancelled) return;

        if (!started.started) {
          await updateMyLocationTrackingState({
            backgroundLocationTrackingEnabled: false,
            backgroundLocationAutoDisabledAt: Date.now(),
            backgroundLocationAutoDisableReason: started.reason,
          });

          logInfo("mobile_location_tracking_background_not_started", {
            reason: started.reason,
          });
          return;
        }

        await updateMyLocationTrackingState({
          locationPermissionStatus: "granted",
        });

        logInfo("mobile_location_tracking_background_started", {
          explicitOptIn,
          runtimeEnabled,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        captureException("mobile_location_tracking_background_failed", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    backgroundLocationTrackingEnabled,
    hasLoadedLaunchPreferences,
    isAuthenticated,
    locationTrackingEnabled,
    locationTrackingRuntimeConfig,
    updateMyLocationTrackingState,
  ]);
}
