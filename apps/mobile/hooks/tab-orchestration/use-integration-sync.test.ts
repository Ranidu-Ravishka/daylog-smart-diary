import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const state = {
    effectCleanups: [] as (() => void)[],
    runner: {
      registerTask: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      triggerTaskNow: vi.fn(),
    },
    createBackgroundTaskRunnerMock: vi.fn(),
    logInfoMock: vi.fn(),
    captureExceptionMock: vi.fn(),
    mutations: {
      upsertMyIntegrationDailyData: vi.fn(),
      upsertMyContextualDailyData: vi.fn(),
      updateMyLocationTrackingState: vi.fn(),
    },
  };

  state.createBackgroundTaskRunnerMock.mockImplementation(() => state.runner);

  return state;
});

vi.mock("react", async () => {
  const actual = await vi.importActual<any>("react");
  const mockedUseEffect = vi.fn((effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (typeof cleanup === "function") {
      runtime.effectCleanups.push(cleanup);
    }
  });

  return {
    ...actual,
    default: {
      ...actual.default,
      useEffect: mockedUseEffect,
    },
    useEffect: mockedUseEffect,
  };
});

vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
  },
}));

vi.mock("@repo/backend/convex", () => ({
  api: {
    integrations: {
      upsertMyIntegrationDailyData: "integrations.upsertMyIntegrationDailyData",
      upsertMyContextualDailyData: "integrations.upsertMyContextualDailyData",
    },
    userPreferences: {
      updateMyLocationTrackingState:
        "userPreferences.updateMyLocationTrackingState",
    },
  },
}));

vi.mock("convex/react", () => ({
  useMutation: vi.fn((mutationRef: string) => {
    switch (mutationRef) {
      case "integrations.upsertMyIntegrationDailyData":
        return runtime.mutations.upsertMyIntegrationDailyData;
      case "integrations.upsertMyContextualDailyData":
        return runtime.mutations.upsertMyContextualDailyData;
      case "userPreferences.updateMyLocationTrackingState":
        return runtime.mutations.updateMyLocationTrackingState;
      default:
        return vi.fn();
    }
  }),
}));

vi.mock("@repo/ui/lib/day-window", () => ({
  getDayKeyForTimestamp: vi.fn(() => "2026-04-16"),
  getResolvedTimeZone: vi.fn(() => "UTC"),
}));

vi.mock("@/lib/android-call-activity-sync", () => ({
  collectAndroidCallActivityForDay: vi.fn(async () => ({
    metrics: {
      callsCount: 0,
      callDurationMinutes: 0,
    },
  })),
  isAndroidCallActivityCollectionSupported: vi.fn(() => false),
}));

vi.mock("@/lib/activity-summary-context", () => ({
  buildActivitySummaryContext: vi.fn(() => ({
    summary: "",
    signals: [],
    context: {
      schemaVersion: 1,
    },
  })),
}));

vi.mock("@/lib/apple-health-sync", () => ({
  collectAppleHealthDailyDataForDay: vi.fn(async () => ({
    summary: "",
    signals: [],
    metrics: {
      steps: 0,
      sleepMinutes: 0,
    },
  })),
  getAppleHealthSetupIssue: vi.fn(() => "not_enabled"),
}));

vi.mock("@/lib/background-location-tracker", () => ({
  acknowledgeBackgroundLocationFlush: vi.fn(async () => ({
    acknowledged: true,
  })),
  getBackgroundLocationTelemetry: vi.fn(async () => ({
    autoDisabled: false,
  })),
  prepareBackgroundLocationFlushBatches: vi.fn(async () => ({
    flushId: "flush_001",
    batches: [],
  })),
}));

vi.mock("@/lib/background-task-runner", () => ({
  createBackgroundTaskRunner: runtime.createBackgroundTaskRunnerMock,
}));

vi.mock("@/lib/reminder-notifications", () => ({
  getReminderRuntimeState: vi.fn(async () => ({
    scheduledCount: 0,
    permissionStatus: "granted",
  })),
}));

vi.mock("@/lib/observability", () => ({
  logInfo: runtime.logInfoMock,
  captureException: runtime.captureExceptionMock,
}));

type IntegrationSyncModule = typeof import("./use-integration-sync");

async function loadModule(): Promise<IntegrationSyncModule> {
  return await import("./use-integration-sync");
}

function getRegisteredTask(taskId: string): { run: () => Promise<void> } {
  const task = runtime.runner.registerTask.mock.calls
    .map((call) => call[0])
    .find((registeredTask) => registeredTask?.taskId === taskId);

  if (!task) {
    throw new Error(`Task not registered: ${taskId}`);
  }

  return task as { run: () => Promise<void> };
}

function runRegisteredCleanups(): void {
  while (runtime.effectCleanups.length > 0) {
    const cleanup = runtime.effectCleanups.pop();
    cleanup?.();
  }
}

describe("useIntegrationSync", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    vi.clearAllMocks();
    runtime.effectCleanups.length = 0;
  });

  it("guards when authentication or launch prerequisites are missing", async () => {
    const module = await loadModule();

    module.useIntegrationSync({
      isAuthenticated: true,
      hasLaunchPreferencesRecord: false,
      locationTrackingRuntimeConfig: {
        enableBackgroundLocationTracking: true,
        batchMaxPoints: 40,
        maxUpdatesPerHour: 12,
        batchFlushIntervalMinutes: 10,
        maxBatteryDrainPercentPerHour: 8,
      },
      fitnessTrackingEnabled: true,
      calendarContextEnabled: true,
      callSummaryEnabled: false,
      moodAssistanceEnabled: false,
    });

    module.useIntegrationSync({
      isAuthenticated: false,
      hasLaunchPreferencesRecord: true,
      locationTrackingRuntimeConfig: {
        enableBackgroundLocationTracking: true,
        batchMaxPoints: 40,
        maxUpdatesPerHour: 12,
        batchFlushIntervalMinutes: 10,
        maxBatteryDrainPercentPerHour: 8,
      },
      fitnessTrackingEnabled: true,
      calendarContextEnabled: true,
      callSummaryEnabled: false,
      moodAssistanceEnabled: false,
    });

    expect(runtime.createBackgroundTaskRunnerMock).not.toHaveBeenCalled();
  });

  it("registers integration tasks, triggers execution, and stops runner on cleanup", async () => {
    const module = await loadModule();

    module.useIntegrationSync({
      isAuthenticated: true,
      hasLaunchPreferencesRecord: true,
      locationTrackingRuntimeConfig: {
        enableBackgroundLocationTracking: true,
        batchMaxPoints: 120,
        maxUpdatesPerHour: 20,
        batchFlushIntervalMinutes: 2,
        maxBatteryDrainPercentPerHour: 6,
      },
      fitnessTrackingEnabled: true,
      calendarContextEnabled: false,
      callSummaryEnabled: false,
      moodAssistanceEnabled: true,
    });

    expect(runtime.createBackgroundTaskRunnerMock).toHaveBeenCalledTimes(1);
    expect(runtime.runner.registerTask).toHaveBeenCalledTimes(2);

    const firstTask = runtime.runner.registerTask.mock.calls[0]?.[0] as {
      taskId: string;
      intervalMs: number;
    };
    const secondTask = runtime.runner.registerTask.mock.calls[1]?.[0] as {
      taskId: string;
      intervalMs: number;
    };

    expect(firstTask.taskId).toBe("life_context_signals");
    expect(firstTask.intervalMs).toBe(2_700_000);
    expect(secondTask.taskId).toBe("background_location_flush");
    expect(secondTask.intervalMs).toBe(300_000);

    expect(runtime.runner.start).toHaveBeenCalledTimes(1);
    expect(runtime.runner.triggerTaskNow).toHaveBeenCalledWith(
      "life_context_signals",
    );
    expect(runtime.runner.triggerTaskNow).toHaveBeenCalledWith(
      "background_location_flush",
    );

    runRegisteredCleanups();

    expect(runtime.runner.stop).toHaveBeenCalledTimes(1);
    expect(runtime.logInfoMock).toHaveBeenCalledWith(
      "mobile_integration_sync_module_started",
      {
        taskIds: ["life_context_signals", "background_location_flush"],
      },
    );
    expect(runtime.logInfoMock).toHaveBeenCalledWith(
      "mobile_integration_sync_module_stopped",
      {
        taskIds: ["life_context_signals", "background_location_flush"],
      },
    );
  });

  it("captures failed integration task executions", async () => {
    const module = await loadModule();

    module.useIntegrationSync({
      isAuthenticated: true,
      hasLaunchPreferencesRecord: true,
      locationTrackingRuntimeConfig: {
        enableBackgroundLocationTracking: true,
        batchMaxPoints: 120,
        maxUpdatesPerHour: 20,
        batchFlushIntervalMinutes: 2,
        maxBatteryDrainPercentPerHour: 6,
      },
      fitnessTrackingEnabled: true,
      calendarContextEnabled: false,
      callSummaryEnabled: false,
      moodAssistanceEnabled: true,
    });

    const runnerConfig = runtime.createBackgroundTaskRunnerMock.mock
      .calls[0]?.[0] as {
      onExecution?: (event: {
        taskId: string;
        status: string;
        attempt: number;
        queueDepth: number;
        durationMs: number;
        error?: string;
        nextRunAt?: number;
      }) => void;
    };

    runnerConfig.onExecution?.({
      taskId: "background_location_flush",
      status: "failed",
      attempt: 3,
      queueDepth: 2,
      durationMs: 640,
      error: "upload_failed",
      nextRunAt: Date.now() + 10_000,
    });

    expect(runtime.captureExceptionMock).toHaveBeenCalled();

    const lastCall =
      runtime.captureExceptionMock.mock.calls[
        runtime.captureExceptionMock.mock.calls.length - 1
      ];
    expect(lastCall?.[0]).toBe("mobile_integration_sync_task_failed");
    expect(lastCall?.[1]).toBeInstanceOf(Error);
    expect((lastCall?.[1] as Error).message).toBe("upload_failed");
    expect(lastCall?.[2]).toEqual({
      taskId: "background_location_flush",
      attempt: 3,
    });

    runRegisteredCleanups();
  });

  it("runs background location uploads with bounded concurrency and aggregates success", async () => {
    vi.useFakeTimers();

    try {
      const module = await loadModule();
      const backgroundLocationTrackerModule = await import(
        "@/lib/background-location-tracker"
      );

      const prepareFlushMock = vi.mocked(
        backgroundLocationTrackerModule.prepareBackgroundLocationFlushBatches,
      );
      const acknowledgeFlushMock = vi.mocked(
        backgroundLocationTrackerModule.acknowledgeBackgroundLocationFlush,
      );
      const telemetryMock = vi.mocked(
        backgroundLocationTrackerModule.getBackgroundLocationTelemetry,
      );

      prepareFlushMock.mockResolvedValue({
        flushId: "flush_bounded_concurrency",
        preparedAt: Date.now(),
        queuedPointCount: 4,
        batches: [
          {
            dayKey: "2026-04-13",
            summary: "batch 1",
            signals: [],
            observedAt: 10,
            areaLabel: "A",
          },
          {
            dayKey: "2026-04-14",
            summary: "batch 2",
            signals: [],
            observedAt: 20,
            areaLabel: "B",
          },
          {
            dayKey: "2026-04-15",
            summary: "batch 3",
            signals: [],
            observedAt: 30,
            areaLabel: "C",
          },
          {
            dayKey: "2026-04-16",
            summary: "batch 4",
            signals: [],
            observedAt: 40,
            areaLabel: "D",
          },
        ],
      });
      acknowledgeFlushMock.mockResolvedValue({
        acknowledged: true,
        flushId: "flush_bounded_concurrency",
        removedPointCount: 4,
        remainingQueueSize: 0,
      });
      telemetryMock.mockResolvedValue({
        updatesInWindow: 0,
        windowStartedAt: Date.now(),
        autoDisabled: false,
        queueSize: 0,
      });

      let activeUploads = 0;
      let maxActiveUploads = 0;
      runtime.mutations.upsertMyIntegrationDailyData.mockImplementation(
        async () => {
          activeUploads += 1;
          maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 25);
          });
          activeUploads -= 1;
        },
      );

      module.useIntegrationSync({
        isAuthenticated: true,
        hasLaunchPreferencesRecord: true,
        locationTrackingRuntimeConfig: {
          enableBackgroundLocationTracking: true,
          batchMaxPoints: 120,
          maxUpdatesPerHour: 20,
          batchFlushIntervalMinutes: 2,
          maxBatteryDrainPercentPerHour: 6,
        },
        fitnessTrackingEnabled: true,
        calendarContextEnabled: false,
        callSummaryEnabled: false,
        moodAssistanceEnabled: true,
      });

      const backgroundTask = getRegisteredTask("background_location_flush");
      const runPromise = backgroundTask.run();

      await vi.advanceTimersByTimeAsync(200);
      await runPromise;

      expect(maxActiveUploads).toBe(3);
      expect(acknowledgeFlushMock).toHaveBeenCalledWith(
        "flush_bounded_concurrency",
      );
      expect(
        runtime.mutations.updateMyLocationTrackingState,
      ).toHaveBeenCalledWith({
        locationLastUpdatedAt: 40,
        locationLastArea: "D",
      });
      expect(runtime.logInfoMock).toHaveBeenCalledWith(
        "mobile_background_location_flush_upload_summary",
        expect.objectContaining({
          totalBatches: 4,
          succeeded: 4,
          failed: 0,
          timedOut: 0,
          skippedBudget: 0,
          concurrencyLimit: 3,
        }),
      );

      runRegisteredCleanups();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies upload timeout budget and aggregates timeout failures", async () => {
    vi.useFakeTimers();

    try {
      const module = await loadModule();
      const backgroundLocationTrackerModule = await import(
        "@/lib/background-location-tracker"
      );

      const prepareFlushMock = vi.mocked(
        backgroundLocationTrackerModule.prepareBackgroundLocationFlushBatches,
      );
      const acknowledgeFlushMock = vi.mocked(
        backgroundLocationTrackerModule.acknowledgeBackgroundLocationFlush,
      );
      const telemetryMock = vi.mocked(
        backgroundLocationTrackerModule.getBackgroundLocationTelemetry,
      );

      prepareFlushMock.mockResolvedValue({
        flushId: "flush_timeout_budget",
        preparedAt: Date.now(),
        queuedPointCount: 1,
        batches: [
          {
            dayKey: "2026-04-16",
            summary: "timeout batch",
            signals: [],
            observedAt: 50,
            areaLabel: "Timeout City",
          },
        ],
      });
      acknowledgeFlushMock.mockResolvedValue({
        acknowledged: true,
        flushId: "flush_timeout_budget",
        removedPointCount: 1,
        remainingQueueSize: 0,
      });
      telemetryMock.mockResolvedValue({
        updatesInWindow: 0,
        windowStartedAt: Date.now(),
        autoDisabled: false,
        queueSize: 1,
      });

      runtime.mutations.upsertMyIntegrationDailyData.mockImplementation(
        () => new Promise<void>(() => undefined),
      );

      module.useIntegrationSync({
        isAuthenticated: true,
        hasLaunchPreferencesRecord: true,
        locationTrackingRuntimeConfig: {
          enableBackgroundLocationTracking: true,
          batchMaxPoints: 120,
          maxUpdatesPerHour: 20,
          batchFlushIntervalMinutes: 2,
          maxBatteryDrainPercentPerHour: 6,
        },
        fitnessTrackingEnabled: true,
        calendarContextEnabled: false,
        callSummaryEnabled: false,
        moodAssistanceEnabled: true,
      });

      const backgroundTask = getRegisteredTask("background_location_flush");
      const runPromise = backgroundTask.run();
      const runExpectation = expect(runPromise).rejects.toThrow(
        /background_location_pipeline_failed/,
      );

      await vi.advanceTimersByTimeAsync(15_000);

      await runExpectation;
      expect(acknowledgeFlushMock).not.toHaveBeenCalled();
      expect(runtime.logInfoMock).toHaveBeenCalledWith(
        "mobile_background_location_flush_upload_summary",
        expect.objectContaining({
          totalBatches: 1,
          succeeded: 0,
          timedOut: 1,
        }),
      );

      runRegisteredCleanups();
    } finally {
      vi.useRealTimers();
    }
  });
});
