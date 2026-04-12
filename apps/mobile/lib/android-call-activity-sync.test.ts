import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __setCallLogModuleLoaderForTests,
  collectAndroidCallActivityForDay,
  getAndroidCallActivityRuntimeDiagnostics,
  isAndroidCallActivityCollectionSupported,
  requestAndroidCallActivityPermission,
} from "./android-call-activity-sync";

const { platform } = vi.hoisted(() => ({
  platform: {
    OS: "android" as "android" | "ios" | "web",
  },
}));

vi.mock("react-native", () => ({
  Platform: platform,
}));

describe("android call activity collector", () => {
  beforeEach(() => {
    platform.OS = "android";
    __setCallLogModuleLoaderForTests(null);
  });

  it("aggregates only completed in-window calls", async () => {
    const bridge = {
      checkPermission: vi.fn(async () => true),
      loadAll: vi.fn(async () => [
        {
          timestamp: Date.UTC(2026, 3, 6, 1, 0, 0),
          duration: 90,
          type: "incoming",
        },
        {
          timestamp: Date.UTC(2026, 3, 6, 2, 0, 0),
          duration: "120",
          type: "outgoing",
        },
        {
          dateTime: new Date(Date.UTC(2026, 3, 6, 3, 0, 0)).toISOString(),
          duration: "40",
          type: "dialed",
        },
        {
          timestamp: Date.UTC(2026, 3, 6, 4, 0, 0),
          duration: 30,
          type: "missed",
        },
        {
          timestamp: Date.UTC(2026, 3, 6, 5, 0, 0),
          duration: 0,
          type: "incoming",
        },
        {
          timestamp: Date.UTC(2026, 3, 7, 0, 0, 1),
          duration: 60,
          type: "incoming",
        },
      ]),
    };

    __setCallLogModuleLoaderForTests(() => bridge);

    const result = await collectAndroidCallActivityForDay("2026-04-06", "UTC");

    expect(result.metrics).toEqual({
      callsCount: 3,
      callDurationMinutes: 4,
    });
    expect(result.summary).toBe("You had 3 calls totaling 4 minutes.");
    expect(result.signals).toEqual(["3 calls", "4 total call minutes"]);
    expect(bridge.checkPermission).toHaveBeenCalledTimes(1);
    expect(bridge.loadAll).toHaveBeenCalledTimes(1);
  });

  it("reports support only when Android bridge is available", () => {
    __setCallLogModuleLoaderForTests(() => {
      throw new Error("missing module");
    });
    expect(isAndroidCallActivityCollectionSupported()).toBe(false);

    __setCallLogModuleLoaderForTests(() => ({
      loadAll: async () => [],
    }));
    expect(isAndroidCallActivityCollectionSupported()).toBe(true);

    platform.OS = "ios";
    expect(isAndroidCallActivityCollectionSupported()).toBe(false);
  });

  it("reports runtime diagnostics as not supported on non-android platforms", async () => {
    platform.OS = "ios";

    await expect(getAndroidCallActivityRuntimeDiagnostics()).resolves.toEqual({
      moduleStatus: "not_supported",
      permissionStatus: "not_supported",
      detail: "Call activity is supported only on Android.",
    });
  });

  it("reports runtime diagnostics when module is missing", async () => {
    __setCallLogModuleLoaderForTests(() => {
      throw new Error("missing module");
    });

    const diagnostics = await getAndroidCallActivityRuntimeDiagnostics();
    expect(diagnostics.moduleStatus).toBe("missing");
    expect(diagnostics.permissionStatus).toBe("unknown");
  });

  it("reports runtime diagnostics when permission is granted", async () => {
    const bridge = {
      checkPermission: vi.fn(async () => true),
    };
    __setCallLogModuleLoaderForTests(() => bridge);

    await expect(getAndroidCallActivityRuntimeDiagnostics()).resolves.toEqual({
      moduleStatus: "available",
      permissionStatus: "granted",
      detail: "Call activity permission granted.",
    });
  });

  it("reports runtime diagnostics when permission check API is unavailable", async () => {
    __setCallLogModuleLoaderForTests(() => ({
      loadAll: async () => [],
    }));

    await expect(getAndroidCallActivityRuntimeDiagnostics()).resolves.toEqual({
      moduleStatus: "available",
      permissionStatus: "unknown",
      detail:
        "Permission check API is unavailable on the call activity bridge.",
    });
  });

  it("returns false permission result on non-android platforms", async () => {
    platform.OS = "ios";

    const bridge = {
      checkPermission: vi.fn(async () => true),
    };

    await expect(requestAndroidCallActivityPermission(bridge)).resolves.toBe(
      false,
    );
    expect(bridge.checkPermission).not.toHaveBeenCalled();
  });

  it("short-circuits permission request when already granted", async () => {
    const bridge = {
      checkPermission: vi.fn(async () => true),
      requestReadPermission: vi.fn(async () => false),
    };

    await expect(requestAndroidCallActivityPermission(bridge)).resolves.toBe(
      true,
    );
    expect(bridge.requestReadPermission).not.toHaveBeenCalled();
  });

  it("falls back to getAll when loadAll is unavailable", async () => {
    const bridge = {
      checkPermission: vi.fn(async () => false),
      requestReadPermission: vi.fn(async () => true),
      getAll: vi.fn(async () => [
        {
          timestamp: Date.UTC(2026, 3, 6, 12, 0, 0),
          duration: 65,
          type: "incoming",
        },
      ]),
    };

    __setCallLogModuleLoaderForTests(() => bridge);

    const result = await collectAndroidCallActivityForDay("2026-04-06", "UTC");

    expect(result.metrics).toEqual({
      callsCount: 1,
      callDurationMinutes: 1,
    });
    expect(bridge.requestReadPermission).toHaveBeenCalledTimes(1);
    expect(bridge.getAll).toHaveBeenCalledTimes(1);
  });

  it("throws when call activity permission is denied", async () => {
    const bridge = {
      checkPermission: vi.fn(async () => false),
      requestReadPermission: vi.fn(async () => false),
      loadAll: vi.fn(async () => []),
    };

    __setCallLogModuleLoaderForTests(() => bridge);

    await expect(
      collectAndroidCallActivityForDay("2026-04-06", "UTC"),
    ).rejects.toThrow(
      "Call activity permission denied. Enable call log access in system settings.",
    );
  });

  it("throws when bridge exposes neither loadAll nor getAll", async () => {
    const bridge = {
      checkPermission: vi.fn(async () => true),
    };

    __setCallLogModuleLoaderForTests(() => bridge);

    await expect(
      collectAndroidCallActivityForDay("2026-04-06", "UTC"),
    ).rejects.toThrow(
      "Call activity bridge does not expose loadAll/getAll. Check module setup.",
    );
  });

  it("rejects collection on non-android platforms", async () => {
    platform.OS = "ios";

    await expect(
      collectAndroidCallActivityForDay("2026-04-06", "UTC"),
    ).rejects.toThrow("Call activity sync is available only on Android.");
  });
});
