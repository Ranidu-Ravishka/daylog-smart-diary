import { describe, expect, it } from "vitest";
import {
  APP_LOCK_SESSION_TIMEOUT_OPTIONS,
  DEFAULT_APP_LOCK_SETTINGS,
  getNextPasswordFailureState,
  getTimeoutOptionLabel,
  normalizeAppLockSettings,
  normalizeSessionTimeout,
} from "./app-lock-utils";

describe("app lock utils", () => {
  it("normalizes invalid app lock settings to defaults", () => {
    expect(normalizeAppLockSettings(null)).toEqual(DEFAULT_APP_LOCK_SETTINGS);
    expect(normalizeAppLockSettings({})).toEqual(DEFAULT_APP_LOCK_SETTINGS);
    expect(
      normalizeAppLockSettings({
        biometricEnabled: "yes",
        promptOnAppOpen: 1,
        sessionTimeoutMs: -1,
      }),
    ).toEqual({
      biometricEnabled: true,
      promptOnAppOpen: true,
      sessionTimeoutMs: DEFAULT_APP_LOCK_SETTINGS.sessionTimeoutMs,
    });
  });

  it("keeps supported timeout values unchanged", () => {
    for (const option of APP_LOCK_SESSION_TIMEOUT_OPTIONS) {
      expect(normalizeSessionTimeout(option.valueMs)).toBe(option.valueMs);
    }
  });

  it("returns timeout labels for valid options", () => {
    expect(getTimeoutOptionLabel(0)).toBe("Never");
    expect(getTimeoutOptionLabel(5 * 60_000)).toBe("5 minutes");
    expect(getTimeoutOptionLabel(123)).toBe("5 minutes");
  });

  it("increments failures and then locks out at max attempts", () => {
    const nowMs = 1_000;

    const firstFailure = getNextPasswordFailureState({
      currentFailureCount: 0,
      maxFailures: 5,
      lockoutWindowMs: 30_000,
      nowMs,
    });

    expect(firstFailure.nextFailureCount).toBe(1);
    expect(firstFailure.lockedUntil).toBeNull();

    const lockoutFailure = getNextPasswordFailureState({
      currentFailureCount: 4,
      maxFailures: 5,
      lockoutWindowMs: 30_000,
      nowMs,
    });

    expect(lockoutFailure.nextFailureCount).toBe(0);
    expect(lockoutFailure.lockedUntil).toBe(nowMs + 30_000);
    expect(lockoutFailure.errorMessage).toContain("Too many failed attempts");
  });
});
