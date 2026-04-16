import React from "react";
import { Platform } from "react-native";

import { useMutation } from "convex/react";

import { api } from "@repo/backend/convex";
import {
  getDayKeyForTimestamp,
  getResolvedTimeZone,
} from "@repo/ui/lib/day-window";
import {
  collectAndroidCallActivityForDay,
  isAndroidCallActivityCollectionSupported,
} from "@/lib/android-call-activity-sync";
import { buildActivitySummaryContext } from "@/lib/activity-summary-context";
import {
  collectAppleHealthDailyDataForDay,
  getAppleHealthSetupIssue,
} from "@/lib/apple-health-sync";
import {
  acknowledgeBackgroundLocationFlush,
  getBackgroundLocationTelemetry,
  prepareBackgroundLocationFlushBatches,
} from "@/lib/background-location-tracker";
import {
  createBackgroundTaskRunner,
  type BackgroundTaskExecutionEvent,
} from "@/lib/background-task-runner";
import { getReminderRuntimeState } from "@/lib/reminder-notifications";
import { captureException, logInfo } from "@/lib/observability";
import { dedupeSignals, toErrorMessage } from "@/hooks/tab-orchestration/utils";
import { type LocationTrackingRuntimeConfig } from "@/hooks/tab-orchestration/types";

type UseIntegrationSyncParams = {
  isAuthenticated: boolean;
  hasLaunchPreferencesRecord: boolean;
  locationTrackingRuntimeConfig: LocationTrackingRuntimeConfig | undefined;
  fitnessTrackingEnabled: boolean;
  calendarContextEnabled: boolean;
  callSummaryEnabled: boolean;
  moodAssistanceEnabled: boolean;
};

export function useIntegrationSync({
  isAuthenticated,
  hasLaunchPreferencesRecord,
  locationTrackingRuntimeConfig,
  fitnessTrackingEnabled,
  calendarContextEnabled,
  callSummaryEnabled,
  moodAssistanceEnabled,
}: UseIntegrationSyncParams): void {
  const upsertMyIntegrationDailyData = useMutation(
    api.integrations.upsertMyIntegrationDailyData,
  );
  const upsertMyContextualDailyData = useMutation(
    api.integrations.upsertMyContextualDailyData,
  );
  const updateMyLocationTrackingState = useMutation(
    api.userPreferences.updateMyLocationTrackingState,
  );

  React.useEffect(() => {
    if (
      !isAuthenticated ||
      !hasLaunchPreferencesRecord ||
      locationTrackingRuntimeConfig === undefined
    ) {
      return;
    }

    let cancelled = false;

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

        if (event.status === "failed") {
          captureException(
            "mobile_integration_sync_task_failed",
            new Error(event.error ?? "Unknown task failure"),
            {
              taskId: event.taskId,
              attempt: event.attempt,
            },
          );
        }
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

    logInfo("mobile_integration_sync_module_started", {
      taskIds: ["life_context_signals", "background_location_flush"],
    });

    return () => {
      cancelled = true;
      runner.stop();
      logInfo("mobile_integration_sync_module_stopped", {
        taskIds: ["life_context_signals", "background_location_flush"],
      });
    };
  }, [
    calendarContextEnabled,
    callSummaryEnabled,
    fitnessTrackingEnabled,
    hasLaunchPreferencesRecord,
    isAuthenticated,
    locationTrackingRuntimeConfig,
    moodAssistanceEnabled,
    updateMyLocationTrackingState,
    upsertMyContextualDailyData,
    upsertMyIntegrationDailyData,
  ]);
}
