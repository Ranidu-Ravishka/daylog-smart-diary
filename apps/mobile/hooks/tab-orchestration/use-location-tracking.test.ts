import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  effectCleanups: [] as (() => void)[],
  setBackgroundLocationEncryptionSessionMock: vi.fn(async () => undefined),
  startBackgroundLocationTrackerMock: vi.fn(async () => ({
    started: true,
  })),
  stopBackgroundLocationTrackerMock: vi.fn(async () => undefined),
  foregroundStopMock: vi.fn(),
  startForegroundLocationTrackerMock: vi.fn(),
  logInfoMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  mutations: {
    upsertMyIntegrationDailyData: vi.fn(async () => undefined),
    updateMyLocationTrackingState: vi.fn(async () => undefined),
  },
}));

runtime.startForegroundLocationTrackerMock.mockImplementation(
  async () => runtime.foregroundStopMock,
);

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
    integrations: {
      upsertMyIntegrationDailyData: "integrations.upsertMyIntegrationDailyData",
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
      case "userPreferences.updateMyLocationTrackingState":
        return runtime.mutations.updateMyLocationTrackingState;
      default:
        return vi.fn();
    }
  }),
}));

vi.mock("@/lib/background-location-tracker", () => ({
  setBackgroundLocationEncryptionSession:
    runtime.setBackgroundLocationEncryptionSessionMock,
  startBackgroundLocationTracker: runtime.startBackgroundLocationTrackerMock,
  stopBackgroundLocationTracker: runtime.stopBackgroundLocationTrackerMock,
}));

vi.mock("@/lib/foreground-location-tracker", () => ({
  startForegroundLocationTracker: runtime.startForegroundLocationTrackerMock,
}));

vi.mock("@/lib/observability", () => ({
  logInfo: runtime.logInfoMock,
  captureException: runtime.captureExceptionMock,
}));

type LocationTrackingModule = typeof import("./use-location-tracking");

async function loadModule(): Promise<LocationTrackingModule> {
  return await import("./use-location-tracking");
}

function runRegisteredCleanups(): void {
  while (runtime.effectCleanups.length > 0) {
    const cleanup = runtime.effectCleanups.pop();
    cleanup?.();
  }
}

describe("useLocationTracking", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runtime.effectCleanups.length = 0;

    runtime.startBackgroundLocationTrackerMock.mockResolvedValue({
      started: true,
    });
    runtime.startForegroundLocationTrackerMock.mockImplementation(
      async () => runtime.foregroundStopMock,
    );
  });

  it("guards all tracking effects when prerequisites are not met", async () => {
    const module = await loadModule();

    module.useLocationTracking({
      isLoaded: false,
      isSignedIn: false,
      sessionId: null,
      userId: null,
      isAuthenticated: false,
      hasLoadedLaunchPreferences: false,
      locationTrackingEnabled: false,
      backgroundLocationTrackingEnabled: false,
      locationTrackingRuntimeConfig: undefined,
    });

    expect(
      runtime.setBackgroundLocationEncryptionSessionMock,
    ).not.toHaveBeenCalled();
    expect(runtime.startForegroundLocationTrackerMock).not.toHaveBeenCalled();
    expect(runtime.startBackgroundLocationTrackerMock).not.toHaveBeenCalled();
    expect(runtime.stopBackgroundLocationTrackerMock).not.toHaveBeenCalled();
  });

  it("starts foreground/background tracking and cleans up foreground lifecycle", async () => {
    const module = await loadModule();

    module.useLocationTracking({
      isLoaded: true,
      isSignedIn: true,
      sessionId: "sess_123",
      userId: "user_123",
      isAuthenticated: true,
      hasLoadedLaunchPreferences: true,
      locationTrackingEnabled: true,
      backgroundLocationTrackingEnabled: true,
      locationTrackingRuntimeConfig: {
        enableBackgroundLocationTracking: true,
        batchMaxPoints: 120,
        maxUpdatesPerHour: 30,
        batchFlushIntervalMinutes: 10,
        maxBatteryDrainPercentPerHour: 7,
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(
      runtime.setBackgroundLocationEncryptionSessionMock,
    ).toHaveBeenCalledWith("user_123:sess_123");
    expect(runtime.startForegroundLocationTrackerMock).toHaveBeenCalledTimes(1);
    expect(runtime.startBackgroundLocationTrackerMock).toHaveBeenCalledTimes(1);
    expect(runtime.startBackgroundLocationTrackerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        explicitOptIn: true,
        runtimeConfig: expect.objectContaining({
          enabled: true,
          batchMaxPoints: 120,
          maxUpdatesPerHour: 30,
          batchFlushIntervalMinutes: 10,
          maxBatteryDrainPercentPerHour: 7,
        }),
      }),
    );
    expect(
      runtime.mutations.updateMyLocationTrackingState,
    ).toHaveBeenCalledWith({
      locationPermissionStatus: "granted",
    });

    runRegisteredCleanups();

    expect(runtime.foregroundStopMock).toHaveBeenCalledTimes(1);
  });

  it("stops background tracker when explicit opt-in is disabled", async () => {
    const module = await loadModule();

    module.useLocationTracking({
      isLoaded: true,
      isSignedIn: true,
      sessionId: "sess_999",
      userId: "user_999",
      isAuthenticated: true,
      hasLoadedLaunchPreferences: true,
      locationTrackingEnabled: false,
      backgroundLocationTrackingEnabled: true,
      locationTrackingRuntimeConfig: {
        enableBackgroundLocationTracking: true,
        batchMaxPoints: 60,
        maxUpdatesPerHour: 16,
        batchFlushIntervalMinutes: 15,
        maxBatteryDrainPercentPerHour: 8,
      },
    });

    await Promise.resolve();

    expect(runtime.startForegroundLocationTrackerMock).not.toHaveBeenCalled();
    expect(runtime.stopBackgroundLocationTrackerMock).toHaveBeenCalledTimes(1);
    expect(runtime.startBackgroundLocationTrackerMock).not.toHaveBeenCalled();
  });

  it("captures foreground tracker startup failures", async () => {
    const module = await loadModule();
    const error = new Error("foreground tracker failed");

    runtime.startForegroundLocationTrackerMock.mockRejectedValueOnce(error);

    module.useLocationTracking({
      isLoaded: true,
      isSignedIn: true,
      sessionId: "sess_321",
      userId: "user_321",
      isAuthenticated: true,
      hasLoadedLaunchPreferences: true,
      locationTrackingEnabled: true,
      backgroundLocationTrackingEnabled: false,
      locationTrackingRuntimeConfig: undefined,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.captureExceptionMock).toHaveBeenCalledWith(
      "mobile_location_tracking_foreground_failed",
      error,
    );

    runRegisteredCleanups();
  });

  it("captures background tracker startup failures", async () => {
    const module = await loadModule();
    const error = new Error("background tracker failed");

    runtime.startBackgroundLocationTrackerMock.mockRejectedValueOnce(error);

    module.useLocationTracking({
      isLoaded: true,
      isSignedIn: true,
      sessionId: "sess_654",
      userId: "user_654",
      isAuthenticated: true,
      hasLoadedLaunchPreferences: true,
      locationTrackingEnabled: true,
      backgroundLocationTrackingEnabled: true,
      locationTrackingRuntimeConfig: {
        enableBackgroundLocationTracking: true,
        batchMaxPoints: 80,
        maxUpdatesPerHour: 24,
        batchFlushIntervalMinutes: 10,
        maxBatteryDrainPercentPerHour: 7,
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.captureExceptionMock).toHaveBeenCalledWith(
      "mobile_location_tracking_background_failed",
      error,
    );

    runRegisteredCleanups();
  });

  it("captures onUpload failures in the foreground tracker callback", async () => {
    const module = await loadModule();
    const uploadError = new Error("integration upload failed");

    module.useLocationTracking({
      isLoaded: true,
      isSignedIn: true,
      sessionId: "sess_777",
      userId: "user_777",
      isAuthenticated: true,
      hasLoadedLaunchPreferences: true,
      locationTrackingEnabled: true,
      backgroundLocationTrackingEnabled: false,
      locationTrackingRuntimeConfig: undefined,
    });

    await Promise.resolve();
    await Promise.resolve();

    const foregroundConfig = runtime.startForegroundLocationTrackerMock.mock
      .calls[0]?.[0] as {
      onUpload: (payload: {
        dayKey: string;
        summary: string;
        signals: string[];
        context: {
          schemaVersion: number;
        };
        observedAt: number;
        areaLabel?: string;
      }) => Promise<void>;
    };

    runtime.captureExceptionMock.mockClear();
    runtime.mutations.upsertMyIntegrationDailyData.mockRejectedValueOnce(
      uploadError,
    );

    await expect(
      foregroundConfig.onUpload({
        dayKey: "2026-04-16",
        summary: "Visited office",
        signals: ["commute"],
        context: {
          schemaVersion: 1,
        },
        observedAt: Date.now(),
        areaLabel: "Office",
      }),
    ).rejects.toThrow("integration upload failed");

    expect(runtime.captureExceptionMock).toHaveBeenCalledWith(
      "mobile_location_tracking_foreground_upload_failed",
      uploadError,
      {
        dayKey: "2026-04-16",
      },
    );

    runRegisteredCleanups();
  });

  it("captures denied status persistence failures in onStatusUpdate", async () => {
    const module = await loadModule();
    const statusError = new Error("persist denied status failed");

    module.useLocationTracking({
      isLoaded: true,
      isSignedIn: true,
      sessionId: "sess_888",
      userId: "user_888",
      isAuthenticated: true,
      hasLoadedLaunchPreferences: true,
      locationTrackingEnabled: true,
      backgroundLocationTrackingEnabled: false,
      locationTrackingRuntimeConfig: undefined,
    });

    await Promise.resolve();
    await Promise.resolve();

    const foregroundConfig = runtime.startForegroundLocationTrackerMock.mock
      .calls[0]?.[0] as {
      onStatusUpdate: (status: {
        permissionStatus: "denied" | "unknown";
      }) => void;
    };

    runtime.captureExceptionMock.mockClear();
    runtime.mutations.updateMyLocationTrackingState.mockRejectedValueOnce(
      statusError,
    );

    foregroundConfig.onStatusUpdate({
      permissionStatus: "denied",
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.captureExceptionMock).toHaveBeenCalledWith(
      "mobile_location_tracking_status_update_failed",
      statusError,
      {
        permissionStatus: "denied",
      },
    );

    runRegisteredCleanups();
  });

  it("captures unknown status persistence failures in onStatusUpdate", async () => {
    const module = await loadModule();
    const statusError = new Error("persist unknown status failed");

    module.useLocationTracking({
      isLoaded: true,
      isSignedIn: true,
      sessionId: "sess_889",
      userId: "user_889",
      isAuthenticated: true,
      hasLoadedLaunchPreferences: true,
      locationTrackingEnabled: true,
      backgroundLocationTrackingEnabled: false,
      locationTrackingRuntimeConfig: undefined,
    });

    await Promise.resolve();
    await Promise.resolve();

    const foregroundConfig = runtime.startForegroundLocationTrackerMock.mock
      .calls[0]?.[0] as {
      onStatusUpdate: (status: {
        permissionStatus: "denied" | "unknown";
      }) => void;
    };

    runtime.captureExceptionMock.mockClear();
    runtime.mutations.updateMyLocationTrackingState.mockRejectedValueOnce(
      statusError,
    );

    foregroundConfig.onStatusUpdate({
      permissionStatus: "unknown",
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.captureExceptionMock).toHaveBeenCalledWith(
      "mobile_location_tracking_status_update_failed",
      statusError,
      {
        permissionStatus: "unknown",
      },
    );

    runRegisteredCleanups();
  });
});
