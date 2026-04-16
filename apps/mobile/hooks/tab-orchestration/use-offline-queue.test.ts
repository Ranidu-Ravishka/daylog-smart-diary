import { beforeEach, describe, expect, it, vi } from "vitest";

type ConnectivityState = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
};

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
    netInfoListener: null as ((state: ConnectivityState) => void) | null,
    netInfoUnsubscribeMock: vi.fn(),
    netInfoAddEventListenerMock: vi.fn(),
    processOfflineOutboxMock: vi.fn(async () => ({
      processed: 0,
      retried: 0,
      dropped: 0,
      pending: 0,
    })),
    logInfoMock: vi.fn(),
    captureExceptionMock: vi.fn(),
    mutations: {
      createMemory: vi.fn(),
      generateMemoryMediaUploadUrl: vi.fn(),
      addMemoryMediaByClientRequestId: vi.fn(),
      appendDayLogEntries: vi.fn(),
    },
  };

  state.createBackgroundTaskRunnerMock.mockImplementation(() => state.runner);
  state.netInfoAddEventListenerMock.mockImplementation(
    (listener: (state: ConnectivityState) => void) => {
      state.netInfoListener = listener;
      return state.netInfoUnsubscribeMock;
    },
  );

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

vi.mock("@repo/backend/convex", () => ({
  api: {
    memories: {
      createMemory: "memories.createMemory",
      generateMemoryMediaUploadUrl: "memories.generateMemoryMediaUploadUrl",
      addMemoryMediaByClientRequestId:
        "memories.addMemoryMediaByClientRequestId",
    },
    days: {
      appendDayLogEntries: "days.appendDayLogEntries",
    },
  },
}));

vi.mock("convex/react", () => ({
  useMutation: vi.fn((mutationRef: string) => {
    switch (mutationRef) {
      case "memories.createMemory":
        return runtime.mutations.createMemory;
      case "memories.generateMemoryMediaUploadUrl":
        return runtime.mutations.generateMemoryMediaUploadUrl;
      case "memories.addMemoryMediaByClientRequestId":
        return runtime.mutations.addMemoryMediaByClientRequestId;
      case "days.appendDayLogEntries":
        return runtime.mutations.appendDayLogEntries;
      default:
        return vi.fn();
    }
  }),
}));

vi.mock("@react-native-community/netinfo", () => ({
  addEventListener: runtime.netInfoAddEventListenerMock,
  default: {
    addEventListener: runtime.netInfoAddEventListenerMock,
  },
}));

vi.mock("@/lib/background-task-runner", () => ({
  createBackgroundTaskRunner: runtime.createBackgroundTaskRunnerMock,
}));

vi.mock("@/lib/offline-outbox", () => ({
  processOfflineOutbox: runtime.processOfflineOutboxMock,
}));

vi.mock("@/lib/observability", () => ({
  logInfo: runtime.logInfoMock,
  captureException: runtime.captureExceptionMock,
}));

type OfflineQueueModule = typeof import("./use-offline-queue");

async function loadModule(): Promise<OfflineQueueModule> {
  return await import("./use-offline-queue");
}

function runRegisteredCleanups(): void {
  while (runtime.effectCleanups.length > 0) {
    const cleanup = runtime.effectCleanups.pop();
    cleanup?.();
  }
}

describe("useOfflineQueue", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runtime.effectCleanups.length = 0;
    runtime.netInfoListener = null;
  });

  it("guards when the user is not authenticated", async () => {
    const module = await loadModule();

    module.useOfflineQueue({
      isAuthenticated: false,
    });

    expect(runtime.createBackgroundTaskRunnerMock).not.toHaveBeenCalled();
    expect(runtime.netInfoAddEventListenerMock).not.toHaveBeenCalled();
  });

  it("registers offline queue task lifecycle and cleans up subscriptions", async () => {
    const module = await loadModule();

    module.useOfflineQueue({
      isAuthenticated: true,
    });

    expect(runtime.createBackgroundTaskRunnerMock).toHaveBeenCalledTimes(1);
    expect(runtime.runner.registerTask).toHaveBeenCalledTimes(1);

    const registeredTask = runtime.runner.registerTask.mock.calls[0]?.[0] as {
      taskId: string;
      intervalMs: number;
      retryPolicy: {
        maxAttempts: number;
        baseDelayMs: number;
        maxDelayMs: number;
      };
      run: () => Promise<void>;
    };

    expect(registeredTask.taskId).toBe("offline_outbox_flush");
    expect(registeredTask.intervalMs).toBe(20_000);
    expect(registeredTask.retryPolicy).toEqual({
      maxAttempts: 3,
      baseDelayMs: 10_000,
      maxDelayMs: 120_000,
    });
    expect(typeof registeredTask.run).toBe("function");

    expect(runtime.runner.start).toHaveBeenCalledTimes(1);
    expect(runtime.runner.triggerTaskNow).toHaveBeenCalledWith(
      "offline_outbox_flush",
    );

    await Promise.resolve();
    await Promise.resolve();

    if (runtime.netInfoListener) {
      runtime.netInfoListener({
        isConnected: true,
        isInternetReachable: true,
      });

      expect(runtime.runner.triggerTaskNow).toHaveBeenCalledTimes(2);
    }

    runRegisteredCleanups();

    expect(runtime.runner.stop).toHaveBeenCalledTimes(1);
    expect(runtime.logInfoMock).toHaveBeenCalledWith(
      "mobile_offline_queue_module_started",
      {
        taskId: "offline_outbox_flush",
      },
    );
    expect(runtime.logInfoMock).toHaveBeenCalledWith(
      "mobile_offline_queue_module_stopped",
      {
        taskId: "offline_outbox_flush",
      },
    );
  });

  it("logs failed offline flush execution events", async () => {
    const module = await loadModule();

    module.useOfflineQueue({
      isAuthenticated: true,
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
      taskId: "offline_outbox_flush",
      status: "failed",
      attempt: 2,
      queueDepth: 1,
      durationMs: 420,
      error: "network_down",
      nextRunAt: Date.now() + 1_000,
    });

    expect(runtime.logInfoMock).toHaveBeenCalledWith(
      "mobile_offline_outbox_task_execution",
      expect.objectContaining({
        taskId: "offline_outbox_flush",
        status: "failed",
        error: "network_down",
      }),
    );

    runRegisteredCleanups();
  });
});
