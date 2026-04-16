import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  effectCleanups: [] as (() => void)[],
  syncReminderNotificationsMock: vi.fn(async () => undefined),
  logInfoMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

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

vi.mock("@/lib/reminder-notifications", () => ({
  syncReminderNotifications: runtime.syncReminderNotificationsMock,
}));

vi.mock("@/lib/observability", () => ({
  logInfo: runtime.logInfoMock,
  captureException: runtime.captureExceptionMock,
}));

type ForegroundTasksModule = typeof import("./use-foreground-tasks");

async function loadModule(): Promise<ForegroundTasksModule> {
  return await import("./use-foreground-tasks");
}

function runRegisteredCleanups(): void {
  while (runtime.effectCleanups.length > 0) {
    const cleanup = runtime.effectCleanups.pop();
    cleanup?.();
  }
}

describe("useForegroundTasks", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runtime.effectCleanups.length = 0;
  });

  it("guards when authentication or preferences are missing", async () => {
    const module = await loadModule();

    module.useForegroundTasks({
      isAuthenticated: false,
      launchPreferences: undefined,
    });

    module.useForegroundTasks({
      isAuthenticated: true,
      launchPreferences: undefined,
    });

    expect(runtime.syncReminderNotificationsMock).not.toHaveBeenCalled();
    expect(runtime.logInfoMock).not.toHaveBeenCalledWith(
      "mobile_foreground_tasks_module_started",
      expect.anything(),
    );
  });

  it("runs reminder sync and emits lifecycle logs", async () => {
    const module = await loadModule();
    const launchPreferences = {} as never;

    module.useForegroundTasks({
      isAuthenticated: true,
      launchPreferences,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.syncReminderNotificationsMock).toHaveBeenCalledWith(
      launchPreferences,
    );
    expect(runtime.logInfoMock).toHaveBeenCalledWith(
      "mobile_foreground_tasks_module_started",
      {
        taskId: "sync_reminder_notifications",
      },
    );
    expect(runtime.logInfoMock).toHaveBeenCalledWith(
      "mobile_foreground_tasks_module_succeeded",
      {
        taskId: "sync_reminder_notifications",
      },
    );
    expect(runtime.captureExceptionMock).not.toHaveBeenCalled();

    runRegisteredCleanups();

    expect(runtime.logInfoMock).toHaveBeenCalledWith(
      "mobile_foreground_tasks_module_stopped",
      {
        taskId: "sync_reminder_notifications",
      },
    );
  });

  it("captures exceptions when reminder sync fails", async () => {
    const module = await loadModule();
    const launchPreferences = {} as never;
    const error = new Error("reminder sync failed");

    runtime.syncReminderNotificationsMock.mockRejectedValueOnce(error);

    module.useForegroundTasks({
      isAuthenticated: true,
      launchPreferences,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.captureExceptionMock).toHaveBeenCalledWith(
      "mobile_foreground_tasks_module_failed",
      error,
      {
        taskId: "sync_reminder_notifications",
      },
    );

    runRegisteredCleanups();
  });
});
