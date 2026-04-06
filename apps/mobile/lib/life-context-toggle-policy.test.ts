import { describe, expect, it } from "vitest";

import {
  decideLifeContextTogglePress,
  deriveLifeContextFeatureState,
  getPermissionDeniedReason,
  getPermissionPreconditionError,
} from "./life-context-toggle-policy";

describe("life context toggle policy", () => {
  it("requires setup when preferences are missing", () => {
    const result = decideLifeContextTogglePress({
      hasPreferences: false,
      isCurrentlyEnabled: false,
    });

    expect(result).toEqual({ action: "prompt_setup" });
  });

  it("opens disclosure when enabling a disabled feature", () => {
    const result = decideLifeContextTogglePress({
      hasPreferences: true,
      isCurrentlyEnabled: false,
    });

    expect(result).toEqual({ action: "open_disclosure" });
  });

  it("applies disable directly for an enabled feature", () => {
    const result = decideLifeContextTogglePress({
      hasPreferences: true,
      isCurrentlyEnabled: true,
    });

    expect(result).toEqual({ action: "apply_disable" });
  });

  it("reports error state precedence over enabled state", () => {
    expect(
      deriveLifeContextFeatureState({
        enabled: true,
        errorMessage: "Permission denied",
      }),
    ).toBe("error");

    expect(
      deriveLifeContextFeatureState({
        enabled: true,
      }),
    ).toBe("enabled");

    expect(
      deriveLifeContextFeatureState({
        enabled: false,
      }),
    ).toBe("disabled");
  });

  it("enforces background location preconditions", () => {
    expect(
      getPermissionPreconditionError({
        feature: "backgroundLocation",
        platform: "android",
        locationTrackingEnabled: false,
        backgroundTrackingRuntimeEnabled: true,
      }),
    ).toBe(
      "Enable location context first before turning on background tracking.",
    );

    expect(
      getPermissionPreconditionError({
        feature: "backgroundLocation",
        platform: "android",
        locationTrackingEnabled: true,
        backgroundTrackingRuntimeEnabled: false,
      }),
    ).toBe(
      "Background location tracking is currently disabled by server runtime policy.",
    );
  });

  it("blocks call-log permissions on non-android platforms", () => {
    expect(
      getPermissionPreconditionError({
        feature: "callLogs",
        platform: "ios",
        locationTrackingEnabled: true,
        backgroundTrackingRuntimeEnabled: true,
      }),
    ).toBe("Call log tracking is currently only available on Android.");

    expect(
      getPermissionPreconditionError({
        feature: "callLogs",
        platform: "android",
        locationTrackingEnabled: true,
        backgroundTrackingRuntimeEnabled: true,
      }),
    ).toBeNull();
  });

  it("maps permission-denied reasons for key features", () => {
    expect(getPermissionDeniedReason("location")).toContain(
      "Foreground location permission was denied",
    );
    expect(getPermissionDeniedReason("backgroundLocation")).toContain(
      "Background location permission was denied",
    );
    expect(getPermissionDeniedReason("callLogs")).toContain(
      "Call-log permissions were denied",
    );
  });
});
