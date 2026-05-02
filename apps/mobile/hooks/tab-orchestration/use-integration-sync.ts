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
  collectAppleCalendarDailyDataForDay,
  getAppleCalendarSetupIssue,
} from "@/lib/apple-calendar-sync";
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
  isLoaded: boolean;
  isSignedIn: boolean;
  isAuthenticated: boolean;
  hasLaunchPreferencesRecord: boolean;
  locationTrackingRuntimeConfig: LocationTrackingRuntimeConfig | undefined;
  fitnessTrackingEnabled: boolean;
  calendarContextEnabled: boolean;
  callSummaryEnabled: boolean;
  moodAssistanceEnabled: boolean;
};

const BACKGROUND_LOCATION_UPLOAD_CONCURRENCY_LIMIT = 3;
const BACKGROUND_LOCATION_UPLOAD_TIMEOUT_BUDGET_MS = 45_000;
const BACKGROUND_LOCATION_UPLOAD_TIMEOUT_MS = 15_000;
const BACKGROUND_LOCATION_UPLOAD_TIMEOUT_ERROR_PREFIX =
  "background_location_upload_timeout";

type BackgroundLocationBatchUploadResult = {
  dayKey: string;
  observedAt: number;
  areaLabel: string;
  status: "succeeded" | "failed" | "timed_out" | "skipped_budget";
  error?: string;
};

type BackgroundLocationUploadAggregate = {
  totalBatches: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  skippedBudget: number;
  latestSuccessfulBatch?: {
    observedAt: number;
    areaLabel: string;
  };
  failures: string[];
};

function normalizeConcurrencyLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return 1;
  }

  return Math.max(1, Math.round(limit));
}

function isBackgroundLocationUploadTimeout(error: unknown): boolean {
  return toErrorMessage(error).startsWith(
    BACKGROUND_LOCATION_UPLOAD_TIMEOUT_ERROR_PREFIX,
  );
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  if (timeoutMs <= 0) {
    throw new Error(`${BACKGROUND_LOCATION_UPLOAD_TIMEOUT_ERROR_PREFIX}:0`);
  }

  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(
        new Error(
          `${BACKGROUND_LOCATION_UPLOAD_TIMEOUT_ERROR_PREFIX}:${timeoutMs}`,
        ),
      );
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

async function runWithConcurrencyLimit<TItem, TResult>(
  items: readonly TItem[],
  concurrencyLimit: number,
  runItem: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  const workerCount = Math.min(
    items.length,
    normalizeConcurrencyLimit(concurrencyLimit),
  );
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await runItem(
          items[currentIndex] as TItem,
          currentIndex,
        );
      }
    }),
  );

  return results;
}

function aggregateBackgroundLocationUploadResults(
  results: BackgroundLocationBatchUploadResult[],
): BackgroundLocationUploadAggregate {
  const aggregate: BackgroundLocationUploadAggregate = {
    totalBatches: results.length,
    succeeded: 0,
    failed: 0,
    timedOut: 0,
    skippedBudget: 0,
    failures: [],
  };

  for (const result of results) {
    if (result.status === "succeeded") {
      aggregate.succeeded += 1;
      if (
        !aggregate.latestSuccessfulBatch ||
        result.observedAt > aggregate.latestSuccessfulBatch.observedAt
      ) {
        aggregate.latestSuccessfulBatch = {
          observedAt: result.observedAt,
          areaLabel: result.areaLabel,
        };
      }
      continue;
    }

    if (result.status === "failed") {
      aggregate.failed += 1;
      aggregate.failures.push(
        `${result.dayKey}:${result.error ?? "unknown_error"}`,
      );
      continue;
    }

    if (result.status === "timed_out") {
      aggregate.timedOut += 1;
      aggregate.failures.push(`${result.dayKey}:timed_out`);
      continue;
    }

    aggregate.skippedBudget += 1;
    aggregate.failures.push(
      `${result.dayKey}:${result.error ?? "budget_exhausted"}`,
    );
  }

  return aggregate;
}

export function useIntegrationSync({
  isLoaded,
  isSignedIn,
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
      !isLoaded ||
      !isSignedIn ||
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

          let meetingsCount: number | undefined;
          let busyMinutes: number | undefined;
          let eventTitles: string[] | undefined;
          let calendarEventsSignals: string[] = [];
          let calendarSummaryFragment: string | null = null;

          if (Platform.OS === "ios") {
            const calendarSetupIssue = getAppleCalendarSetupIssue();
            if (!calendarSetupIssue) {
              try {
                const calendarData = await collectAppleCalendarDailyDataForDay(
                  dayKey,
                  userTimeZone,
                );

                if (cancelled) {
                  return;
                }

                meetingsCount =
                  calendarData.context.meetingsCount > 0
                    ? calendarData.context.meetingsCount
                    : undefined;
                busyMinutes =
                  calendarData.context.busyMinutes > 0
                    ? calendarData.context.busyMinutes
                    : undefined;
                eventTitles =
                  calendarData.context.eventTitles.length > 0
                    ? calendarData.context.eventTitles
                    : undefined;

                calendarEventsSignals = calendarData.signals;
                calendarSummaryFragment = calendarData.summary;
              } catch (error) {
                pipelineErrors.push(`calendar_events:${toErrorMessage(error)}`);
              }
            }
          }

          const summaryParts: string[] = [];
          if (calendarSummaryFragment) {
            summaryParts.push(calendarSummaryFragment);
          }
          summaryParts.push(
            remindersCount > 0
              ? `DayLog reminders active with ${remindersCount} scheduled notification(s).`
              : "No DayLog reminders scheduled for this day.",
          );

          await upsertMyContextualDailyData({
            type: "calendar",
            dayKey,
            summary: summaryParts.join(" "),
            signals: dedupeSignals([
              ...calendarEventsSignals,
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
                meetingsCount,
                busyMinutes,
                eventTitles,
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
      let uploadAggregate: BackgroundLocationUploadAggregate = {
        totalBatches: batches.length,
        succeeded: 0,
        failed: 0,
        timedOut: 0,
        skippedBudget: 0,
        failures: [],
      };

      if (
        preparedFlush !== null &&
        pipelineErrors.length === 0 &&
        batches.length > 0
      ) {
        const uploadBudgetStartedAt = Date.now();
        const uploadResults = await runWithConcurrencyLimit(
          batches,
          BACKGROUND_LOCATION_UPLOAD_CONCURRENCY_LIMIT,
          async (batch): Promise<BackgroundLocationBatchUploadResult> => {
            if (cancelled) {
              return {
                dayKey: batch.dayKey,
                observedAt: batch.observedAt,
                areaLabel: batch.areaLabel,
                status: "skipped_budget",
                error: "cancelled",
              };
            }

            const elapsedMs = Date.now() - uploadBudgetStartedAt;
            const remainingBudgetMs =
              BACKGROUND_LOCATION_UPLOAD_TIMEOUT_BUDGET_MS - elapsedMs;

            if (remainingBudgetMs <= 0) {
              return {
                dayKey: batch.dayKey,
                observedAt: batch.observedAt,
                areaLabel: batch.areaLabel,
                status: "skipped_budget",
                error: "budget_exhausted",
              };
            }

            const timeoutMs = Math.min(
              BACKGROUND_LOCATION_UPLOAD_TIMEOUT_MS,
              remainingBudgetMs,
            );

            try {
              await withTimeout(
                upsertMyIntegrationDailyData({
                  provider: "location",
                  dayKey: batch.dayKey,
                  summary: batch.summary,
                  signals: batch.signals,
                  context: batch.context,
                }),
                timeoutMs,
              );

              return {
                dayKey: batch.dayKey,
                observedAt: batch.observedAt,
                areaLabel: batch.areaLabel,
                status: "succeeded",
              };
            } catch (error) {
              return {
                dayKey: batch.dayKey,
                observedAt: batch.observedAt,
                areaLabel: batch.areaLabel,
                status: isBackgroundLocationUploadTimeout(error)
                  ? "timed_out"
                  : "failed",
                error: toErrorMessage(error),
              };
            }
          },
        );

        if (cancelled) {
          return;
        }

        uploadAggregate =
          aggregateBackgroundLocationUploadResults(uploadResults);

        logInfo("mobile_background_location_flush_upload_summary", {
          totalBatches: uploadAggregate.totalBatches,
          succeeded: uploadAggregate.succeeded,
          failed: uploadAggregate.failed,
          timedOut: uploadAggregate.timedOut,
          skippedBudget: uploadAggregate.skippedBudget,
          concurrencyLimit: BACKGROUND_LOCATION_UPLOAD_CONCURRENCY_LIMIT,
          timeoutBudgetMs: BACKGROUND_LOCATION_UPLOAD_TIMEOUT_BUDGET_MS,
        });

        if (uploadAggregate.latestSuccessfulBatch) {
          try {
            await updateMyLocationTrackingState({
              locationLastUpdatedAt:
                uploadAggregate.latestSuccessfulBatch.observedAt,
              locationLastArea: uploadAggregate.latestSuccessfulBatch.areaLabel,
            });
          } catch (error) {
            pipelineErrors.push(`location_state:${toErrorMessage(error)}`);
          }
        }

        for (const failure of uploadAggregate.failures) {
          pipelineErrors.push(`upload:${failure}`);
        }
      }

      const uploadSucceeded =
        preparedFlush !== null &&
        pipelineErrors.length === 0 &&
        uploadAggregate.failed === 0 &&
        uploadAggregate.timedOut === 0 &&
        uploadAggregate.skippedBudget === 0;

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
    isLoaded,
    isSignedIn,
    isAuthenticated,
    locationTrackingRuntimeConfig,
    moodAssistanceEnabled,
    updateMyLocationTrackingState,
    upsertMyContextualDailyData,
    upsertMyIntegrationDailyData,
  ]);
}
