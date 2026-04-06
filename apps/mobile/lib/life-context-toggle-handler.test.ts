import { describe, expect, it, vi } from "vitest";

import {
  evaluateLifeContextFeaturePermission,
  handleLifeContextTogglePressFlow,
} from "./life-context-toggle-handler";

describe("life context toggle handler integration", () => {
  it("prompts setup when preferences are missing", () => {
    const promptSetup = vi.fn();
    const openDisclosure = vi.fn();
    const applyDisable = vi.fn();

    handleLifeContextTogglePressFlow("location", {
      hasPreferences: false,
      isCurrentlyEnabled: false,
      promptSetup,
      openDisclosure,
      applyDisable,
    });

    expect(promptSetup).toHaveBeenCalledTimes(1);
    expect(openDisclosure).not.toHaveBeenCalled();
    expect(applyDisable).not.toHaveBeenCalled();
  });

  it("opens disclosure when enabling a feature", () => {
    const promptSetup = vi.fn();
    const openDisclosure = vi.fn();
    const applyDisable = vi.fn();

    handleLifeContextTogglePressFlow("moodDetection", {
      hasPreferences: true,
      isCurrentlyEnabled: false,
      promptSetup,
      openDisclosure,
      applyDisable,
    });

    expect(openDisclosure).toHaveBeenCalledWith("moodDetection");
    expect(promptSetup).not.toHaveBeenCalled();
    expect(applyDisable).not.toHaveBeenCalled();
  });

  it("applies disable flow when feature is already enabled", () => {
    const promptSetup = vi.fn();
    const openDisclosure = vi.fn();
    const applyDisable = vi.fn();

    handleLifeContextTogglePressFlow("fitness", {
      hasPreferences: true,
      isCurrentlyEnabled: true,
      promptSetup,
      openDisclosure,
      applyDisable,
    });

    expect(applyDisable).toHaveBeenCalledWith("fitness");
    expect(promptSetup).not.toHaveBeenCalled();
    expect(openDisclosure).not.toHaveBeenCalled();
  });

  it("returns denied reason for location permission failure", async () => {
    const result = await evaluateLifeContextFeaturePermission({
      feature: "location",
      platform: "ios",
      locationTrackingEnabled: false,
      backgroundTrackingRuntimeEnabled: false,
      ensureForegroundLocationPermission: async () => false,
      ensureBackgroundLocationPermission: async () => true,
      ensureCallLogsPermission: async () => true,
      ensureMoodDetectionPermission: async () => true,
      ensureCalendarNotificationPermission: async () => true,
      ensureFitnessPermission: async () => ({ ok: true }),
    });

    expect(result).toEqual({
      ok: false,
      reason:
        "Foreground location permission was denied. Enable location in system settings and try again.",
    });
  });

  it("enforces background location runtime preconditions", async () => {
    const result = await evaluateLifeContextFeaturePermission({
      feature: "backgroundLocation",
      platform: "android",
      locationTrackingEnabled: true,
      backgroundTrackingRuntimeEnabled: false,
      ensureForegroundLocationPermission: async () => true,
      ensureBackgroundLocationPermission: async () => true,
      ensureCallLogsPermission: async () => true,
      ensureMoodDetectionPermission: async () => true,
      ensureCalendarNotificationPermission: async () => true,
      ensureFitnessPermission: async () => ({ ok: true }),
    });

    expect(result).toEqual({
      ok: false,
      reason:
        "Background location tracking is currently disabled by server runtime policy.",
    });
  });

  it("returns denied reason for background location permission failure", async () => {
    const result = await evaluateLifeContextFeaturePermission({
      feature: "backgroundLocation",
      platform: "android",
      locationTrackingEnabled: true,
      backgroundTrackingRuntimeEnabled: true,
      ensureForegroundLocationPermission: async () => true,
      ensureBackgroundLocationPermission: async () => false,
      ensureCallLogsPermission: async () => true,
      ensureMoodDetectionPermission: async () => true,
      ensureCalendarNotificationPermission: async () => true,
      ensureFitnessPermission: async () => ({ ok: true }),
    });

    expect(result).toEqual({
      ok: false,
      reason:
        "Background location permission was denied. DayLog cannot run controlled background tracking without it.",
    });
  });

  it("blocks call logs on non-android platforms via precondition", async () => {
    const result = await evaluateLifeContextFeaturePermission({
      feature: "callLogs",
      platform: "ios",
      locationTrackingEnabled: true,
      backgroundTrackingRuntimeEnabled: true,
      ensureForegroundLocationPermission: async () => true,
      ensureBackgroundLocationPermission: async () => true,
      ensureCallLogsPermission: async () => true,
      ensureMoodDetectionPermission: async () => true,
      ensureCalendarNotificationPermission: async () => true,
      ensureFitnessPermission: async () => ({ ok: true }),
    });

    expect(result).toEqual({
      ok: false,
      reason: "Call log tracking is currently only available on Android.",
    });
  });

  it("preserves platform-specific fitness failure reason", async () => {
    const result = await evaluateLifeContextFeaturePermission({
      feature: "fitness",
      platform: "ios",
      locationTrackingEnabled: true,
      backgroundTrackingRuntimeEnabled: true,
      ensureForegroundLocationPermission: async () => true,
      ensureBackgroundLocationPermission: async () => true,
      ensureCallLogsPermission: async () => true,
      ensureMoodDetectionPermission: async () => true,
      ensureCalendarNotificationPermission: async () => true,
      ensureFitnessPermission: async () => ({
        ok: false,
        reason: "HealthKit setup missing",
      }),
    });

    expect(result).toEqual({
      ok: false,
      reason: "HealthKit setup missing",
    });
  });
});
