import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@clerk/clerk-expo";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import { usePathname, useRouter } from "expo-router";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Radius, Spacing, Typography } from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";
import {
  APP_LOCK_SESSION_TIMEOUT_OPTIONS,
  DEFAULT_APP_LOCK_SETTINGS,
  getNextPasswordFailureState,
  getTimeoutOptionLabel,
  normalizeAppLockSettings,
  normalizeSessionTimeout,
  type AppLockSessionTimeoutOption,
  type AppLockSettings,
} from "@/lib/app-lock-utils";

type SecureStoreModule = {
  getItemAsync(
    key: string,
    options?: { keychainService?: string },
  ): Promise<string | null>;
  setItemAsync(
    key: string,
    value: string,
    options?: { keychainService?: string },
  ): Promise<void>;
  deleteItemAsync(
    key: string,
    options?: { keychainService?: string },
  ): Promise<void>;
};

type AppPasswordRecord = {
  version: 1;
  saltHex: string;
  hashHex: string;
  updatedAt: number;
};

type BiometricStatus = {
  available: boolean;
  enrolled: boolean;
  displayName: string;
  lockedOut: boolean;
};

type ReauthOptions = {
  reason: string;
  force?: boolean;
};

type AppLockContextValue = {
  isReady: boolean;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  biometricDisplayName: string;
  promptOnAppOpen: boolean;
  sessionTimeoutMs: number;
  sessionTimeoutOptions: readonly AppLockSessionTimeoutOption[];
  hasPassword: boolean;
  isSessionLocked: boolean;
  updateBiometricEnabled: (
    nextEnabled: boolean,
  ) => Promise<{ ok: boolean; message?: string }>;
  updatePromptOnAppOpen: (nextEnabled: boolean) => Promise<void>;
  updateSessionTimeoutMs: (nextTimeoutMs: number) => Promise<void>;
  setAppPassword: (
    password: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  requestSensitiveReauth: (options: ReauthOptions) => Promise<boolean>;
};

const APP_LOCK_SETTINGS_KEY = "daylog.app_lock.settings.v1";
const APP_LOCK_PASSWORD_KEY = "daylog.app_lock.password.v1";
const APP_LOCK_SECURE_STORE_SERVICE = "daylog.app.lock";
const APP_LOCK_FALLBACK_PREFIX = "daylog.app.lock.fallback.v1.";
const SENSITIVE_AUTH_WINDOW_MS = 2 * 60_000;
const PASSWORD_MAX_FAILURES = 5;
const PASSWORD_LOCKOUT_WINDOW_MS = 30_000;

const AppLockContext = createContext<AppLockContextValue | null>(null);

let secureStoreModulePromise: Promise<SecureStoreModule | null> | null = null;

function toFallbackStorageKey(key: string): string {
  return `${APP_LOCK_FALLBACK_PREFIX}${key}`;
}

async function getSecureStoreModule(): Promise<SecureStoreModule | null> {
  if (!secureStoreModulePromise) {
    secureStoreModulePromise = (async () => {
      try {
        const secureStore = await import("expo-secure-store");
        const candidate = secureStore as Partial<SecureStoreModule>;

        if (
          typeof candidate.getItemAsync !== "function" ||
          typeof candidate.setItemAsync !== "function" ||
          typeof candidate.deleteItemAsync !== "function"
        ) {
          return null;
        }

        return candidate as SecureStoreModule;
      } catch {
        return null;
      }
    })();
  }

  return await secureStoreModulePromise;
}

async function readSecureValue(key: string): Promise<string | null> {
  const secureStore = await getSecureStoreModule();

  if (!secureStore) {
    return await AsyncStorage.getItem(toFallbackStorageKey(key));
  }

  return await secureStore.getItemAsync(key, {
    keychainService: APP_LOCK_SECURE_STORE_SERVICE,
  });
}

async function writeSecureValue(key: string, value: string): Promise<void> {
  const secureStore = await getSecureStoreModule();

  if (!secureStore) {
    await AsyncStorage.setItem(toFallbackStorageKey(key), value);
    return;
  }

  await secureStore.setItemAsync(key, value, {
    keychainService: APP_LOCK_SECURE_STORE_SERVICE,
  });
}

function parsePasswordRecord(input: unknown): AppPasswordRecord | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const candidate = input as Partial<AppPasswordRecord>;

  if (
    candidate.version !== 1 ||
    typeof candidate.saltHex !== "string" ||
    candidate.saltHex.length < 16 ||
    typeof candidate.hashHex !== "string" ||
    candidate.hashHex.length < 16 ||
    typeof candidate.updatedAt !== "number"
  ) {
    return null;
  }

  return {
    version: 1,
    saltHex: candidate.saltHex,
    hashHex: candidate.hashHex,
    updatedAt: candidate.updatedAt,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function isBiometricLockoutError(value: string | undefined): boolean {
  return value === "lockout" || value === "lockout_permanent";
}

function toBiometricErrorMessage(
  error: string | undefined,
  biometricDisplayName: string,
): string {
  if (error === "user_cancel" || error === "app_cancel") {
    return `${biometricDisplayName} was cancelled.`;
  }

  if (isBiometricLockoutError(error)) {
    return `${biometricDisplayName} is temporarily locked. Use your PIN/password.`;
  }

  if (error === "not_enrolled") {
    return `${biometricDisplayName} is not enrolled on this device.`;
  }

  if (error === "not_available") {
    return `${biometricDisplayName} is not available on this device.`;
  }

  return `Could not verify with ${biometricDisplayName}.`;
}

function isProfileRoute(pathname: string | null): boolean {
  if (!pathname) {
    return false;
  }

  return pathname === "/profile" || pathname.endsWith("/profile");
}

async function buildBiometricStatus(): Promise<BiometricStatus> {
  try {
    const [hasHardware, isEnrolled, authTypes] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    const supportsFace = authTypes.includes(
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
    );
    const supportsFingerprint = authTypes.includes(
      LocalAuthentication.AuthenticationType.FINGERPRINT,
    );

    const displayName = supportsFace
      ? "Face ID"
      : supportsFingerprint
        ? "Fingerprint"
        : "Biometric";

    return {
      available: hasHardware,
      enrolled: isEnrolled,
      displayName,
      lockedOut: false,
    };
  } catch {
    return {
      available: false,
      enrolled: false,
      displayName: "Biometric",
      lockedOut: false,
    };
  }
}

async function generateSaltHex(): Promise<string> {
  try {
    return bytesToHex(Crypto.getRandomBytes(16));
  } catch {
    const fallback = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 256),
    );
    return bytesToHex(new Uint8Array(fallback));
  }
}

async function hashPasswordInput(
  password: string,
  saltHex: string,
): Promise<string> {
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${saltHex}:${password}`,
  );
}

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useAppTheme();
  const { isSignedIn, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [isReady, setIsReady] = useState(false);
  const [settings, setSettings] = useState<AppLockSettings>(
    DEFAULT_APP_LOCK_SETTINGS,
  );
  const [passwordRecord, setPasswordRecord] =
    useState<AppPasswordRecord | null>(null);
  const [biometricStatus, setBiometricStatus] = useState<BiometricStatus>({
    available: false,
    enrolled: false,
    displayName: "Biometric",
    lockedOut: false,
  });
  const [isSessionLocked, setIsSessionLocked] = useState(false);
  const [sessionLockReason, setSessionLockReason] =
    useState<string>("Unlock DayLog");
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(
    null,
  );
  const [stepUpReason, setStepUpReason] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const [passwordErrorMessage, setPasswordErrorMessage] = useState<
    string | null
  >(null);
  const [passwordFailureCount, setPasswordFailureCount] = useState(0);
  const [passwordLockedUntil, setPasswordLockedUntil] = useState<number | null>(
    null,
  );
  const [countdownTick, setCountdownTick] = useState(0);
  const [isUnlockBiometricInFlight, setIsUnlockBiometricInFlight] =
    useState(false);
  const [isStepUpBiometricInFlight, setIsStepUpBiometricInFlight] =
    useState(false);
  const [lastSensitiveAuthAt, setLastSensitiveAuthAt] = useState<number>(0);

  const hasPassword = passwordRecord !== null;
  const hasBiometricConfigured =
    settings.biometricEnabled &&
    biometricStatus.available &&
    biometricStatus.enrolled &&
    !biometricStatus.lockedOut;
  const hasAuthMethod = hasPassword || hasBiometricConfigured;

  const appStateRef = useRef(AppState.currentState);
  const backgroundedAtRef = useRef<number | null>(null);
  const launchLockHandledRef = useRef(false);
  const profileGuardInFlightRef = useRef(false);
  const stepUpResolverRef = useRef<((granted: boolean) => void) | null>(null);

  const resetPasswordPromptState = useCallback(() => {
    setPasswordInput("");
    setPasswordErrorMessage(null);
    setIsSubmittingPassword(false);
  }, []);

  const refreshBiometricStatus = useCallback(async () => {
    const nextStatus = await buildBiometricStatus();
    setBiometricStatus((previous) => ({
      ...nextStatus,
      lockedOut: previous.lockedOut ? previous.lockedOut : nextStatus.lockedOut,
    }));
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }

    void refreshBiometricStatus();
  }, [isSignedIn, refreshBiometricStatus]);

  useEffect(() => {
    if (!isSignedIn) {
      setIsReady(false);
      setSettings(DEFAULT_APP_LOCK_SETTINGS);
      setPasswordRecord(null);
      setIsSessionLocked(false);
      setSessionErrorMessage(null);
      setStepUpReason(null);
      setPasswordFailureCount(0);
      setPasswordLockedUntil(null);
      launchLockHandledRef.current = false;
      return;
    }

    let cancelled = false;
    setIsReady(false);

    void (async () => {
      const [storedSettingsRaw, storedPasswordRaw] = await Promise.all([
        readSecureValue(APP_LOCK_SETTINGS_KEY),
        readSecureValue(APP_LOCK_PASSWORD_KEY),
      ]);

      if (cancelled) {
        return;
      }

      let parsedSettings: AppLockSettings = DEFAULT_APP_LOCK_SETTINGS;
      let parsedPassword: AppPasswordRecord | null = null;

      if (storedSettingsRaw) {
        try {
          parsedSettings = normalizeAppLockSettings(
            JSON.parse(storedSettingsRaw),
          );
        } catch {
          parsedSettings = DEFAULT_APP_LOCK_SETTINGS;
        }
      }

      if (storedPasswordRaw) {
        try {
          parsedPassword = parsePasswordRecord(JSON.parse(storedPasswordRaw));
        } catch {
          parsedPassword = null;
        }
      }

      setSettings(parsedSettings);
      setPasswordRecord(parsedPassword);
      setPasswordFailureCount(0);
      setPasswordLockedUntil(null);
      setSessionErrorMessage(null);
      resetPasswordPromptState();
      launchLockHandledRef.current = false;
      setIsReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, resetPasswordPromptState]);

  const markAuthSucceeded = useCallback(() => {
    const now = Date.now();
    setLastSensitiveAuthAt(now);
    setPasswordFailureCount(0);
    setPasswordLockedUntil(null);
    setSessionErrorMessage(null);
    setPasswordErrorMessage(null);
    setIsSessionLocked(false);
    setStepUpReason(null);
  }, []);

  const runBiometricChallenge = useCallback(
    async (reason: string): Promise<{ ok: boolean; error?: string }> => {
      if (!settings.biometricEnabled) {
        return { ok: false, error: "disabled" };
      }

      if (!biometricStatus.available || !biometricStatus.enrolled) {
        return { ok: false, error: "not_available" };
      }

      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: reason,
          cancelLabel: hasPassword ? "Use PIN/password" : "Cancel",
          disableDeviceFallback: true,
        });

        if (result.success) {
          setBiometricStatus((previous) => ({
            ...previous,
            lockedOut: false,
          }));
          return { ok: true };
        }

        const error = result.error ?? "authentication_failed";

        if (isBiometricLockoutError(error)) {
          setBiometricStatus((previous) => ({
            ...previous,
            lockedOut: true,
          }));
        }

        return { ok: false, error };
      } catch {
        return { ok: false, error: "authentication_failed" };
      }
    },
    [
      biometricStatus.available,
      biometricStatus.enrolled,
      hasPassword,
      settings.biometricEnabled,
    ],
  );

  const resolveStepUp = useCallback((granted: boolean) => {
    const resolver = stepUpResolverRef.current;
    stepUpResolverRef.current = null;
    setStepUpReason(null);
    if (resolver) {
      resolver(granted);
    }
  }, []);

  const openStepUpPasswordPrompt = useCallback(
    async (reason: string): Promise<boolean> => {
      resetPasswordPromptState();
      setStepUpReason(reason);

      return await new Promise<boolean>((resolve) => {
        stepUpResolverRef.current = resolve;
      });
    },
    [resetPasswordPromptState],
  );

  const verifyPassword = useCallback(
    async (candidatePassword: string): Promise<boolean> => {
      if (!passwordRecord) {
        return false;
      }

      const hashed = await hashPasswordInput(
        candidatePassword,
        passwordRecord.saltHex,
      );
      return hashed === passwordRecord.hashHex;
    },
    [passwordRecord],
  );

  const currentLockoutRemainingMs =
    passwordLockedUntil && passwordLockedUntil > Date.now()
      ? passwordLockedUntil - Date.now()
      : 0;

  const lockSession = useCallback(
    async (reason: string) => {
      if (!isSignedIn || !hasAuthMethod) {
        return;
      }

      setSessionLockReason(reason);
      setSessionErrorMessage(null);
      resetPasswordPromptState();
      setIsSessionLocked(true);

      if (!hasBiometricConfigured) {
        return;
      }

      setIsUnlockBiometricInFlight(true);
      const result = await runBiometricChallenge(reason);
      setIsUnlockBiometricInFlight(false);

      if (result.ok) {
        markAuthSucceeded();
        return;
      }

      setSessionErrorMessage(
        toBiometricErrorMessage(result.error, biometricStatus.displayName),
      );
    },
    [
      biometricStatus.displayName,
      hasAuthMethod,
      hasBiometricConfigured,
      isSignedIn,
      markAuthSucceeded,
      resetPasswordPromptState,
      runBiometricChallenge,
    ],
  );

  useEffect(() => {
    if (!isReady || !isSignedIn || launchLockHandledRef.current) {
      return;
    }

    launchLockHandledRef.current = true;

    const shouldLockOnLaunch = hasPassword || settings.promptOnAppOpen;

    if (hasAuthMethod && shouldLockOnLaunch) {
      void lockSession("Unlock DayLog");
      return;
    }

    setIsSessionLocked(false);
  }, [
    hasAuthMethod,
    hasPassword,
    isReady,
    isSignedIn,
    lockSession,
    settings.promptOnAppOpen,
  ]);

  useEffect(() => {
    if (!passwordLockedUntil) {
      return;
    }

    const intervalId = setInterval(() => {
      setCountdownTick((tick) => tick + 1);
    }, 1_000);

    return () => {
      clearInterval(intervalId);
    };
  }, [passwordLockedUntil]);

  useEffect(() => {
    if (!passwordLockedUntil) {
      return;
    }

    if (Date.now() >= passwordLockedUntil) {
      setPasswordLockedUntil(null);
      setPasswordFailureCount(0);
      setPasswordErrorMessage(null);
    }
  }, [countdownTick, passwordLockedUntil]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (previousState === "active" && nextState !== "active") {
        backgroundedAtRef.current = Date.now();
        return;
      }

      if (nextState !== "active") {
        return;
      }

      const backgroundedAt = backgroundedAtRef.current;
      backgroundedAtRef.current = null;

      if (
        !isSignedIn ||
        !isReady ||
        !backgroundedAt ||
        !hasAuthMethod ||
        settings.sessionTimeoutMs <= 0
      ) {
        return;
      }

      if (Date.now() - backgroundedAt >= settings.sessionTimeoutMs) {
        void lockSession("Session timed out. Re-authenticate to continue.");
      }
    });

    return () => {
      subscription.remove();
    };
  }, [
    hasAuthMethod,
    isReady,
    isSignedIn,
    lockSession,
    settings.sessionTimeoutMs,
  ]);

  const requestSensitiveReauth = useCallback(
    async ({ reason, force = false }: ReauthOptions): Promise<boolean> => {
      if (!isSignedIn || !isReady || !hasAuthMethod) {
        return true;
      }

      if (
        !force &&
        Date.now() - lastSensitiveAuthAt < SENSITIVE_AUTH_WINDOW_MS
      ) {
        return true;
      }

      if (isSessionLocked) {
        await lockSession(reason);
        return false;
      }

      if (hasBiometricConfigured) {
        setIsStepUpBiometricInFlight(true);
        const biometricResult = await runBiometricChallenge(reason);
        setIsStepUpBiometricInFlight(false);

        if (biometricResult.ok) {
          markAuthSucceeded();
          return true;
        }

        if (!hasPassword) {
          return false;
        }
      }

      if (!hasPassword) {
        return false;
      }

      const granted = await openStepUpPasswordPrompt(reason);

      if (granted) {
        markAuthSucceeded();
      }

      return granted;
    },
    [
      hasAuthMethod,
      hasBiometricConfigured,
      hasPassword,
      isReady,
      isSessionLocked,
      isSignedIn,
      lastSensitiveAuthAt,
      lockSession,
      markAuthSucceeded,
      openStepUpPasswordPrompt,
      runBiometricChallenge,
    ],
  );

  useEffect(() => {
    if (
      !isSignedIn ||
      !isReady ||
      !isProfileRoute(pathname) ||
      !hasAuthMethod
    ) {
      return;
    }

    if (profileGuardInFlightRef.current) {
      return;
    }

    let cancelled = false;

    void (async () => {
      profileGuardInFlightRef.current = true;
      try {
        const granted = await requestSensitiveReauth({
          reason: "Authenticate to open Profile",
        });

        if (!granted && !cancelled) {
          router.replace("/(tabs)");
        }
      } finally {
        profileGuardInFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hasAuthMethod,
    isReady,
    isSignedIn,
    pathname,
    requestSensitiveReauth,
    router,
  ]);

  const persistSettings = useCallback(async (nextSettings: AppLockSettings) => {
    setSettings(nextSettings);
    await writeSecureValue(APP_LOCK_SETTINGS_KEY, JSON.stringify(nextSettings));
  }, []);

  const updateBiometricEnabled = useCallback(
    async (
      nextEnabled: boolean,
    ): Promise<{ ok: boolean; message?: string }> => {
      if (nextEnabled) {
        const latestStatus = await buildBiometricStatus();
        setBiometricStatus((previous) => ({
          ...latestStatus,
          lockedOut: previous.lockedOut,
        }));

        if (!latestStatus.available) {
          return {
            ok: false,
            message:
              "Biometric authentication is not available on this device.",
          };
        }

        if (!latestStatus.enrolled) {
          return {
            ok: false,
            message:
              "No biometric method is enrolled. Add Face ID/Fingerprint in system settings first.",
          };
        }
      }

      await persistSettings({
        ...settings,
        biometricEnabled: nextEnabled,
      });

      return { ok: true };
    },
    [persistSettings, settings],
  );

  const updatePromptOnAppOpen = useCallback(
    async (nextEnabled: boolean) => {
      await persistSettings({
        ...settings,
        promptOnAppOpen: nextEnabled,
      });
    },
    [persistSettings, settings],
  );

  const updateSessionTimeoutMs = useCallback(
    async (nextTimeoutMs: number) => {
      await persistSettings({
        ...settings,
        sessionTimeoutMs: normalizeSessionTimeout(nextTimeoutMs),
      });
    },
    [persistSettings, settings],
  );

  const setAppPassword = useCallback(
    async (password: string): Promise<{ ok: boolean; message?: string }> => {
      const normalized = password.trim();
      if (normalized.length < 4) {
        return {
          ok: false,
          message: "Use at least 4 characters for your PIN/password.",
        };
      }

      const saltHex = await generateSaltHex();
      const hashHex = await hashPasswordInput(password, saltHex);

      const record: AppPasswordRecord = {
        version: 1,
        saltHex,
        hashHex,
        updatedAt: Date.now(),
      };

      await writeSecureValue(APP_LOCK_PASSWORD_KEY, JSON.stringify(record));
      setPasswordRecord(record);
      setPasswordFailureCount(0);
      setPasswordLockedUntil(null);

      return { ok: true };
    },
    [],
  );

  const handlePasswordSubmit = useCallback(
    async (mode: "unlock" | "stepup") => {
      if (!hasPassword || isSubmittingPassword) {
        return;
      }

      if (currentLockoutRemainingMs > 0) {
        setPasswordErrorMessage(
          `Too many attempts. Try again in ${Math.ceil(currentLockoutRemainingMs / 1000)}s.`,
        );
        return;
      }

      setIsSubmittingPassword(true);

      try {
        const verified = await verifyPassword(passwordInput);

        if (verified) {
          resetPasswordPromptState();
          markAuthSucceeded();
          if (mode === "stepup") {
            resolveStepUp(true);
          }
          return;
        }

        const failureState = getNextPasswordFailureState({
          currentFailureCount: passwordFailureCount,
          maxFailures: PASSWORD_MAX_FAILURES,
          lockoutWindowMs: PASSWORD_LOCKOUT_WINDOW_MS,
          nowMs: Date.now(),
        });

        setPasswordFailureCount(failureState.nextFailureCount);
        setPasswordLockedUntil(failureState.lockedUntil);
        setPasswordErrorMessage(failureState.errorMessage);

        if (failureState.lockedUntil !== null) {
          setPasswordInput("");
        }
      } finally {
        setIsSubmittingPassword(false);
      }
    },
    [
      currentLockoutRemainingMs,
      hasPassword,
      isSubmittingPassword,
      markAuthSucceeded,
      passwordFailureCount,
      passwordInput,
      resetPasswordPromptState,
      resolveStepUp,
      verifyPassword,
    ],
  );

  const handleRetryBiometricUnlock = useCallback(() => {
    setSessionErrorMessage(null);
    void lockSession(sessionLockReason);
  }, [lockSession, sessionLockReason]);

  const contextValue = useMemo<AppLockContextValue>(
    () => ({
      isReady,
      biometricEnabled: settings.biometricEnabled,
      biometricAvailable: biometricStatus.available && biometricStatus.enrolled,
      biometricDisplayName: biometricStatus.displayName,
      promptOnAppOpen: settings.promptOnAppOpen,
      sessionTimeoutMs: settings.sessionTimeoutMs,
      sessionTimeoutOptions: APP_LOCK_SESSION_TIMEOUT_OPTIONS,
      hasPassword,
      isSessionLocked,
      updateBiometricEnabled,
      updatePromptOnAppOpen,
      updateSessionTimeoutMs,
      setAppPassword,
      requestSensitiveReauth,
    }),
    [
      biometricStatus.available,
      biometricStatus.displayName,
      biometricStatus.enrolled,
      hasPassword,
      isReady,
      isSessionLocked,
      requestSensitiveReauth,
      setAppPassword,
      settings.biometricEnabled,
      settings.promptOnAppOpen,
      settings.sessionTimeoutMs,
      updateBiometricEnabled,
      updatePromptOnAppOpen,
      updateSessionTimeoutMs,
    ],
  );

  const timeoutLabel = getTimeoutOptionLabel(settings.sessionTimeoutMs);

  return (
    <AppLockContext.Provider value={contextValue}>
      {children}

      {isSessionLocked ? (
        <View style={[styles.lockOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.lockCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.lockTitle, { color: colors.text }]}>
              DayLog Locked
            </Text>
            <Text
              style={[styles.lockSubtitle, { color: colors.textSecondary }]}
            >
              {sessionLockReason}
            </Text>

            {isUnlockBiometricInFlight ? (
              <View style={styles.loaderRow}>
                <ActivityIndicator color={colors.tint} />
                <Text
                  style={[styles.loaderLabel, { color: colors.textSecondary }]}
                >
                  Checking {biometricStatus.displayName}...
                </Text>
              </View>
            ) : null}

            {sessionErrorMessage ? (
              <Text style={[styles.errorText, { color: colors.error }]}>
                {sessionErrorMessage}
              </Text>
            ) : null}

            {hasPassword ? (
              <>
                <TextInput
                  value={passwordInput}
                  onChangeText={setPasswordInput}
                  placeholder="Enter PIN or password"
                  placeholderTextColor={colors.textTertiary}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={
                    !isSubmittingPassword && currentLockoutRemainingMs <= 0
                  }
                  style={[
                    styles.passwordInput,
                    {
                      borderColor: colors.divider,
                      color: colors.text,
                      backgroundColor: colors.background,
                    },
                  ]}
                />

                <Pressable
                  style={[
                    styles.primaryButton,
                    {
                      backgroundColor:
                        isSubmittingPassword || currentLockoutRemainingMs > 0
                          ? colors.tintLight
                          : colors.tint,
                    },
                  ]}
                  onPress={() => {
                    void handlePasswordSubmit("unlock");
                  }}
                  disabled={
                    isSubmittingPassword || currentLockoutRemainingMs > 0
                  }
                >
                  <Text
                    style={[
                      styles.primaryButtonLabel,
                      {
                        color: colors.inverseText,
                        opacity:
                          isSubmittingPassword || currentLockoutRemainingMs > 0
                            ? 0.65
                            : 1,
                      },
                    ]}
                  >
                    Unlock with PIN/password
                  </Text>
                </Pressable>
              </>
            ) : null}

            {hasBiometricConfigured ? (
              <Pressable
                style={[
                  styles.secondaryButton,
                  { borderColor: colors.divider },
                ]}
                onPress={handleRetryBiometricUnlock}
              >
                <Text
                  style={[styles.secondaryButtonLabel, { color: colors.text }]}
                >
                  Try {biometricStatus.displayName} Again
                </Text>
              </Pressable>
            ) : null}

            {!hasPassword && !hasBiometricConfigured ? (
              <Pressable
                style={[
                  styles.secondaryButton,
                  { borderColor: colors.divider },
                ]}
                onPress={() => {
                  void signOut();
                }}
              >
                <Text
                  style={[styles.secondaryButtonLabel, { color: colors.text }]}
                >
                  Sign Out
                </Text>
              </Pressable>
            ) : null}

            <Text style={[styles.lockHint, { color: colors.textTertiary }]}>
              Session timeout: {timeoutLabel}
            </Text>
          </View>
        </View>
      ) : null}

      <Modal visible={stepUpReason !== null} transparent animationType="fade">
        <View
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
        >
          <View
            style={[styles.stepUpCard, { backgroundColor: colors.surface }]}
          >
            <Text style={[styles.lockTitle, { color: colors.text }]}>
              Re-authenticate
            </Text>
            <Text
              style={[styles.lockSubtitle, { color: colors.textSecondary }]}
            >
              {stepUpReason ?? "Authenticate to continue"}
            </Text>

            {isStepUpBiometricInFlight ? (
              <View style={styles.loaderRow}>
                <ActivityIndicator color={colors.tint} />
                <Text
                  style={[styles.loaderLabel, { color: colors.textSecondary }]}
                >
                  Checking {biometricStatus.displayName}...
                </Text>
              </View>
            ) : null}

            {hasPassword ? (
              <TextInput
                value={passwordInput}
                onChangeText={setPasswordInput}
                placeholder="Enter PIN or password"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={
                  !isSubmittingPassword && currentLockoutRemainingMs <= 0
                }
                style={[
                  styles.passwordInput,
                  {
                    borderColor: colors.divider,
                    color: colors.text,
                    backgroundColor: colors.background,
                  },
                ]}
              />
            ) : null}

            {passwordErrorMessage ? (
              <Text style={[styles.errorText, { color: colors.error }]}>
                {passwordErrorMessage}
              </Text>
            ) : null}

            <View style={styles.stepUpActionsRow}>
              <Pressable
                style={[
                  styles.secondaryButtonCompact,
                  { borderColor: colors.divider },
                ]}
                onPress={() => {
                  resetPasswordPromptState();
                  resolveStepUp(false);
                }}
              >
                <Text
                  style={[styles.secondaryButtonLabel, { color: colors.text }]}
                >
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.primaryButtonCompact,
                  {
                    backgroundColor:
                      isSubmittingPassword || currentLockoutRemainingMs > 0
                        ? colors.tintLight
                        : colors.tint,
                  },
                ]}
                onPress={() => {
                  void handlePasswordSubmit("stepup");
                }}
                disabled={isSubmittingPassword || currentLockoutRemainingMs > 0}
              >
                <Text
                  style={[
                    styles.primaryButtonLabel,
                    { color: colors.inverseText },
                  ]}
                >
                  Continue
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </AppLockContext.Provider>
  );
}

export function useAppLock(): AppLockContextValue {
  const context = useContext(AppLockContext);

  if (!context) {
    throw new Error("useAppLock must be used within AppLockProvider");
  }

  return context;
}

const styles = StyleSheet.create({
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    zIndex: 999,
  },
  lockCard: {
    width: "100%",
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  modalOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  stepUpCard: {
    width: "100%",
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  lockTitle: {
    ...Typography.title3,
  },
  lockSubtitle: {
    ...Typography.callout,
    lineHeight: 20,
  },
  lockHint: {
    ...Typography.caption2,
    textAlign: "center",
    marginTop: Spacing.xs,
  },
  passwordInput: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.body,
  },
  primaryButton: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: "center",
  },
  primaryButtonCompact: {
    flex: 1,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  primaryButtonLabel: {
    ...Typography.callout,
    fontWeight: "700",
  },
  secondaryButton: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingVertical: Spacing.md,
    alignItems: "center",
  },
  secondaryButtonCompact: {
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  secondaryButtonLabel: {
    ...Typography.callout,
    fontWeight: "600",
  },
  stepUpActionsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  loaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  loaderLabel: {
    ...Typography.caption1,
  },
  errorText: {
    ...Typography.caption1,
  },
});
