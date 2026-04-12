import { Tabs, Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";

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
  acknowledgeBackgroundLocationFlush,
  getBackgroundLocationTelemetry,
  prepareBackgroundLocationFlushBatches,
  setBackgroundLocationEncryptionSession,
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
import {
  createBackgroundTaskRunner,
  type BackgroundTaskExecutionEvent,
} from "@/lib/background-task-runner";
import {
  processOfflineOutbox,
  type AppendDayLogOutboxPayload,
  type CreateMemoryOutboxPayload,
  type UploadMemoryMediaOutboxPayload,
} from "@/lib/offline-outbox";
import { logInfo } from "@/lib/observability";

function dedupeSignals(signals: string[]): string[] {
  return Array.from(
    new Set(signals.map((signal) => signal.trim()).filter(Boolean)),
  ).slice(0, 24);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Unknown error";
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { isLoaded, isSignedIn, sessionId, userId } = useAuth();
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
  const createMemoryFromOutbox = useMutation(api.memories.createMemory);
  const createMemoryMediaUploadUrlFromOutbox = useMutation(
    api.memories.generateMemoryMediaUploadUrl,
  );
  const addMemoryMediaByClientRequestIdFromOutbox = useMutation(
    api.memories.addMemoryMediaByClientRequestId,
  );
  const appendDayLogEntriesFromOutbox = useMutation(
    api.days.appendDayLogEntries,
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
    if (!isLoaded) {
      return;
    }

    if (!isSignedIn || !userId) {
      void setBackgroundLocationEncryptionSession(null);
      return;
    }

    const sessionScope = sessionId ? `${userId}:${sessionId}` : userId;
    void setBackgroundLocationEncryptionSession(sessionScope);
  }, [isLoaded, isSignedIn, sessionId, userId]);

  React.useEffect(() => {
    if (!isAuthenticated || launchPreferences === undefined) return;

    void syncReminderNotifications(launchPreferences);
  }, [isAuthenticated, launchPreferences]);

  React.useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    const flushOutbox = async () => {
      if (cancelled) {
        return;
      }

      const uploadMemoryMedia = async (
        payload: UploadMemoryMediaOutboxPayload,
      ) => {
        const localMediaResponse = await fetch(payload.localUri);
        if (!localMediaResponse.ok) {
          throw new Error(
            `Staged media file could not be read (status ${localMediaResponse.status}).`,
          );
        }

        const mediaBlob = await localMediaResponse.blob();
        const { uploadUrl } = await createMemoryMediaUploadUrlFromOutbox({});

        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Type": mediaBlob.type || "application/octet-stream",
          },
          body: mediaBlob,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        const uploadResult = (await uploadResponse.json()) as {
          storageId?: string;
        };
        if (!uploadResult.storageId) {
          throw new Error("Upload succeeded but no storageId was returned.");
        }

        await addMemoryMediaByClientRequestIdFromOutbox({
          memoryClientRequestId: payload.memoryClientRequestId,
          clientMediaId: payload.mediaClientRequestId,
          storageId: uploadResult.storageId,
          type: "image",
          width: payload.width,
          height: payload.height,
        });
      };

      const result = await processOfflineOutbox({
        createMemory: async (payload: CreateMemoryOutboxPayload) => {
          await createMemoryFromOutbox(payload);
        },
        appendDayLog: async (payload: AppendDayLogOutboxPayload) => {
          await appendDayLogEntriesFromOutbox(payload);
        },
        uploadMemoryMedia,
      });

      if (
        result.processed > 0 ||
        result.retried > 0 ||
        result.dropped > 0 ||
        result.pending > 0
      ) {
        logInfo("mobile_offline_outbox_flush_result", result);
      }
    };

    const runner = createBackgroundTaskRunner({
      tickIntervalMs: 1_000,
      onExecution: (event: BackgroundTaskExecutionEvent) => {
        if (event.taskId !== "offline_outbox_flush") {
          return;
        }

        logInfo("mobile_offline_outbox_task_execution", {
          taskId: event.taskId,
          status: event.status,
          attempt: event.attempt,
          queueDepth: event.queueDepth,
          durationMs: event.durationMs,
          error: event.error,
          nextRunAt: event.nextRunAt,
        });
      },
    });

    runner.registerTask({
      taskId: "offline_outbox_flush",
      intervalMs: 20_000,
      run: flushOutbox,
      retryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 10_000,
        maxDelayMs: 2 * 60 * 1_000,
      },
    });

    runner.start();
    runner.triggerTaskNow("offline_outbox_flush");

    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const isConnected = Boolean(state.isConnected);
      const isInternetReachable = state.isInternetReachable !== false;

      if (isConnected && isInternetReachable) {
        runner.triggerTaskNow("offline_outbox_flush");
      }
    });

    return () => {
      cancelled = true;
      unsubscribeNetInfo();
      runner.stop();
    };
  }, [
    addMemoryMediaByClientRequestIdFromOutbox,
    appendDayLogEntriesFromOutbox,
    createMemoryFromOutbox,
    createMemoryMediaUploadUrlFromOutbox,
    isAuthenticated,
  ]);

  React.useEffect(() => {
    if (
      !isAuthenticated ||
      launchPreferences == null ||
      locationTrackingRuntimeConfig === undefined
    ) {
      return;
    }

    let cancelled = false;

    const fitnessTrackingEnabled =
      launchPreferences.fitnessTrackingEnabled ?? false;
    const calendarContextEnabled =
      launchPreferences.calendarNotificationsTrackingEnabled ?? false;
    const callSummaryEnabled =
      launchPreferences.callLogsTrackingEnabled ?? false;
    const moodAssistanceEnabled =
      launchPreferences.moodDetectionFaceRecognitionEnabled ?? false;
    const hasLifeContextPipeline =
      fitnessTrackingEnabled ||
      calendarContextEnabled ||
      callSummaryEnabled ||
      moodAssistanceEnabled;

    const syncLifeContextSignals = async () => {
      if (!hasLifeContextPipeline) {
        return;
      }

      const pipelineErrors: string[] = [];
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

            if (cancelled) {
              return;
            }

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
          } catch (error) {
            pipelineErrors.push(`fitness:${toErrorMessage(error)}`);
          }
        }
      }

      if (calendarContextEnabled) {
        try {
          const reminderRuntime = await getReminderRuntimeState();

          if (cancelled) {
            return;
          }

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
        } catch (error) {
          pipelineErrors.push(`calendar:${toErrorMessage(error)}`);
        }
      }

      if (
        callSummaryEnabled &&
        Platform.OS === "android" &&
        isAndroidCallActivityCollectionSupported()
      ) {
        try {
          const callSummary = await collectAndroidCallActivityForDay(dayKey);
          if (cancelled) {
            return;
          }

          callsCount = callSummary.metrics.callsCount;
          callDurationMinutes = callSummary.metrics.callDurationMinutes;
        } catch (error) {
          pipelineErrors.push(`calls:${toErrorMessage(error)}`);
        }
      }

      if (callSummaryEnabled || moodAssistanceEnabled) {
        try {
          const activityContext = buildActivitySummaryContext({
            nowMs: Date.now(),
            steps: inferredSteps,
            activeMinutes: inferredActiveMinutes,
            callsCount,
            callDurationMinutes,
            moodAssistanceEnabled,
          });

          if (cancelled) {
            return;
          }

          await upsertMyContextualDailyData({
            type: "activity_summary",
            dayKey,
            summary: activityContext.summary,
            signals: activityContext.signals,
            context: activityContext.context,
          });
        } catch (error) {
          pipelineErrors.push(`activity_summary:${toErrorMessage(error)}`);
        }
      }

      if (pipelineErrors.length > 0) {
        throw new Error(
          `life_context_pipeline_failed: ${pipelineErrors.join(" | ")}`,
        );
      }
    };

    const flushBackgroundLocationPipeline = async () => {
      const pipelineErrors: string[] = [];

      let preparedFlush: Awaited<
        ReturnType<typeof prepareBackgroundLocationFlushBatches>
      > | null = null;
      try {
        preparedFlush = await prepareBackgroundLocationFlushBatches();
      } catch (error) {
        pipelineErrors.push(`flush_prepare:${toErrorMessage(error)}`);
      }

      const batches = preparedFlush?.batches ?? [];
      let uploadSucceeded =
        preparedFlush !== null && pipelineErrors.length === 0;

      for (const batch of batches) {
        if (cancelled) {
          return;
        }

        try {
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
        } catch (error) {
          uploadSucceeded = false;
          pipelineErrors.push(
            `upload:${batch.dayKey}:${toErrorMessage(error)}`,
          );
        }
      }

      if (preparedFlush && uploadSucceeded) {
        try {
          const ackResult = await acknowledgeBackgroundLocationFlush(
            preparedFlush.flushId,
          );

          if (!ackResult.acknowledged) {
            pipelineErrors.push(
              `flush_ack:${ackResult.reason ?? "not_acknowledged"}`,
            );
          }
        } catch (error) {
          pipelineErrors.push(`flush_ack:${toErrorMessage(error)}`);
        }
      }

      try {
        const telemetry = await getBackgroundLocationTelemetry();
        if (cancelled) {
          return;
        }

        if (typeof telemetry.batteryDrainPercentPerHour === "number") {
          try {
            await updateMyLocationTrackingState({
              backgroundLocationBatteryImpactScore:
                telemetry.batteryDrainPercentPerHour,
            });
          } catch (error) {
            pipelineErrors.push(`battery:${toErrorMessage(error)}`);
          }
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

          try {
            await updateMyLocationTrackingState(payload);
          } catch (error) {
            pipelineErrors.push(`auto_disable:${toErrorMessage(error)}`);
          }
        }
      } catch (error) {
        pipelineErrors.push(`telemetry:${toErrorMessage(error)}`);
      }

      if (pipelineErrors.length > 0) {
        throw new Error(
          `background_location_pipeline_failed: ${pipelineErrors.join(" | ")}`,
        );
      }
    };

    const runner = createBackgroundTaskRunner({
      tickIntervalMs: 1_000,
      onExecution: (event: BackgroundTaskExecutionEvent) => {
        logInfo("mobile_background_pipeline_task_execution", {
          taskId: event.taskId,
          status: event.status,
          attempt: event.attempt,
          queueDepth: event.queueDepth,
          durationMs: event.durationMs,
          error: event.error,
          nextRunAt: event.nextRunAt,
        });
      },
    });

    runner.registerTask({
      taskId: "life_context_signals",
      intervalMs: 45 * 60 * 1_000,
      run: async () => {
        if (cancelled) {
          return;
        }

        await syncLifeContextSignals();
      },
      retryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 30_000,
        maxDelayMs: 15 * 60 * 1_000,
      },
    });

    runner.registerTask({
      taskId: "background_location_flush",
      intervalMs:
        Math.max(5, locationTrackingRuntimeConfig.batchFlushIntervalMinutes) *
        60 *
        1_000,
      run: async () => {
        if (cancelled) {
          return;
        }

        await flushBackgroundLocationPipeline();
      },
      retryPolicy: {
        maxAttempts: 4,
        baseDelayMs: 15_000,
        maxDelayMs: 10 * 60 * 1_000,
      },
    });

    runner.start();
    runner.triggerTaskNow("life_context_signals");
    runner.triggerTaskNow("background_location_flush");

    return () => {
      cancelled = true;
      runner.stop();
    };
  }, [
    isAuthenticated,
    launchPreferences,
    locationTrackingRuntimeConfig,
    updateMyLocationTrackingState,
    upsertMyContextualDailyData,
    upsertMyIntegrationDailyData,
  ]);

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
