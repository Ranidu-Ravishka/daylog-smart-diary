export type AppLockSessionTimeoutOption = {
  label: string;
  valueMs: number;
};

export const APP_LOCK_SESSION_TIMEOUT_OPTIONS: readonly AppLockSessionTimeoutOption[] =
  [
    { label: "Never", valueMs: 0 },
    { label: "1 minute", valueMs: 60_000 },
    { label: "5 minutes", valueMs: 5 * 60_000 },
    { label: "15 minutes", valueMs: 15 * 60_000 },
    { label: "30 minutes", valueMs: 30 * 60_000 },
  ];

export type AppLockSettings = {
  biometricEnabled: boolean;
  promptOnAppOpen: boolean;
  sessionTimeoutMs: number;
};

export const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60_000;

export const DEFAULT_APP_LOCK_SETTINGS: AppLockSettings = {
  biometricEnabled: false,
  promptOnAppOpen: false,
  sessionTimeoutMs: DEFAULT_SESSION_TIMEOUT_MS,
};

export function normalizeSessionTimeout(timeoutMs: unknown): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    return DEFAULT_SESSION_TIMEOUT_MS;
  }

  const matchedOption = APP_LOCK_SESSION_TIMEOUT_OPTIONS.find(
    (option) => option.valueMs === timeoutMs,
  );

  return matchedOption ? matchedOption.valueMs : DEFAULT_SESSION_TIMEOUT_MS;
}

export function normalizeAppLockSettings(input: unknown): AppLockSettings {
  if (typeof input !== "object" || input === null) {
    return DEFAULT_APP_LOCK_SETTINGS;
  }

  const candidate = input as Partial<AppLockSettings>;

  return {
    biometricEnabled: Boolean(candidate.biometricEnabled),
    promptOnAppOpen: Boolean(candidate.promptOnAppOpen),
    sessionTimeoutMs: normalizeSessionTimeout(candidate.sessionTimeoutMs),
  };
}

export function getTimeoutOptionLabel(timeoutMs: number): string {
  const matched = APP_LOCK_SESSION_TIMEOUT_OPTIONS.find(
    (option) => option.valueMs === timeoutMs,
  );
  return matched?.label ?? "5 minutes";
}

export type PasswordFailureStateInput = {
  currentFailureCount: number;
  maxFailures: number;
  lockoutWindowMs: number;
  nowMs: number;
};

export type PasswordFailureState = {
  nextFailureCount: number;
  lockedUntil: number | null;
  errorMessage: string;
};

export function getNextPasswordFailureState({
  currentFailureCount,
  maxFailures,
  lockoutWindowMs,
  nowMs,
}: PasswordFailureStateInput): PasswordFailureState {
  const tentativeFailures = currentFailureCount + 1;

  if (tentativeFailures >= maxFailures) {
    return {
      nextFailureCount: 0,
      lockedUntil: nowMs + lockoutWindowMs,
      errorMessage: `Too many failed attempts. Try again in ${Math.ceil(lockoutWindowMs / 1000)}s.`,
    };
  }

  return {
    nextFailureCount: tentativeFailures,
    lockedUntil: null,
    errorMessage: "Incorrect PIN/password. Please try again.",
  };
}
