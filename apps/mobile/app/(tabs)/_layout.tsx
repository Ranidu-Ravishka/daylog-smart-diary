import { Tabs, Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";

import { useAuth } from "@clerk/clerk-expo";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@repo/backend/convex";
import {
  getDayKeyForTimestamp,
  getResolvedTimeZone,
} from "@repo/ui/lib/day-window";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  flushBackgroundLocationBatches,
  getBackgroundLocationTelemetry,
  startBackgroundLocationTracker,
  stopBackgroundLocationTracker,
} from "@/lib/background-location-tracker";
import {
  collectAndroidCallActivityForDay,
  isAndroidCallActivityCollectionSupported,
} from "@/lib/android-call-activity-sync";
import { buildActivitySummaryContext } from "@/lib/activity-summary-context";
import {
  collectAppleHealthDailyDataForDay,
  getAppleHealthSetupIssue,
} from "@/lib/apple-health-sync";
import { startForegroundLocationTracker } from "@/lib/foreground-location-tracker";
import {
  getReminderRuntimeState,
  syncReminderNotifications,
} from "@/lib/reminder-notifications";

function dedupeSignals(signals: string[]): string[] {
  return Array.from(
    new Set(signals.map((signal) => signal.trim()).filter(Boolean)),
  ).slice(0, 24);
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const launchPreferences = useQuery(
    api.userPreferences.getMyUserPreferences,
    isAuthenticated ? {} : "skip",
  );
  const locationTrackingRuntimeConfig = useQuery(
    api.integrations.getMyLocationTrackingRuntimeConfig,
    isAuthenticated ? {} : "skip",
  );
  const upsertMyIntegrationDailyData = useMutation(
    api.integrations.upsertMyIntegrationDailyData,
  );
  const upsertMyContextualDailyData = useMutation(
    api.integrations.upsertMyContextualDailyData,
  );
  const updateMyLocationTrackingState = useMutation(
    api.userPreferences.updateMyLocationTrackingState,
  );
  const isPreferencesLoading =
    isAuthenticated &&
    (launchPreferences === undefined ||
      locationTrackingRuntimeConfig === undefined);
  const locationTrackingEnabled =
    launchPreferences?.locationTrackingEnabled ?? false;
  const backgroundLocationTrackingEnabled =
    launchPreferences?.backgroundLocationTrackingEnabled ?? false;

  const theme = Colors[colorScheme ?? "light"];

  React.useEffect(() => {
    if (!isAuthenticated || launchPreferences === undefined) return;

    void syncReminderNotifications(launchPreferences);
  }, [isAuthenticated, launchPreferences]);

  React.useEffect(() => {
    if (!isAuthenticated || !launchPreferences) return;

    const fitnessTrackingEnabled =
      launchPreferences.fitnessTrackingEnabled ?? false;
    const calendarContextEnabled =
      launchPreferences.calendarNotificationsTrackingEnabled ?? false;
    const callSummaryEnabled =
      launchPreferences.callLogsTrackingEnabled ?? false;
    const moodAssistanceEnabled =
      launchPreferences.moodDetectionFaceRecognitionEnabled ?? false;

    if (
      !fitnessTrackingEnabled &&
      !calendarContextEnabled &&
      !callSummaryEnabled &&
      !moodAssistanceEnabled
    ) {
      return;
    }

    let cancelled = false;

    const syncLifeContextSignals = async () => {
      const userTimeZone = getResolvedTimeZone();
      const dayKey = getDayKeyForTimestamp(Date.now(), userTimeZone);
      let inferredSteps: number | undefined;
      let inferredActiveMinutes: number | undefined;
      let callsCount: number | undefined;
      let callDurationMinutes: number | undefined;

      if (fitnessTrackingEnabled && Platform.OS === "ios") {
        const setupIssue = getAppleHealthSetupIssue();

        if (!setupIssue) {
          try {
            const healthData = await collectAppleHealthDailyDataForDay(
              dayKey,
              userTimeZone,
            );
            if (cancelled) return;

            inferredSteps = healthData.metrics.steps;
            inferredActiveMinutes =
              typeof healthData.metrics.steps === "number"
                ? Math.min(240, Math.round(healthData.metrics.steps / 120))
                : undefined;

            await upsertMyContextualDailyData({
              type: "fitness",
              dayKey,
              summary: healthData.summary,
              signals: healthData.signals,
              metrics: {
                steps: healthData.metrics.steps,
                sleepMinutes: healthData.metrics.sleepMinutes,
              },
              context: {
                schemaVersion: 1,
                fitness: {
                  steps: healthData.metrics.steps,
                  activeMinutes: inferredActiveMinutes,
                  source: "apple_health",
                },
              },
            });
          } catch {
            // Ignore transient collection errors; next scheduled pass will retry.
          }
        }
      }

      if (calendarContextEnabled) {
        try {
          const reminderRuntime = await getReminderRuntimeState();
          if (cancelled) return;

          const remindersCount = reminderRuntime.scheduledCount;
          const summary =
            remindersCount > 0
              ? `DayLog reminders active with ${remindersCount} scheduled notification(s).`
              : "No DayLog reminders scheduled for this day.";

          await upsertMyContextualDailyData({
            type: "calendar",
            dayKey,
            summary,
            signals: dedupeSignals([
              reminderRuntime.permissionStatus === "granted"
                ? "Notification permission granted"
                : "Notification permission not granted",
              remindersCount > 0
                ? `${remindersCount} scheduled reminder notifications`
                : "No scheduled reminders",
            ]),
            context: {
              schemaVersion: 1,
              calendar: {
                remindersCount: remindersCount > 0 ? remindersCount : undefined,
              },
            },
          });
        } catch {
          // Ignore transient collection errors; next scheduled pass will retry.
        }
      }

      if (
        callSummaryEnabled &&
        Platform.OS === "android" &&
        isAndroidCallActivityCollectionSupported()
      ) {
        try {
          const callSummary = await collectAndroidCallActivityForDay(dayKey);
          if (cancelled) return;

          callsCount = callSummary.metrics.callsCount;
          callDurationMinutes = callSummary.metrics.callDurationMinutes;
        } catch {
          // Ignore transient collection errors; next scheduled pass will retry.
        }
      }

      if (callSummaryEnabled || moodAssistanceEnabled) {
        const activityContext = buildActivitySummaryContext({
          nowMs: Date.now(),
          steps: inferredSteps,
          activeMinutes: inferredActiveMinutes,
          callsCount,
          callDurationMinutes,
          moodAssistanceEnabled,
        });

        if (cancelled) return;

        await upsertMyContextualDailyData({
          type: "activity_summary",
          dayKey,
          summary: activityContext.summary,
          signals: activityContext.signals,
          context: activityContext.context,
        });
      }
    };

    void syncLifeContextSignals();

    const interval = setInterval(
      () => {
        void syncLifeContextSignals();
      },
      45 * 60 * 1000,
    );

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAuthenticated, launchPreferences, upsertMyContextualDailyData]);

  React.useEffect(() => {
    if (!isAuthenticated || launchPreferences === undefined) return;

    if (!locationTrackingEnabled) {
      return;
    }

    let stopTracker: (() => void) | undefined;
    let isCancelled = false;

    void (async () => {
      stopTracker = await startForegroundLocationTracker({
        onUpload: async (payload) => {
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
        },
        onStatusUpdate: (status) => {
          if (status.permissionStatus === "denied") {
            void updateMyLocationTrackingState({
              locationTrackingEnabled: false,
              locationPermissionStatus: "denied",
            });
            return;
          }

          if (status.permissionStatus === "unknown") {
            void updateMyLocationTrackingState({
              locationPermissionStatus: "unknown",
            });
          }
        },
      });

      if (isCancelled) {
        stopTracker?.();
      }
    })();

    return () => {
      isCancelled = true;
      stopTracker?.();
    };
  }, [
    isAuthenticated,
    launchPreferences,
    locationTrackingEnabled,
    updateMyLocationTrackingState,
    upsertMyIntegrationDailyData,
  ]);

  React.useEffect(() => {
    if (
      !isAuthenticated ||
      launchPreferences === undefined ||
      locationTrackingRuntimeConfig === undefined
    ) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const runtimeEnabled =
        locationTrackingRuntimeConfig.enableBackgroundLocationTracking;
      const explicitOptIn =
        locationTrackingEnabled && backgroundLocationTrackingEnabled;

      if (!runtimeEnabled || !explicitOptIn) {
        await stopBackgroundLocationTracker();
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
            payload.backgroundLocationAutoDisabledAt = telemetry.autoDisabledAt;
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
        return;
      }

      await updateMyLocationTrackingState({
        locationPermissionStatus: "granted",
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    backgroundLocationTrackingEnabled,
    isAuthenticated,
    launchPreferences,
    locationTrackingEnabled,
    locationTrackingRuntimeConfig,
    updateMyLocationTrackingState,
  ]);

  React.useEffect(() => {
    if (
      !isAuthenticated ||
      launchPreferences === undefined ||
      locationTrackingRuntimeConfig === undefined
    ) {
      return;
    }

    let cancelled = false;

    const flushBatches = async () => {
      const batches = await flushBackgroundLocationBatches();

      for (const batch of batches) {
        if (cancelled) return;

        await upsertMyIntegrationDailyData({
          provider: "location",
          dayKey: batch.dayKey,
          summary: batch.summary,
          signals: batch.signals,
          context: batch.context,
        });

        await updateMyLocationTrackingState({
          locationLastUpdatedAt: batch.observedAt,
          locationLastArea: batch.areaLabel,
        });
      }

      const telemetry = await getBackgroundLocationTelemetry();
      if (cancelled) return;

      if (typeof telemetry.batteryDrainPercentPerHour === "number") {
        await updateMyLocationTrackingState({
          backgroundLocationBatteryImpactScore:
            telemetry.batteryDrainPercentPerHour,
        });
      }

      if (telemetry.autoDisabled) {
        const payload: {
          backgroundLocationTrackingEnabled: boolean;
          backgroundLocationAutoDisabledAt?: number;
          backgroundLocationAutoDisableReason?: string;
        } = {
          backgroundLocationTrackingEnabled: false,
        };

        if (typeof telemetry.autoDisabledAt === "number") {
          payload.backgroundLocationAutoDisabledAt = telemetry.autoDisabledAt;
        }
        if (telemetry.autoDisableReason) {
          payload.backgroundLocationAutoDisableReason =
            telemetry.autoDisableReason;
        }

        await updateMyLocationTrackingState(payload);
      }
    };

    void flushBatches();

    const intervalMs = Math.max(
      5,
      locationTrackingRuntimeConfig.batchFlushIntervalMinutes,
    );
    const interval = setInterval(() => {
      void flushBatches();
    }, intervalMs * 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    isAuthenticated,
    launchPreferences,
    locationTrackingRuntimeConfig,
    updateMyLocationTrackingState,
    upsertMyIntegrationDailyData,
  ]);

  if (
    !isLoaded ||
    isConvexAuthLoading ||
    isPreferencesLoading ||
    (isSignedIn && !isAuthenticated)
  ) {
    return (
      <View
        style={[styles.loadingContainer, { backgroundColor: theme.background }]}
      >
        <ActivityIndicator color={theme.tint} size="large" />
      </View>
    );
  }

  if (!isSignedIn) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <ErrorBoundary>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarActiveTintColor: theme.tint,
          tabBarInactiveTintColor: theme.tabIconDefault,
          tabBarLabelPosition: "below-icon",
          tabBarItemStyle: {
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
          },
          tabBarIconStyle: {
            marginBottom: -3,
          },
          tabBarLabelStyle: {
            marginTop: 4,
            fontSize: 11,
            fontWeight: "500",
          },
          tabBarStyle: {
            height: 68,
            paddingTop: 6,
            paddingBottom: 6,
            backgroundColor: theme.surface,
            borderTopWidth: 0.5,
            borderTopColor: theme.divider,
          },
        }}
      >
        {/* 🔒 Hidden Quick Setup */}
        <Tabs.Screen
          name="quick-setup"
          options={{
            title: "Quick Setup",
            tabBarStyle: { display: "none" },
            tabBarButton: () => null,
          }}
        />

        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color }) => (
              <IconSymbol name="house.fill" size={26} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="insights"
          options={{
            title: "Insights",
            tabBarIcon: ({ color }) => (
              <IconSymbol name="chart.bar.fill" size={26} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="add-memory"
          options={{
            title: "Add",
            tabBarIcon: ({ color }) => (
              <IconSymbol name="plus.circle.fill" size={30} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="memory"
          options={{
            title: "Memory",
            tabBarIcon: ({ color }) => (
              <IconSymbol name="book.fill" size={26} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color }) => (
              <IconSymbol name="person.fill" size={26} color={color} />
            ),
          }}
        />
      </Tabs>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
