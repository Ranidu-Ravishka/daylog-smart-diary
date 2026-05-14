import React, { useState, useEffect, useCallback } from "react";
import { Alert, Platform, Linking, AppState } from "react-native";
import * as ExpoLinking from "expo-linking";
import * as Location from "expo-location";
import * as WebBrowser from "expo-web-browser";
import type { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import { useUser, useAuth } from "@clerk/clerk-expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import type { GenericId } from "convex/values";
import { api } from "@repo/backend/convex";
import {
  deriveDeletionState,
  formatDeletionStageLabel,
  getDeletionProgressPercent,
  getDeletionStateLabel,
  shouldLockDeletionNavigation,
} from "@repo/ui/lib/account-deletion";
import {
  normalizeLifeContextUserSettingsPatch,
  normalizeUserSettingsPatch,
  type LifeContextUserSettingsPatchDto,
  type UserSettingsDto,
  type UserSettingsPatchDto,
} from "@repo/user-settings/lib/user-settings";
import {
  INTEGRATION_COMING_SOON_HELPER_TEXT,
  INTEGRATION_PROVIDER_META,
  INTEGRATION_PROVIDER_STATUS,
  SETTINGS_DEFAULTS,
} from "@repo/ui/lib/constants";
import { getResolvedTimeZone } from "@repo/ui/lib/day-window";
import {
  ensureReminderPermissions,
  getReminderRuntimeState,
  syncReminderNotifications,
  type ReminderRuntimeState,
} from "@/lib/reminder-notifications";
import {
  getAndroidCallActivityRuntimeDiagnostics,
  type AndroidCallActivityRuntimeDiagnostics,
  isAndroidCallActivityCollectionSupported,
  requestAndroidCallActivityPermission,
} from "@/lib/android-call-activity-sync";
import {
  collectAppleHealthDailyDataForDay,
  getAppleHealthSetupIssue,
} from "@/lib/apple-health-sync";
import {
  computeAppleCalendarDeltaForDay,
  getAppleCalendarSetupIssue,
  recordAppleCalendarSyncCommitted,
} from "@/lib/apple-calendar-sync";
import { getBackgroundLocationEnablementStatus } from "@/lib/background-location-tracker";
import { evaluateLifeContextFeaturePermission } from "@/lib/life-context-toggle-handler";
import {
  LIFE_CONTEXT_DISCLOSURE,
  type LifeContextFeatureKey,
} from "@/lib/life-context-toggle-policy";
import { collectAndroidScreenTimeDailyDataForDay } from "@/lib/android-screen-time-sync";
import { collectIosScreenTimeDailyDataForDay } from "@/lib/ios-screen-time-sync";
import { getOfflineOutboxSnapshot } from "@/lib/offline-outbox";
import { captureException, logInfo, logWarn } from "@/lib/observability";
import { useAppTheme } from "@/components/theme-provider";
import { createProfileStyles } from "@/components/profile/profile-styles";
import { useAppLock } from "@/components/security/app-lock-provider";
import {
  type AboutLink,
  type IntegrationDoc,
  type OutboxLastSyncResult,
  type PreferencesSnapshot,
  type ProfileSectionKey,
} from "@/components/profile/types";
import {
  PROFILE_SECTIONS,
  format24hTo12h,
  formatDateTo24h,
  isOAuthProvider,
  parseTimeToDate,
  snapToQuarterHour,
} from "@/lib/profile-screen-helpers";
import { useProfileConvexResources } from "@/hooks/useProfileConvexResources";

type OfflineOutboxSnapshot = Awaited<
  ReturnType<typeof getOfflineOutboxSnapshot>
>;

type ReminderPreferencePatch = {
  reminderType?: "daily" | "weekly";
} & Pick<
  UserSettingsPatchDto,
  | "theme"
  | "notificationsEnabled"
  | "dailySummaryEnabled"
  | "weeklyInsightsEnabled"
  | "quietHoursEnabled"
  | "quietHoursStart"
  | "quietHoursEnd"
  | "autoSyncIntegrations"
  | "defaultMemoryMood"
>;

type LifeContextPreferencePatch = Pick<
  LifeContextUserSettingsPatchDto,
  | "callLogsTrackingEnabled"
  | "moodDetectionFaceRecognitionEnabled"
  | "fitnessTrackingEnabled"
  | "calendarNotificationsTrackingEnabled"
  | "backgroundLocationTrackingEnabled"
>;

/* ── Hook body appended from former screen (logic only) ───────────────── */
export function useProfileScreen() {
  const { colors: c, effectiveTheme, setThemePreference } = useAppTheme();
  const {
    isReady: isAppLockReady,
    biometricEnabled,
    biometricAvailable,
    biometricDisplayName,
    promptOnAppOpen,
    sessionTimeoutMs,
    sessionTimeoutOptions,
    hasPassword: hasAppPassword,
    updateBiometricEnabled,
    updatePromptOnAppOpen,
    updateSessionTimeoutMs,
    setAppPassword,
    requestSensitiveReauth,
  } = useAppLock();
  const styles = React.useMemo(() => createProfileStyles(c), [c]);
  const router = useRouter();
  const [postIntegrationRedirect, setPostIntegrationRedirect] = useState(false);
  const searchParams = useLocalSearchParams<{
    integrationProvider?: string;
    integrationStatus?: string;
    integrationMessage?: string;
  }>();
  const { user } = useUser();
  const { signOut } = useAuth();

  const {
    isAuthLoading,
    isAuthenticated,
    todayDayKey,
    canUseIntegrationApis,
    setDeletionPollToken,
    trackedDeletionJobId,
    setTrackedDeletionJobId,
    supportedProviders,
    integrations,
    integrationHealthSnapshots,
    syncRuns,
    preferences,
    locationTrackingRuntimeConfig,
    convexClient,
    connectIntegration,
    beginOAuthMobileHandoff,
    disconnectIntegration,
    syncUserPreferences,
    syncMyIntegrationForDay,
    syncAppleHealthDailyData,
    upsertMyIntegrationDailyData,
    updateMyLocationTrackingState,
    requestAccountDeletion,
    accountDeletionStatus,
    currentProfile,
    generateProfileImageUploadUrl,
    setProfileImageFromUpload,
    setProfileImageFromProvider,
    clearManualProfileImage,
  } = useProfileConvexResources();

  const [darkMode, setDarkMode] = useState(false);
  const [allNotifications, setAllNotifications] = useState(true);
  const [weeklyInsights, setWeeklyInsights] = useState(false);
  const [dailySummary, setDailySummary] = useState(false);
  const [quietHours, setQuietHours] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState<string>(
    SETTINGS_DEFAULTS.quietHoursStart,
  );
  const [quietHoursEnd, setQuietHoursEnd] = useState<string>(
    SETTINGS_DEFAULTS.quietHoursEnd,
  );
  const [showQuietHoursPicker, setShowQuietHoursPicker] = useState(false);
  const [quietHoursPickerTarget, setQuietHoursPickerTarget] = useState<
    "start" | "end" | null
  >(null);
  const [quietHoursPickerValue, setQuietHoursPickerValue] = useState<Date>(
    parseTimeToDate(SETTINGS_DEFAULTS.quietHoursStart),
  );
  const [autoSyncIntegrations, setAutoSyncIntegrations] = useState(true);
  const [defaultMemoryMood, setDefaultMemoryMood] = useState<
    UserSettingsDto["defaultMemoryMood"]
  >(SETTINGS_DEFAULTS.defaultMemoryMood);
  const [locationTrackingEnabled, setLocationTrackingEnabled] =
    useState<boolean>(SETTINGS_DEFAULTS.locationTrackingEnabled);
  const [callLogsTrackingEnabled, setCallLogsTrackingEnabled] =
    useState<boolean>(SETTINGS_DEFAULTS.callLogsTrackingEnabled);
  const [moodAssistanceEnabled, setMoodAssistanceEnabled] = useState<boolean>(
    SETTINGS_DEFAULTS.moodDetectionFaceRecognitionEnabled,
  );
  const [fitnessTrackingEnabled, setFitnessTrackingEnabled] = useState<boolean>(
    SETTINGS_DEFAULTS.fitnessTrackingEnabled,
  );
  const [calendarContextEnabled, setCalendarContextEnabled] = useState<boolean>(
    SETTINGS_DEFAULTS.calendarNotificationsTrackingEnabled,
  );
  const [
    backgroundLocationTrackingEnabled,
    setBackgroundLocationTrackingEnabled,
  ] = useState<boolean>(SETTINGS_DEFAULTS.backgroundLocationTrackingEnabled);
  const [isUpdatingReminderPreference, setIsUpdatingReminderPreference] =
    useState(false);
  const [providerPendingAction, setProviderPendingAction] = useState<
    Record<string, "connect" | "disconnect" | "sync" | undefined>
  >({});
  const [integrationFeedback, setIntegrationFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [reminderRuntime, setReminderRuntime] = useState<
    ReminderRuntimeState | undefined
  >();
  const [backgroundLocationRuntimeStatus, setBackgroundLocationRuntimeStatus] =
    useState<{
      fullyEnabled: boolean;
      reason?: string;
    } | null>(null);
  const [callActivityDiagnostics, setCallActivityDiagnostics] =
    useState<AndroidCallActivityRuntimeDiagnostics | null>(null);
  const [offlineOutboxSnapshot, setOfflineOutboxSnapshot] =
    useState<OfflineOutboxSnapshot>({
      pending: 0,
      dueNow: 0,
    });
  const [isRequestingAccountDeletion, setIsRequestingAccountDeletion] =
    useState(false);
  const [isFinalizingAccountDeletion, setIsFinalizingAccountDeletion] =
    useState(false);
  const [
    hasTriggeredAccountDeletionFinalize,
    setHasTriggeredAccountDeletionFinalize,
  ] = useState(false);
  const [activeSection, setActiveSection] =
    useState<ProfileSectionKey>("overview");
  const [showAdvancedStatus, setShowAdvancedStatus] = useState(false);
  const [showAppPasswordModal, setShowAppPasswordModal] = useState(false);
  const [appPasswordValue, setAppPasswordValue] = useState("");
  const [appPasswordConfirmValue, setAppPasswordConfirmValue] = useState("");
  const [isSavingAppPassword, setIsSavingAppPassword] = useState(false);
  const [appPasswordError, setAppPasswordError] = useState<string | null>(null);
  const [isUpdatingProfileImage, setIsUpdatingProfileImage] = useState(false);
  const deletionState = deriveDeletionState(accountDeletionStatus);
  const deletionStateLabel = deletionState
    ? getDeletionStateLabel(deletionState)
    : null;
  const deletionStageLabel = formatDeletionStageLabel(
    accountDeletionStatus?.job?.stage,
  );
  const deletionProgressPercent = getDeletionProgressPercent(
    deletionState,
    accountDeletionStatus?.job?.stage,
  );
  const lockUnsafeDeletionNavigation = shouldLockDeletionNavigation({
    deletionState,
    isFinalizingDeletion: isFinalizingAccountDeletion,
  });
  const isAccountDeletionInProgress = Boolean(
    accountDeletionStatus?.inProgress,
  );
  const canRetryAccountDeletion = Boolean(accountDeletionStatus?.retryable);
  const accountDeletionStatusMessage = isFinalizingAccountDeletion
    ? "Finalizing account deletion now."
    : accountDeletionStatus?.canDeleteClerkAccount
      ? "Backend cleanup complete. Finalizing account deletion now."
      : accountDeletionStatus?.inProgress || deletionState === "requested"
        ? `Backend cleanup in progress (${deletionStageLabel}).`
        : accountDeletionStatus?.retryable
          ? `Cleanup failed: ${accountDeletionStatus.job?.lastError ?? "Unknown error"}`
          : null;
  const callActivityCollectionSupported = React.useMemo(
    () =>
      Platform.OS === "android" && isAndroidCallActivityCollectionSupported(),
    [],
  );

  const refreshCallActivityDiagnostics = useCallback(async () => {
    return await getAndroidCallActivityRuntimeDiagnostics();
  }, []);

  const refreshOfflineOutboxStatus = useCallback(async () => {
    const snapshot = await getOfflineOutboxSnapshot();
    setOfflineOutboxSnapshot(snapshot);
  }, []);

  const syncReminderRuntimeFromPreferences = useCallback(
    async (
      nextPreferences: {
        reminderType: "daily" | "weekly";
        dailyTime: string;
        weeklyDay: string;
        formattedTime: string;
        notificationsEnabled?: boolean;
        dailySummaryEnabled?: boolean;
        weeklyInsightsEnabled?: boolean;
        quietHoursEnabled?: boolean;
        quietHoursStart?: string;
        quietHoursEnd?: string;
      } | null,
    ) => {
      const runtime = await syncReminderNotifications(nextPreferences);
      setReminderRuntime(runtime);
      return runtime;
    },
    [],
  );

  const showLifeContextConsentPrompt = useCallback(
    (feature: LifeContextFeatureKey): Promise<boolean> => {
      const disclosure = LIFE_CONTEXT_DISCLOSURE[feature];

      return new Promise((resolve) => {
        let settled = false;

        const complete = (value: boolean) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        Alert.alert(
          disclosure.title,
          `${disclosure.description}\n\n${disclosure.consentLabel}`,
          [
            {
              text: "Cancel",
              style: "cancel",
              onPress: () => complete(false),
            },
            {
              text: "Enable",
              onPress: () => complete(true),
            },
          ],
          {
            cancelable: true,
            onDismiss: () => complete(false),
          },
        );
      });
    },
    [],
  );

  const evaluateFeaturePermission = useCallback(
    async (feature: LifeContextFeatureKey) => {
      const currentPlatform: "ios" | "android" | "web" =
        Platform.OS === "ios"
          ? "ios"
          : Platform.OS === "android"
            ? "android"
            : "web";

      return await evaluateLifeContextFeaturePermission({
        feature,
        platform: currentPlatform,
        locationTrackingEnabled,
        backgroundTrackingRuntimeEnabled:
          locationTrackingRuntimeConfig?.enableBackgroundLocationTracking ??
          false,
        ensureForegroundLocationPermission: async () => {
          const permission = await Location.getForegroundPermissionsAsync();
          if (permission.status === "granted") return true;

          const requested = await Location.requestForegroundPermissionsAsync();
          return requested.status === "granted";
        },
        ensureBackgroundLocationPermission: async () => {
          const permission = await Location.getBackgroundPermissionsAsync();
          if (permission.status === "granted") return true;

          const requested = await Location.requestBackgroundPermissionsAsync();
          return requested.status === "granted";
        },
        ensureCallLogsPermission: async () => {
          if (!isAndroidCallActivityCollectionSupported()) {
            return false;
          }

          return await requestAndroidCallActivityPermission();
        },
        ensureMoodDetectionPermission: async () => true,
        ensureCalendarNotificationPermission: async () => {
          const status = await ensureReminderPermissions();
          return status === "granted";
        },
        ensureFitnessPermission: async () => {
          if (Platform.OS === "ios") {
            const setupIssue = getAppleHealthSetupIssue();
            if (setupIssue) {
              return {
                ok: false,
                reason: setupIssue,
              };
            }

            return { ok: true };
          }

          if (Platform.OS === "android") {
            const hasGoogleFitIntegration = (integrations ?? []).some(
              (integration) =>
                integration.provider === "google_fit" &&
                integration.status === "connected",
            );

            if (!hasGoogleFitIntegration) {
              return {
                ok: false,
                reason:
                  "Connect Google Fit first to enable fitness context on Android.",
              };
            }
          }

          return { ok: true };
        },
      });
    },
    [
      integrations,
      locationTrackingEnabled,
      locationTrackingRuntimeConfig?.enableBackgroundLocationTracking,
    ],
  );

  const savePreferencePatch = useCallback(
    async (patch: ReminderPreferencePatch) => {
      if (!preferences) {
        Alert.alert("Complete quick setup", "Set your preferences first.", [
          {
            text: "Open Setup",
            onPress: () => router.push("/(tabs)/quick-setup"),
          },
          { text: "Cancel", style: "cancel" },
        ]);
        return false;
      }

      const settingsPatch = normalizeUserSettingsPatch({
        theme: patch.theme,
        notificationsEnabled: patch.notificationsEnabled,
        dailySummaryEnabled: patch.dailySummaryEnabled,
        weeklyInsightsEnabled: patch.weeklyInsightsEnabled,
        quietHoursEnabled: patch.quietHoursEnabled,
        quietHoursStart: patch.quietHoursStart,
        quietHoursEnd: patch.quietHoursEnd,
        autoSyncIntegrations: patch.autoSyncIntegrations,
        defaultMemoryMood: patch.defaultMemoryMood,
      });

      await syncUserPreferences({
        focusAreas: preferences.focusAreas,
        reminderType: patch.reminderType ?? preferences.reminderType,
        dailyTime: preferences.dailyTime,
        weeklyDay: preferences.weeklyDay,
        formattedTime: preferences.formattedTime,
        theme: settingsPatch.theme ?? preferences.theme,
        notificationsEnabled:
          settingsPatch.notificationsEnabled ??
          preferences.notificationsEnabled,
        dailySummaryEnabled:
          settingsPatch.dailySummaryEnabled ?? preferences.dailySummaryEnabled,
        weeklyInsightsEnabled:
          settingsPatch.weeklyInsightsEnabled ??
          preferences.weeklyInsightsEnabled,
        quietHoursEnabled:
          settingsPatch.quietHoursEnabled ?? preferences.quietHoursEnabled,
        quietHoursStart:
          settingsPatch.quietHoursStart ?? preferences.quietHoursStart,
        quietHoursEnd: settingsPatch.quietHoursEnd ?? preferences.quietHoursEnd,
        autoSyncIntegrations:
          settingsPatch.autoSyncIntegrations ??
          preferences.autoSyncIntegrations,
        defaultMemoryMood:
          settingsPatch.defaultMemoryMood ?? preferences.defaultMemoryMood,
      });

      await syncReminderRuntimeFromPreferences({
        reminderType: patch.reminderType ?? preferences.reminderType,
        dailyTime: preferences.dailyTime,
        weeklyDay: preferences.weeklyDay,
        formattedTime: preferences.formattedTime,
        notificationsEnabled:
          settingsPatch.notificationsEnabled ??
          preferences.notificationsEnabled,
        dailySummaryEnabled:
          settingsPatch.dailySummaryEnabled ?? preferences.dailySummaryEnabled,
        weeklyInsightsEnabled:
          settingsPatch.weeklyInsightsEnabled ??
          preferences.weeklyInsightsEnabled,
        quietHoursEnabled:
          settingsPatch.quietHoursEnabled ?? preferences.quietHoursEnabled,
        quietHoursStart:
          settingsPatch.quietHoursStart ?? preferences.quietHoursStart,
        quietHoursEnd: settingsPatch.quietHoursEnd ?? preferences.quietHoursEnd,
      });

      return true;
    },
    [
      preferences,
      router,
      syncReminderRuntimeFromPreferences,
      syncUserPreferences,
    ],
  );

  useEffect(() => {
    if (!preferences) {
      setDarkMode(effectiveTheme === "dark");
      setAllNotifications(true);
      setDailySummary(false);
      setWeeklyInsights(false);
      setQuietHours(false);
      setQuietHoursStart(SETTINGS_DEFAULTS.quietHoursStart);
      setQuietHoursEnd(SETTINGS_DEFAULTS.quietHoursEnd);
      setAutoSyncIntegrations(SETTINGS_DEFAULTS.autoSyncIntegrations);
      setDefaultMemoryMood(SETTINGS_DEFAULTS.defaultMemoryMood);
      setLocationTrackingEnabled(SETTINGS_DEFAULTS.locationTrackingEnabled);
      setCallLogsTrackingEnabled(SETTINGS_DEFAULTS.callLogsTrackingEnabled);
      setMoodAssistanceEnabled(
        SETTINGS_DEFAULTS.moodDetectionFaceRecognitionEnabled,
      );
      setFitnessTrackingEnabled(SETTINGS_DEFAULTS.fitnessTrackingEnabled);
      setCalendarContextEnabled(
        SETTINGS_DEFAULTS.calendarNotificationsTrackingEnabled,
      );
      setBackgroundLocationTrackingEnabled(
        SETTINGS_DEFAULTS.backgroundLocationTrackingEnabled,
      );
      return;
    }

    setDarkMode(
      preferences.theme === "dark" ||
        (preferences.theme === "system" && effectiveTheme === "dark"),
    );
    setAllNotifications(preferences.notificationsEnabled ?? true);
    setDailySummary(preferences.reminderType === "daily");
    setWeeklyInsights(preferences.reminderType === "weekly");
    setQuietHours(preferences.quietHoursEnabled ?? false);
    setQuietHoursStart(
      preferences.quietHoursStart ?? SETTINGS_DEFAULTS.quietHoursStart,
    );
    setQuietHoursEnd(
      preferences.quietHoursEnd ?? SETTINGS_DEFAULTS.quietHoursEnd,
    );
    setAutoSyncIntegrations(
      preferences.autoSyncIntegrations ??
        SETTINGS_DEFAULTS.autoSyncIntegrations,
    );
    setDefaultMemoryMood(
      preferences.defaultMemoryMood ?? SETTINGS_DEFAULTS.defaultMemoryMood,
    );
    setLocationTrackingEnabled(
      preferences.locationTrackingEnabled ??
        SETTINGS_DEFAULTS.locationTrackingEnabled,
    );
    setCallLogsTrackingEnabled(
      preferences.callLogsTrackingEnabled ??
        SETTINGS_DEFAULTS.callLogsTrackingEnabled,
    );
    setMoodAssistanceEnabled(
      preferences.moodDetectionFaceRecognitionEnabled ??
        SETTINGS_DEFAULTS.moodDetectionFaceRecognitionEnabled,
    );
    setFitnessTrackingEnabled(
      preferences.fitnessTrackingEnabled ??
        SETTINGS_DEFAULTS.fitnessTrackingEnabled,
    );
    setCalendarContextEnabled(
      preferences.calendarNotificationsTrackingEnabled ??
        SETTINGS_DEFAULTS.calendarNotificationsTrackingEnabled,
    );
    setBackgroundLocationTrackingEnabled(
      preferences.backgroundLocationTrackingEnabled ??
        SETTINGS_DEFAULTS.backgroundLocationTrackingEnabled,
    );
  }, [effectiveTheme, preferences]);

  useEffect(() => {
    if (!searchParams.integrationStatus || !searchParams.integrationMessage) {
      return;
    }

    const providerKey = searchParams.integrationProvider;
    const providerLabel = providerKey
      ? (INTEGRATION_PROVIDER_META[
          providerKey as keyof typeof INTEGRATION_PROVIDER_META
        ]?.label ?? providerKey)
      : "Integration";
    const wasSuccess = searchParams.integrationStatus === "success";
    const alertTitle = wasSuccess
      ? `${providerLabel} connected`
      : `${providerLabel} connection failed`;
    const alertMessage = wasSuccess
      ? `${searchParams.integrationMessage}\n\nYou can now tap Sync now in Integrations.`
      : `${searchParams.integrationMessage}\n\nPlease try Connect again.`;

    setIntegrationFeedback({
      type: wasSuccess ? "success" : "error",
      message: searchParams.integrationMessage,
    });

    Alert.alert(alertTitle, alertMessage);

    setIntegrationFeedback((prev) => prev); // keep linter happy
    setPostIntegrationRedirect(true);
  }, [
    router,
    searchParams.integrationMessage,
    searchParams.integrationProvider,
    searchParams.integrationStatus,
  ]);

  useEffect(() => {
    void (async () => {
      try {
        const runtime = await getReminderRuntimeState();
        setReminderRuntime(runtime);
      } catch (error) {
        captureException("mobile_profile_reminder_runtime_load_failed", error);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!backgroundLocationTrackingEnabled) {
      setBackgroundLocationRuntimeStatus(null);
      return;
    }

    void (async () => {
      try {
        const status = await getBackgroundLocationEnablementStatus();
        if (cancelled) return;

        const runtimeAllowed =
          locationTrackingRuntimeConfig?.enableBackgroundLocationTracking ??
          false;

        setBackgroundLocationRuntimeStatus({
          fullyEnabled: status.fullyEnabled && runtimeAllowed,
          reason: status.reason,
        });
      } catch (error) {
        if (cancelled) return;
        setBackgroundLocationRuntimeStatus(null);
        captureException(
          "mobile_profile_background_location_status_load_failed",
          error,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    backgroundLocationTrackingEnabled,
    locationTrackingRuntimeConfig?.enableBackgroundLocationTracking,
  ]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const diagnostics = await refreshCallActivityDiagnostics();
        if (cancelled) return;
        setCallActivityDiagnostics(diagnostics);
      } catch (error) {
        if (cancelled) return;
        captureException(
          "mobile_profile_call_activity_diagnostics_refresh_failed",
          error,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [callLogsTrackingEnabled, refreshCallActivityDiagnostics]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;

      void (async () => {
        try {
          const diagnostics = await refreshCallActivityDiagnostics();
          setCallActivityDiagnostics(diagnostics);
          await refreshOfflineOutboxStatus();
        } catch (error) {
          captureException("mobile_profile_active_state_refresh_failed", error);
        }
      })();
    });

    return () => {
      subscription.remove();
    };
  }, [refreshCallActivityDiagnostics, refreshOfflineOutboxStatus]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const snapshot = await getOfflineOutboxSnapshot();
      if (!cancelled) {
        setOfflineOutboxSnapshot(snapshot);
      }
    };

    void refresh();
    const intervalId = setInterval(() => {
      void refresh();
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const jobIdFromStatus = accountDeletionStatus?.job?.id;
    if (jobIdFromStatus && trackedDeletionJobId !== jobIdFromStatus) {
      setTrackedDeletionJobId(jobIdFromStatus);
    }
  }, [
    accountDeletionStatus?.job?.id,
    trackedDeletionJobId,
    setTrackedDeletionJobId,
  ]);

  useEffect(() => {
    if (
      !accountDeletionStatus?.requested ||
      isFinalizingAccountDeletion ||
      !trackedDeletionJobId
    ) {
      return;
    }

    if (
      accountDeletionStatus.canDeleteClerkAccount ||
      accountDeletionStatus.retryable
    ) {
      return;
    }

    const intervalId = setInterval(() => {
      setDeletionPollToken((token) => token + 1);
    }, 2000);

    return () => {
      clearInterval(intervalId);
    };
  }, [
    accountDeletionStatus?.canDeleteClerkAccount,
    accountDeletionStatus?.requested,
    accountDeletionStatus?.retryable,
    isFinalizingAccountDeletion,
    trackedDeletionJobId,
    setDeletionPollToken,
  ]);

  usePreventRemove(lockUnsafeDeletionNavigation, () => {
    Alert.alert(
      "Deletion in progress",
      "Stay on this screen until cleanup is completed or fails.",
    );
  });

  useEffect(() => {
    if (!accountDeletionStatus?.canDeleteClerkAccount) {
      return;
    }

    if (hasTriggeredAccountDeletionFinalize || isFinalizingAccountDeletion) {
      return;
    }

    void (async () => {
      setHasTriggeredAccountDeletionFinalize(true);
      setIsFinalizingAccountDeletion(true);

      logInfo("mobile_account_deletion_finalize_started", {
        status: "started",
        hasUser: Boolean(user),
        jobStatus: accountDeletionStatus.job?.status,
      });

      try {
        if (!user) {
          throw new Error("Missing Clerk user while finalizing deletion");
        }

        await user.delete();
        await signOut();

        logInfo("mobile_account_deletion_succeeded", {
          status: "succeeded",
          hasUser: true,
        });
      } catch (error) {
        captureException("mobile_account_delete_finalize_failed", error, {
          status: "failed",
          hasUser: Boolean(user),
        });
        Alert.alert(
          "Delete failed",
          "Backend cleanup finished, but account deletion could not be finalized. Please retry.",
        );
        setHasTriggeredAccountDeletionFinalize(false);
        setIsFinalizingAccountDeletion(false);
      }
    })();
  }, [
    accountDeletionStatus?.canDeleteClerkAccount,
    accountDeletionStatus?.job?.status,
    hasTriggeredAccountDeletionFinalize,
    isFinalizingAccountDeletion,
    signOut,
    user,
  ]);

  const updateReminderType = useCallback(
    async (nextReminderType: "daily" | "weekly") => {
      if (!preferences) {
        Alert.alert(
          "Complete quick setup",
          "Set your reminder preferences first.",
          [
            {
              text: "Open Setup",
              onPress: () => router.push("/(tabs)/quick-setup"),
            },
            { text: "Cancel", style: "cancel" },
          ],
        );
        return;
      }

      if (preferences.reminderType === nextReminderType) {
        return;
      }

      const previousDaily = dailySummary;
      const previousWeekly = weeklyInsights;

      setDailySummary(nextReminderType === "daily");
      setWeeklyInsights(nextReminderType === "weekly");
      setIsUpdatingReminderPreference(true);

      try {
        await savePreferencePatch({
          reminderType: nextReminderType,
          dailySummaryEnabled: nextReminderType === "daily",
          weeklyInsightsEnabled: nextReminderType === "weekly",
        });
      } catch {
        setDailySummary(previousDaily);
        setWeeklyInsights(previousWeekly);
        Alert.alert(
          "Update failed",
          "We could not update reminder preferences. Please try again.",
        );
      } finally {
        setIsUpdatingReminderPreference(false);
      }
    },
    [preferences, router, dailySummary, weeklyInsights, savePreferencePatch],
  );

  const handleDarkModeToggle = useCallback(async () => {
    const previous = darkMode;
    const next = !darkMode;
    setDarkMode(next);
    setThemePreference(next ? "dark" : "light");

    try {
      await savePreferencePatch({ theme: next ? "dark" : "light" });
    } catch {
      setDarkMode(previous);
      setThemePreference(previous ? "dark" : "light");
      Alert.alert("Update failed", "Theme preference could not be saved.");
    }
  }, [darkMode, savePreferencePatch, setThemePreference]);

  const handleAllNotificationsToggle = useCallback(async () => {
    const previous = allNotifications;
    const next = !allNotifications;
    setAllNotifications(next);

    if (next) {
      const permission = await ensureReminderPermissions();
      if (permission !== "granted") {
        setAllNotifications(previous);
        Alert.alert(
          "Notifications permission required",
          "Enable notifications in device settings to receive reminders.",
        );
        return;
      }
    }

    try {
      await savePreferencePatch({ notificationsEnabled: next });
    } catch {
      setAllNotifications(previous);
      Alert.alert(
        "Update failed",
        "Notification preference could not be saved.",
      );
    }
  }, [allNotifications, savePreferencePatch]);

  const handleQuietHoursToggle = useCallback(async () => {
    const previous = quietHours;
    const next = !quietHours;
    setQuietHours(next);

    try {
      await savePreferencePatch({ quietHoursEnabled: next });
    } catch {
      setQuietHours(previous);
      Alert.alert(
        "Update failed",
        "Quiet hours preference could not be saved.",
      );
    }
  }, [quietHours, savePreferencePatch]);

  const applyQuietHoursTime = useCallback(
    async (target: "start" | "end", value: Date) => {
      if (preferences === null) return;

      const snapped = snapToQuarterHour(value);
      const formatted = formatDateTo24h(snapped);

      if (target === "start") {
        const previous = quietHoursStart;
        setQuietHoursStart(formatted);
        try {
          await savePreferencePatch({ quietHoursStart: formatted });
        } catch {
          setQuietHoursStart(previous);
          Alert.alert(
            "Update failed",
            "Quiet hours start time could not be saved.",
          );
        }
        return;
      }

      const previous = quietHoursEnd;
      setQuietHoursEnd(formatted);
      try {
        await savePreferencePatch({ quietHoursEnd: formatted });
      } catch {
        setQuietHoursEnd(previous);
        Alert.alert(
          "Update failed",
          "Quiet hours end time could not be saved.",
        );
      }
    },
    [preferences, quietHoursEnd, quietHoursStart, savePreferencePatch],
  );

  const openQuietHoursPicker = useCallback(
    (target: "start" | "end") => {
      if (!quietHours || !allNotifications || preferences === null) return;

      const sourceTime = target === "start" ? quietHoursStart : quietHoursEnd;
      setQuietHoursPickerTarget(target);
      setQuietHoursPickerValue(parseTimeToDate(sourceTime));
      setShowQuietHoursPicker(true);
    },
    [allNotifications, preferences, quietHours, quietHoursEnd, quietHoursStart],
  );

  const handleQuietHoursPickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS === "android") {
        if (event.type === "dismissed") {
          setShowQuietHoursPicker(false);
          return;
        }

        if (selectedDate && quietHoursPickerTarget) {
          void applyQuietHoursTime(quietHoursPickerTarget, selectedDate);
        }
        setShowQuietHoursPicker(false);
        return;
      }

      if (selectedDate) {
        setQuietHoursPickerValue(snapToQuarterHour(selectedDate));
      }
    },
    [applyQuietHoursTime, quietHoursPickerTarget],
  );

  const handleQuietHoursPickerDone = useCallback(() => {
    if (!quietHoursPickerTarget) {
      setShowQuietHoursPicker(false);
      return;
    }

    void applyQuietHoursTime(quietHoursPickerTarget, quietHoursPickerValue);
    setShowQuietHoursPicker(false);
  }, [applyQuietHoursTime, quietHoursPickerTarget, quietHoursPickerValue]);

  const handleAutoSyncIntegrationsToggle = useCallback(async () => {
    const previous = autoSyncIntegrations;
    const next = !autoSyncIntegrations;
    setAutoSyncIntegrations(next);

    try {
      await savePreferencePatch({ autoSyncIntegrations: next });
    } catch {
      setAutoSyncIntegrations(previous);
      Alert.alert(
        "Update failed",
        "Integration preference could not be saved.",
      );
    }
  }, [autoSyncIntegrations, savePreferencePatch]);

  const handleDefaultMemoryMoodChange = useCallback(
    async (nextMood: string) => {
      if (defaultMemoryMood === nextMood) return;

      const previous = defaultMemoryMood;
      setDefaultMemoryMood(nextMood);

      try {
        await savePreferencePatch({ defaultMemoryMood: nextMood });
      } catch {
        setDefaultMemoryMood(previous);
        Alert.alert("Update failed", "Default memory mood could not be saved.");
      }
    },
    [defaultMemoryMood, savePreferencePatch],
  );

  const handleLocationTrackingToggle = useCallback(async () => {
    if (!preferences) {
      Alert.alert("Complete quick setup", "Set your preferences first.", [
        {
          text: "Open Setup",
          onPress: () => router.push("/(tabs)/quick-setup"),
        },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }

    const previous = locationTrackingEnabled;
    const next = !locationTrackingEnabled;

    if (next) {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        const requested = await Location.requestForegroundPermissionsAsync();
        if (requested.status !== "granted") {
          setLocationTrackingEnabled(false);
          await updateMyLocationTrackingState({
            locationTrackingEnabled: false,
            locationPermissionStatus: "denied",
          });

          Alert.alert(
            "Location permission needed",
            "DayLog only stores coarse area signals while the app is open. Enable location permission in system settings to turn this on.",
            [
              {
                text: "Open Settings",
                onPress: () => {
                  void Linking.openSettings();
                },
              },
              { text: "Not now", style: "cancel" },
            ],
          );
          return;
        }
      }
    }

    setLocationTrackingEnabled(next);

    if (!next) {
      setBackgroundLocationTrackingEnabled(false);
    }

    try {
      await updateMyLocationTrackingState({
        locationTrackingEnabled: next,
        backgroundLocationTrackingEnabled: next
          ? backgroundLocationTrackingEnabled
          : false,
        locationPermissionStatus: next
          ? (preferences.locationPermissionStatus ?? "unknown")
          : "unknown",
      });

      setIntegrationFeedback({
        type: "success",
        message: next
          ? "Foreground location tracking enabled. DayLog only collects coarse area signals while the app is open."
          : "Foreground location tracking disabled.",
      });
    } catch {
      setLocationTrackingEnabled(previous);
      Alert.alert(
        "Update failed",
        "Location tracking preference could not be saved.",
      );
    }
  }, [
    backgroundLocationTrackingEnabled,
    locationTrackingEnabled,
    preferences,
    router,
    updateMyLocationTrackingState,
  ]);

  const ensurePreferencesReady = useCallback(() => {
    if (preferences) return true;

    Alert.alert("Complete quick setup", "Set your preferences first.", [
      {
        text: "Open Setup",
        onPress: () => router.push("/(tabs)/quick-setup"),
      },
      { text: "Cancel", style: "cancel" },
    ]);

    return false;
  }, [preferences, router]);

  const applyLifeContextPreferencePatch = useCallback(
    async (patch: LifeContextPreferencePatch) => {
      const normalizedPatch = normalizeLifeContextUserSettingsPatch(patch);
      await updateMyLocationTrackingState(normalizedPatch);
    },
    [updateMyLocationTrackingState],
  );

  const handleCalendarContextToggle = useCallback(async () => {
    if (!ensurePreferencesReady()) return;

    const previous = calendarContextEnabled;
    const next = !calendarContextEnabled;

    if (next) {
      const consented = await showLifeContextConsentPrompt(
        "calendarNotifications",
      );
      if (!consented) return;

      const permission = await evaluateFeaturePermission(
        "calendarNotifications",
      );
      if (!permission.ok) {
        Alert.alert("Permission required", permission.reason);
        return;
      }
    }

    setCalendarContextEnabled(next);

    try {
      await applyLifeContextPreferencePatch({
        calendarNotificationsTrackingEnabled: next,
      });

      setIntegrationFeedback({
        type: "success",
        message: next
          ? "Calendar and reminder context enabled."
          : "Calendar and reminder context disabled.",
      });
    } catch {
      setCalendarContextEnabled(previous);
      Alert.alert(
        "Update failed",
        "Calendar context preference could not be saved.",
      );
    }
  }, [
    applyLifeContextPreferencePatch,
    calendarContextEnabled,
    ensurePreferencesReady,
    evaluateFeaturePermission,
    showLifeContextConsentPrompt,
  ]);

  const handleFitnessTrackingToggle = useCallback(async () => {
    if (!ensurePreferencesReady()) return;

    const previous = fitnessTrackingEnabled;
    const next = !fitnessTrackingEnabled;

    if (next) {
      const consented = await showLifeContextConsentPrompt("fitness");
      if (!consented) return;

      const permission = await evaluateFeaturePermission("fitness");
      if (!permission.ok) {
        Alert.alert("Fitness setup required", permission.reason);
        return;
      }
    }

    setFitnessTrackingEnabled(next);

    try {
      await applyLifeContextPreferencePatch({
        fitnessTrackingEnabled: next,
      });

      setIntegrationFeedback({
        type: "success",
        message: next
          ? "Fitness context enabled."
          : "Fitness context disabled.",
      });
    } catch {
      setFitnessTrackingEnabled(previous);
      Alert.alert(
        "Update failed",
        "Fitness context preference could not be saved.",
      );
    }
  }, [
    applyLifeContextPreferencePatch,
    ensurePreferencesReady,
    evaluateFeaturePermission,
    fitnessTrackingEnabled,
    showLifeContextConsentPrompt,
  ]);

  const handleCallSummaryToggle = useCallback(async () => {
    if (!ensurePreferencesReady()) return;

    const previous = callLogsTrackingEnabled;
    const next = !callLogsTrackingEnabled;

    if (next && Platform.OS === "android" && !callActivityCollectionSupported) {
      Alert.alert(
        "Communication summary unavailable",
        "This Android build does not include the native call activity module. Install and build with call activity support, then try again.",
      );
      return;
    }

    if (next) {
      const consented = await showLifeContextConsentPrompt("callLogs");
      if (!consented) return;

      const permission = await evaluateFeaturePermission("callLogs");
      if (!permission.ok) {
        Alert.alert("Call summary unavailable", permission.reason);
        return;
      }
    }

    setCallLogsTrackingEnabled(next);

    try {
      await applyLifeContextPreferencePatch({
        callLogsTrackingEnabled: next,
      });

      setIntegrationFeedback({
        type: "success",
        message: next
          ? "Communication call summary enabled."
          : "Communication call summary disabled.",
      });
    } catch {
      setCallLogsTrackingEnabled(previous);
      Alert.alert(
        "Update failed",
        "Communication summary preference could not be saved.",
      );
    }
  }, [
    applyLifeContextPreferencePatch,
    callActivityCollectionSupported,
    callLogsTrackingEnabled,
    ensurePreferencesReady,
    evaluateFeaturePermission,
    showLifeContextConsentPrompt,
  ]);

  const handleMoodAssistanceToggle = useCallback(async () => {
    if (!ensurePreferencesReady()) return;

    const previous = moodAssistanceEnabled;
    const next = !moodAssistanceEnabled;

    if (next) {
      const consented = await showLifeContextConsentPrompt("moodDetection");
      if (!consented) return;

      const permission = await evaluateFeaturePermission("moodDetection");
      if (!permission.ok) {
        Alert.alert("Mood assistance unavailable", permission.reason);
        return;
      }
    }

    setMoodAssistanceEnabled(next);

    try {
      await applyLifeContextPreferencePatch({
        moodDetectionFaceRecognitionEnabled: next,
      });

      setIntegrationFeedback({
        type: "success",
        message: next
          ? "Mood assistance enabled."
          : "Mood assistance disabled.",
      });
    } catch {
      setMoodAssistanceEnabled(previous);
      Alert.alert(
        "Update failed",
        "Mood assistance preference could not be saved.",
      );
    }
  }, [
    applyLifeContextPreferencePatch,
    ensurePreferencesReady,
    evaluateFeaturePermission,
    moodAssistanceEnabled,
    showLifeContextConsentPrompt,
  ]);

  const handleBackgroundLocationTrackingToggle = useCallback(async () => {
    if (!ensurePreferencesReady()) return;

    const previous = backgroundLocationTrackingEnabled;
    const next = !backgroundLocationTrackingEnabled;

    if (next) {
      const consented =
        await showLifeContextConsentPrompt("backgroundLocation");
      if (!consented) return;

      const permission = await evaluateFeaturePermission("backgroundLocation");
      if (!permission.ok) {
        Alert.alert("Background location unavailable", permission.reason);
        return;
      }
    }

    setBackgroundLocationTrackingEnabled(next);

    try {
      await applyLifeContextPreferencePatch({
        backgroundLocationTrackingEnabled: next,
      });

      setIntegrationFeedback({
        type: "success",
        message: next
          ? "Controlled background location enabled."
          : "Controlled background location disabled.",
      });
    } catch {
      setBackgroundLocationTrackingEnabled(previous);
      Alert.alert(
        "Update failed",
        "Background location preference could not be saved.",
      );
    }
  }, [
    applyLifeContextPreferencePatch,
    backgroundLocationTrackingEnabled,
    ensurePreferencesReady,
    evaluateFeaturePermission,
    showLifeContextConsentPrompt,
  ]);

  const closeAppPasswordModal = useCallback(() => {
    setShowAppPasswordModal(false);
    setAppPasswordValue("");
    setAppPasswordConfirmValue("");
    setAppPasswordError(null);
    setIsSavingAppPassword(false);
  }, []);

  const handleBiometricToggle = useCallback(async () => {
    if (!isAppLockReady) {
      return;
    }

    const nextEnabled = !biometricEnabled;
    const result = await updateBiometricEnabled(nextEnabled);

    if (!result.ok) {
      Alert.alert(
        "Biometric unavailable",
        result.message ??
          "Biometric authentication is unavailable on this device.",
      );
      return;
    }

    Alert.alert(
      nextEnabled
        ? `${biometricDisplayName} enabled`
        : `${biometricDisplayName} disabled`,
      nextEnabled
        ? "You can now unlock DayLog with biometrics and fallback to PIN/password."
        : "Biometric unlock has been disabled.",
    );
  }, [
    biometricDisplayName,
    biometricEnabled,
    isAppLockReady,
    updateBiometricEnabled,
  ]);

  const handlePromptOnAppOpenToggle = useCallback(async () => {
    if (!isAppLockReady) {
      return;
    }

    const nextEnabled = !promptOnAppOpen;

    if (nextEnabled && !biometricEnabled && !hasAppPassword) {
      Alert.alert(
        "Add an unlock method first",
        "Enable biometrics or set an app PIN/password before turning on open-app prompts.",
      );
      return;
    }

    try {
      await updatePromptOnAppOpen(nextEnabled);
    } catch {
      Alert.alert("Update failed", "Could not update this security setting.");
    }
  }, [
    biometricEnabled,
    hasAppPassword,
    isAppLockReady,
    promptOnAppOpen,
    updatePromptOnAppOpen,
  ]);

  const handleSelectSessionTimeout = useCallback(() => {
    if (!isAppLockReady) {
      return;
    }

    const timeoutButtons = sessionTimeoutOptions.map((option) => ({
      text:
        option.valueMs === sessionTimeoutMs
          ? `${option.label} ✓`
          : option.label,
      onPress: () => {
        void updateSessionTimeoutMs(option.valueMs);
      },
    }));

    Alert.alert(
      "Session Timeout",
      "Require re-authentication after returning to DayLog from background:",
      [...timeoutButtons, { text: "Cancel", style: "cancel" }],
    );
  }, [
    isAppLockReady,
    sessionTimeoutMs,
    sessionTimeoutOptions,
    updateSessionTimeoutMs,
  ]);

  const handleManageAppPassword = useCallback(() => {
    void (async () => {
      if (!isAppLockReady) {
        return;
      }

      const granted = await requestSensitiveReauth({
        reason: "Authenticate to manage app PIN/password",
        force: true,
      });

      if (!granted) {
        Alert.alert(
          "Authentication required",
          "Could not verify your identity to manage app password settings.",
        );
        return;
      }

      setAppPasswordValue("");
      setAppPasswordConfirmValue("");
      setAppPasswordError(null);
      setShowAppPasswordModal(true);
    })();
  }, [isAppLockReady, requestSensitiveReauth]);

  const handleSaveAppPassword = useCallback(() => {
    void (async () => {
      if (isSavingAppPassword) {
        return;
      }

      if (appPasswordValue.trim().length < 4) {
        setAppPasswordError("Use at least 4 characters for your PIN/password.");
        return;
      }

      if (appPasswordValue !== appPasswordConfirmValue) {
        setAppPasswordError("PIN/password entries do not match.");
        return;
      }

      setIsSavingAppPassword(true);
      setAppPasswordError(null);

      try {
        const result = await setAppPassword(appPasswordValue);
        if (!result.ok) {
          setAppPasswordError(
            result.message ??
              "Could not save app PIN/password. Please try again.",
          );
          return;
        }

        closeAppPasswordModal();
        Alert.alert(
          hasAppPassword ? "Password updated" : "Password enabled",
          "App PIN/password fallback is now active.",
        );
      } finally {
        setIsSavingAppPassword(false);
      }
    })();
  }, [
    appPasswordConfirmValue,
    appPasswordValue,
    closeAppPasswordModal,
    hasAppPassword,
    isSavingAppPassword,
    setAppPassword,
  ]);

  /* ── Callbacks ────────────────────────── */
  const handleSignOut = useCallback(() => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut();
            router.replace("/(auth)/sign-in");
          } catch (error) {
            captureException("mobile_sign_out_failed", error);
            Alert.alert("Sign out failed", "Please try again.");
          }
        },
      },
    ]);
  }, [router, signOut]);

  const handleExportData = useCallback(() => {
    void (async () => {
      if (lockUnsafeDeletionNavigation) {
        Alert.alert(
          "Deletion in progress",
          "Navigation is blocked until deletion cleanup is completed or fails.",
        );
        return;
      }

      const granted = await requestSensitiveReauth({
        reason: "Authenticate to export your DayLog data",
        force: true,
      });

      if (!granted) {
        Alert.alert(
          "Authentication required",
          "Export was canceled because authentication did not complete.",
        );
        return;
      }

      const webAppUrl =
        process.env.EXPO_PUBLIC_WEB_APP_URL ?? "http://localhost:3000";
      const exportUrl = `${webAppUrl.replace(/\/$/, "")}/dashboard/export`;

      void WebBrowser.openBrowserAsync(exportUrl).catch(() => {
        Alert.alert(
          "Export unavailable",
          "Could not open the export page right now. Please try again.",
        );
      });
    })();
  }, [lockUnsafeDeletionNavigation, requestSensitiveReauth]);

  const submitAccountDeletionRequest = useCallback(async () => {
    logInfo("mobile_account_deletion_request_started", {
      status: "started",
      hasUser: Boolean(user),
      hasExistingJob: Boolean(accountDeletionStatus?.job),
    });

    setIsRequestingAccountDeletion(true);
    try {
      const response = await requestAccountDeletion({});
      setTrackedDeletionJobId(response.jobId);
      setDeletionPollToken((token) => token + 1);

      logInfo("mobile_account_deletion_request_succeeded", {
        status: "succeeded",
        hasUser: Boolean(user),
        jobId: response.jobId,
        jobStatus: response.status,
        jobStage: response.stage,
        created: response.created,
        retried: response.retried,
      });

      if (response.canDeleteClerkAccount) {
        Alert.alert(
          "Finalizing deletion",
          "Backend cleanup is complete. Finalizing account deletion now.",
        );
      } else if (response.retried) {
        Alert.alert(
          "Retry started",
          "Backend cleanup is retrying. Your account will be deleted once cleanup completes.",
        );
      } else if (response.created) {
        Alert.alert(
          "Deletion started",
          "Backend cleanup started. Keep the app open until account deletion is complete.",
        );
      } else {
        Alert.alert(
          "Deletion in progress",
          "Backend cleanup is already running. We will finalize deletion automatically when it finishes.",
        );
      }
    } catch (error) {
      captureException("mobile_account_deletion_request_failed", error, {
        status: "failed",
        hasUser: Boolean(user),
      });
      Alert.alert(
        "Delete failed",
        "We could not start account deletion right now. Please try again.",
      );
    } finally {
      setIsRequestingAccountDeletion(false);
    }
  }, [
    accountDeletionStatus?.job,
    requestAccountDeletion,
    setDeletionPollToken,
    setTrackedDeletionJobId,
    user,
  ]);

  const handleDeleteAccount = useCallback(() => {
    void (async () => {
      if (isRequestingAccountDeletion || isFinalizingAccountDeletion) {
        return;
      }

      if (isAccountDeletionInProgress && !canRetryAccountDeletion) {
        Alert.alert(
          "Deletion in progress",
          "Backend cleanup is still running. We will finish deleting your account automatically once cleanup is complete.",
        );
        return;
      }

      const granted = await requestSensitiveReauth({
        reason: "Authenticate to continue with account deletion",
        force: true,
      });

      if (!granted) {
        Alert.alert(
          "Authentication required",
          "Account deletion was canceled because authentication did not complete.",
        );
        return;
      }

      Alert.alert(
        "Delete Account",
        "This action is permanent and cannot be undone. All your data will be deleted.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void submitAccountDeletionRequest();
            },
          },
        ],
      );
    })();
  }, [
    canRetryAccountDeletion,
    isAccountDeletionInProgress,
    isFinalizingAccountDeletion,
    isRequestingAccountDeletion,
    requestSensitiveReauth,
    submitAccountDeletionRequest,
  ]);

  const handleOpenAboutLink = useCallback(
    (path: string) => {
      if (lockUnsafeDeletionNavigation) {
        Alert.alert(
          "Deletion in progress",
          "Navigation is blocked until deletion cleanup is completed or fails.",
        );
        return;
      }

      const webAppUrl =
        process.env.EXPO_PUBLIC_WEB_APP_URL ?? "http://localhost:3000";
      const targetUrl = `${webAppUrl.replace(/\/$/, "")}${path}`;

      void WebBrowser.openBrowserAsync(targetUrl).catch(() => {
        Alert.alert("Link unavailable", "Could not open this page right now.");
      });
    },
    [lockUnsafeDeletionNavigation],
  );

  const setProviderAction = useCallback(
    (
      provider: string,
      action: "connect" | "disconnect" | "sync" | undefined,
    ) => {
      setProviderPendingAction((prev) => ({ ...prev, [provider]: action }));
    },
    [],
  );

  // Poll `listMyIntegrations` after an OAuth callback so the UI only reports
  // success when persistence on the *mobile user's* Convex row is confirmed.
  // Guards against cross-user writes, reactivity gaps, and silent failures.
  const verifyIntegrationPersisted = useCallback(
    async (provider: string, timeoutMs = 6000): Promise<boolean> => {
      if (!canUseIntegrationApis) {
        return false;
      }
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!canUseIntegrationApis) {
          return false;
        }
        try {
          const list = (await convexClient.query(
            api.integrations.listMyIntegrations,
            {},
          )) as IntegrationDoc[] | null | undefined;
          const found =
            Array.isArray(list) &&
            list.some(
              (integration) =>
                integration.provider === provider &&
                integration.status === "connected",
            );
          if (found) {
            return true;
          }
        } catch (error) {
          logWarn("integration_connect.verify_poll_failed", {
            area: "mobile",
            provider,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          });
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 500);
        });
      }
      return false;
    },
    [canUseIntegrationApis, convexClient],
  );

  const handleConnectIntegration = useCallback(
    async (provider: string) => {
      if (!canUseIntegrationApis) {
        return;
      }
      const providerStatus =
        INTEGRATION_PROVIDER_STATUS[
          provider as keyof typeof INTEGRATION_PROVIDER_STATUS
        ];
      if (providerStatus === "coming_soon") {
        setIntegrationFeedback({
          type: "error",
          message:
            INTEGRATION_PROVIDER_META[
              provider as keyof typeof INTEGRATION_PROVIDER_META
            ]?.helperText ?? INTEGRATION_COMING_SOON_HELPER_TEXT,
        });
        return;
      }

      if (
        !(supportedProviders ?? []).some(
          (supportedProvider) => supportedProvider === provider,
        )
      ) {
        setIntegrationFeedback({
          type: "error",
          message: "This integration is currently unavailable.",
        });
        return;
      }

      setProviderAction(provider, "connect");
      setIntegrationFeedback(null);

      try {
        if (provider === "apple_health") {
          const setupIssue = getAppleHealthSetupIssue();
          if (setupIssue) {
            Alert.alert("Apple Health setup", setupIssue);
            setIntegrationFeedback({
              type: "error",
              message: setupIssue,
            });
            return;
          }
        }

        if (provider === "apple_calendar") {
          const calendarSetupIssue = getAppleCalendarSetupIssue();
          if (calendarSetupIssue) {
            Alert.alert("Apple Calendar setup", calendarSetupIssue);
            setIntegrationFeedback({
              type: "error",
              message: calendarSetupIssue,
            });
            return;
          }
        }

        if (isOAuthProvider(provider)) {
          const webAppUrl =
            process.env.EXPO_PUBLIC_WEB_APP_URL ?? "http://localhost:3000";
          const normalizedWebAppUrl = webAppUrl.replace(/\/$/, "");
          const returnUrl = ExpoLinking.createURL("/oauth-complete");
          const returnTo = `/integrations/oauth/complete?mode=mobile&returnUrl=${encodeURIComponent(returnUrl)}`;

          // Mint a one-time handoff code that binds *this* mobile user's
          // Convex identity to the OAuth flow. The web callback forwards it
          // to Convex via `X-Mobile-Handoff`, ensuring the integration is
          // persisted on the mobile user's row even though the in-app
          // browser has its own cookie jar (isolated from mobile Clerk).
          let mobileHandoffCode: string;
          try {
            logInfo("integration_connect.oauth_handoff_requested", {
              area: "mobile",
              provider,
            });
            const handoff = await beginOAuthMobileHandoff({ provider });
            mobileHandoffCode = handoff.handoffCode;
          } catch (handoffError) {
            const label =
              INTEGRATION_PROVIDER_META[
                provider as keyof typeof INTEGRATION_PROVIDER_META
              ]?.label ?? provider;
            setIntegrationFeedback({
              type: "error",
              message: `Could not prepare ${label} connection. Please check your connection and try again.`,
            });
            captureException(
              "integration_connect.oauth_handoff_failed",
              handoffError,
              {
                area: "mobile",
                provider,
              },
            );
            return;
          }

          const startUrl = `${normalizedWebAppUrl}/api/integrations/oauth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}&mobileHandoff=${encodeURIComponent(mobileHandoffCode)}`;
          const authResult = await WebBrowser.openAuthSessionAsync(
            startUrl,
            returnUrl,
          );

          const label =
            INTEGRATION_PROVIDER_META[
              provider as keyof typeof INTEGRATION_PROVIDER_META
            ]?.label ?? provider;

          if (authResult.type === "dismiss" || authResult.type === "cancel") {
            setIntegrationFeedback({
              type: "error",
              message: `${label} connection was cancelled before completion.`,
            });
            return;
          }

          if (authResult.type !== "success") {
            setIntegrationFeedback({
              type: "error",
              message: `${label} connection could not be completed. Please try again.`,
            });
            return;
          }

          // Parse status from the browser redirect URL. Default to "error"
          // (never "success") — a missing status field means the flow did NOT
          // confirm completion and we should not fabricate a success toast.
          let redirectStatus: "success" | "error" = "error";
          let redirectMessage = "OAuth completion status was unclear.";
          try {
            const callbackUrl = new URL(authResult.url);
            const rawStatus =
              callbackUrl.searchParams.get("integrationStatus") ?? "";
            redirectStatus = rawStatus === "success" ? "success" : "error";
            const rawMessage =
              callbackUrl.searchParams.get("integrationMessage");
            if (rawMessage && rawMessage.trim().length > 0) {
              redirectMessage = rawMessage;
            } else if (redirectStatus === "success") {
              redirectMessage = `${label} connected.`;
            } else {
              redirectMessage = `${label} connection could not be verified. Please try again.`;
            }
          } catch (parseError) {
            logWarn("integration_connect.callback_url_parse_failed", {
              area: "mobile",
              provider,
              errorMessage:
                parseError instanceof Error
                  ? parseError.message
                  : String(parseError),
            });
            setIntegrationFeedback({
              type: "error",
              message: `${label} connection could not be completed. Please try again.`,
            });
            return;
          }

          if (redirectStatus === "error") {
            setIntegrationFeedback({
              type: "error",
              message: redirectMessage,
            });
            logWarn("integration_connect.oauth_callback_reported_error", {
              area: "mobile",
              provider,
              redirectMessage,
            });
            return;
          }

          // Web callback reported success — but we only trust that once the
          // integration row is visible to *this* mobile user. This catches
          // cross-user persistence (web Clerk session != mobile Clerk session),
          // silent backend failures, and reactivity gaps.
          logInfo("integration_connect.oauth_verify_started", {
            area: "mobile",
            provider,
          });
          const verified = await verifyIntegrationPersisted(provider);
          if (verified) {
            setIntegrationFeedback({
              type: "success",
              message: redirectMessage,
            });
            logInfo("integration_connect.oauth_verify_succeeded", {
              area: "mobile",
              provider,
            });
          } else {
            setIntegrationFeedback({
              type: "error",
              message: `${label} connection reported success but did not appear in your account. This can happen if you signed in to the web browser with a different account. Please try again from this device.`,
            });
            logWarn("integration_connect.oauth_verify_failed", {
              area: "mobile",
              provider,
              reason: "not_found_in_list_after_timeout",
            });
          }

          return;
        }

        logInfo("integration_connect.manual_mutation_started", {
          area: "mobile",
          provider,
        });
        await connectIntegration({ provider, scopes: [] });
        const label =
          INTEGRATION_PROVIDER_META[
            provider as keyof typeof INTEGRATION_PROVIDER_META
          ]?.label ?? provider;

        // Mutation returned — verify persistence before showing success. This
        // closes the small reactivity window where the toast could appear
        // before `listMyIntegrations` surfaces the new row.
        const verifiedManual = await verifyIntegrationPersisted(provider, 4000);
        if (verifiedManual) {
          setIntegrationFeedback({
            type: "success",
            message: `${label} connected successfully.`,
          });
          logInfo("integration_connect.manual_verify_succeeded", {
            area: "mobile",
            provider,
          });
        } else {
          setIntegrationFeedback({
            type: "error",
            message: `${label} connection was accepted but did not appear in your account. Please try again.`,
          });
          logWarn("integration_connect.manual_verify_failed", {
            area: "mobile",
            provider,
            reason: "not_found_in_list_after_timeout",
          });
        }
      } catch (error) {
        setIntegrationFeedback({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : `Failed to connect ${provider}`,
        });
        captureException("integration_connect.failed", error, {
          area: "mobile",
          provider,
        });
      } finally {
        setProviderAction(provider, undefined);
      }
    },
    [
      beginOAuthMobileHandoff,
      canUseIntegrationApis,
      connectIntegration,
      setProviderAction,
      supportedProviders,
      verifyIntegrationPersisted,
    ],
  );

  const handleDisconnectIntegration = useCallback(
    async (provider: string, integrationId: GenericId<"integrations">) => {
      if (!canUseIntegrationApis) {
        return;
      }
      setProviderAction(provider, "disconnect");
      setIntegrationFeedback(null);

      try {
        await disconnectIntegration({ integrationId });
        const label =
          INTEGRATION_PROVIDER_META[
            provider as keyof typeof INTEGRATION_PROVIDER_META
          ]?.label ?? provider;
        setIntegrationFeedback({
          type: "success",
          message: `${label} disconnected.`,
        });
      } catch (error) {
        setIntegrationFeedback({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : `Failed to disconnect ${provider}`,
        });
      } finally {
        setProviderAction(provider, undefined);
      }
    },
    [canUseIntegrationApis, disconnectIntegration, setProviderAction],
  );

  const handleSyncIntegration = useCallback(
    async (provider: string) => {
      if (!canUseIntegrationApis) {
        return;
      }
      if (provider === "spotify") {
        const spotifyIntegration = (integrations ?? []).find(
          (entry) => entry.provider === "spotify",
        );
        if (spotifyIntegration?.status !== "connected") {
          setIntegrationFeedback({
            type: "error",
            message: "Spotify is not connected. Reconnect Spotify to sync.",
          });
          return;
        }
      }
      logInfo("mobile_integration_sync_started", {
        status: "started",
        provider,
        dayKey: todayDayKey,
      });

      setProviderAction(provider, "sync");
      setIntegrationFeedback(null);
      const userTimeZone = getResolvedTimeZone();

      try {
        if (provider === "apple_health") {
          const setupIssue = getAppleHealthSetupIssue();
          if (setupIssue) {
            logWarn("mobile_integration_sync_skipped", {
              status: "skipped",
              provider,
              dayKey: todayDayKey,
              reason: "apple_health_setup_issue",
              errorMessage: setupIssue,
            });
            Alert.alert("Apple Health setup", setupIssue);
            setIntegrationFeedback({
              type: "error",
              message: setupIssue,
            });
            return;
          }

          const appleHealthData = await collectAppleHealthDailyDataForDay(
            todayDayKey,
            userTimeZone,
          );

          await syncAppleHealthDailyData({
            dayKey: todayDayKey,
            metrics: appleHealthData.metrics,
            summary: appleHealthData.summary,
            signals: appleHealthData.signals,
          });

          logInfo("mobile_integration_sync_succeeded", {
            status: "succeeded",
            provider,
            dayKey: todayDayKey,
            source: "apple_health",
          });

          setIntegrationFeedback({
            type: "success",
            message: "Apple Health data synced from this device.",
          });

          return;
        }

        if (provider === "apple_calendar") {
          const calendarSetupIssue = getAppleCalendarSetupIssue();
          if (calendarSetupIssue) {
            logWarn("mobile_integration_sync_skipped", {
              status: "skipped",
              provider,
              dayKey: todayDayKey,
              reason: "apple_calendar_setup_issue",
              errorMessage: calendarSetupIssue,
            });
            Alert.alert("Apple Calendar setup", calendarSetupIssue);
            setIntegrationFeedback({
              type: "error",
              message: calendarSetupIssue,
            });
            return;
          }

          const calendarDelta = await computeAppleCalendarDeltaForDay(
            todayDayKey,
            userTimeZone,
          );
          const calendarData = calendarDelta.payload;

          if (!calendarDelta.changed) {
            logInfo("mobile_integration_sync_skipped_unchanged", {
              status: "skipped",
              provider,
              dayKey: todayDayKey,
              reason: calendarDelta.reason,
              contentHash: calendarDelta.contentHash,
            });
            setIntegrationFeedback({
              type: "success",
              message: `Apple Calendar already up to date — ${calendarData.context.meetingsCount} event(s) today.`,
            });
            return;
          }

          await upsertMyIntegrationDailyData({
            provider: "calendar",
            dayKey: todayDayKey,
            summary: calendarData.summary,
            signals: calendarData.signals,
            context: {
              schemaVersion: 1,
              calendar: {
                meetingsCount:
                  calendarData.context.meetingsCount > 0
                    ? calendarData.context.meetingsCount
                    : undefined,
                busyMinutes:
                  calendarData.context.busyMinutes > 0
                    ? calendarData.context.busyMinutes
                    : undefined,
                eventTitles:
                  calendarData.context.eventTitles.length > 0
                    ? calendarData.context.eventTitles
                    : undefined,
              },
            },
          });

          await syncMyIntegrationForDay({
            provider,
            dayKey: todayDayKey,
            timeZone: userTimeZone,
          });

          // Only record the commit marker after both the upsert AND the
          // derived sync succeeded. If either step threw, we leave the
          // stored hash untouched so the next attempt retries the upload.
          await recordAppleCalendarSyncCommitted(
            todayDayKey,
            userTimeZone,
            calendarDelta.contentHash,
            calendarData.context.meetingsCount,
          );

          logInfo("mobile_integration_sync_succeeded", {
            status: "succeeded",
            provider,
            dayKey: todayDayKey,
            source: "apple_calendar",
            deltaReason: calendarDelta.reason,
            contentHash: calendarDelta.contentHash,
          });

          setIntegrationFeedback({
            type: "success",
            message: `Apple Calendar synced — ${calendarData.context.meetingsCount} event(s) today.`,
          });

          return;
        }

        const result = await syncMyIntegrationForDay({
          provider,
          dayKey: todayDayKey,
          timeZone: userTimeZone,
        });
        if (result?.success === false && result.reason === "reauth_required") {
          setIntegrationFeedback({
            type: "error",
            message:
              "Spotify session expired. Please reconnect Spotify and try again.",
          });
          return;
        }

        let screenTimeMessage = "";
        if (provider === "google_fit" && Platform.OS === "android") {
          try {
            const screenTimeData =
              await collectAndroidScreenTimeDailyDataForDay(
                todayDayKey,
                userTimeZone,
              );

            await upsertMyIntegrationDailyData({
              provider: "google_fit",
              dayKey: todayDayKey,
              metrics: {
                screenTimeMinutes: screenTimeData.metrics.screenTimeMinutes,
              },
              summary: screenTimeData.summary,
              signals: screenTimeData.signals,
            });

            if (screenTimeData.metrics.screenTimeMinutes) {
              screenTimeMessage = ` Screen time included (${screenTimeData.metrics.screenTimeMinutes} min).`;
            }
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Screen time data unavailable.";
            screenTimeMessage = ` Google Fit synced, but screen time was not added: ${message}`;
          }
        }

        if (provider === "google_fit" && Platform.OS === "ios") {
          try {
            const screenTimeData =
              await collectIosScreenTimeDailyDataForDay(todayDayKey);

            await upsertMyIntegrationDailyData({
              provider: "google_fit",
              dayKey: todayDayKey,
              metrics: {
                screenTimeMinutes: screenTimeData.metrics.screenTimeMinutes,
              },
              summary: screenTimeData.summary,
              signals: screenTimeData.signals,
            });

            if (screenTimeData.metrics.screenTimeMinutes) {
              screenTimeMessage = ` Screen time included (${screenTimeData.metrics.screenTimeMinutes} min).`;
            }
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Screen time data unavailable.";
            screenTimeMessage = ` Google Fit synced, but iOS screen time was not added: ${message}`;
          }
        }

        if (result?.idempotent) {
          logInfo("mobile_integration_sync_skipped", {
            status: "skipped",
            provider,
            dayKey: todayDayKey,
            reason: result.skippedReason,
          });
          setIntegrationFeedback({
            type: "success",
            message:
              result.skippedReason === "already_synced"
                ? "Already synced for today."
                : "Sync is already in progress.",
          });
        } else {
          logInfo("mobile_integration_sync_succeeded", {
            status: "succeeded",
            provider,
            dayKey: todayDayKey,
          });
          setIntegrationFeedback({
            type: "success",
            message: `Sync completed successfully.${screenTimeMessage}`,
          });
        }
      } catch (error) {
        captureException("mobile_integration_sync_failed", error, {
          status: "failed",
          provider,
          dayKey: todayDayKey,
        });
        setIntegrationFeedback({
          type: "error",
          message: error instanceof Error ? error.message : "Sync failed.",
        });
      } finally {
        setProviderAction(provider, undefined);
      }
    },
    [
      canUseIntegrationApis,
      integrations,
      setProviderAction,
      upsertMyIntegrationDailyData,
      syncAppleHealthDailyData,
      syncMyIntegrationForDay,
      todayDayKey,
    ],
  );

  const handleShowAppleHealthSetup = useCallback(() => {
    const setupIssue = getAppleHealthSetupIssue();

    if (setupIssue) {
      Alert.alert("Apple Health setup", setupIssue);
      return;
    }

    Alert.alert(
      "Apple Health setup",
      "Apple Health appears configured. Tap Sync now to pull data for today.",
    );
  }, []);
  const userName = user?.fullName ?? user?.firstName ?? "User";
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
  const profileImageUrl =
    currentProfile?.profileImageUrl ?? user?.imageUrl ?? undefined;
  const providerImageOptions = (user?.externalAccounts ?? [])
    .map((account) => {
      const providerRaw = String(
        (account as { provider?: string }).provider ?? "",
      );
      const imageUrl = (account as { imageUrl?: string }).imageUrl;
      if (!imageUrl) return null;
      if (providerRaw.includes("apple")) {
        return { key: "apple" as const, label: "Apple", imageUrl };
      }
      if (providerRaw.includes("google")) {
        return { key: "google" as const, label: "Google", imageUrl };
      }
      return null;
    })
    .filter(
      (
        option,
      ): option is {
        key: "apple" | "google";
        label: string;
        imageUrl: string;
      } => option !== null,
    );

  const handleUploadProfileImage = async () => {
    try {
      setIsUpdatingProfileImage(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.72,
      });
      if (result.canceled || !result.assets[0]?.uri) {
        return;
      }

      const { uploadUrl } = await generateProfileImageUploadUrl({});
      const imageResponse = await fetch(result.assets[0].uri);
      const imageBlob = await imageResponse.blob();
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": imageBlob.type || "application/octet-stream",
        },
        body: imageBlob,
      });
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`);
      }
      const uploadResult = (await uploadResponse.json()) as {
        storageId?: string;
      };
      if (!uploadResult.storageId) {
        throw new Error("Upload succeeded but no storage ID was returned.");
      }
      await setProfileImageFromUpload({ storageId: uploadResult.storageId });
      Alert.alert("Profile photo updated", "Your new photo is now active.");
    } catch (error) {
      captureException("mobile_profile_image_upload_failed", error);
      Alert.alert(
        "Upload failed",
        error instanceof Error
          ? error.message
          : "Unable to update profile photo.",
      );
    } finally {
      setIsUpdatingProfileImage(false);
    }
  };

  const handleUseProviderProfileImage = async (
    provider: "apple" | "google",
    imageUrl: string,
  ) => {
    try {
      setIsUpdatingProfileImage(true);
      await setProfileImageFromProvider({ source: provider, imageUrl });
    } catch (error) {
      captureException("mobile_profile_provider_image_apply_failed", error, {
        provider,
      });
      Alert.alert(
        "Update failed",
        error instanceof Error
          ? error.message
          : "Unable to apply provider image.",
      );
    } finally {
      setIsUpdatingProfileImage(false);
    }
  };

  const handleResetProfileImage = async () => {
    try {
      setIsUpdatingProfileImage(true);
      await clearManualProfileImage({});
    } catch (error) {
      captureException("mobile_profile_image_reset_failed", error);
      Alert.alert(
        "Reset failed",
        error instanceof Error
          ? error.message
          : "Unable to reset profile image.",
      );
    } finally {
      setIsUpdatingProfileImage(false);
    }
  };

  /* ── Integration data ────────────────── */
  const integrationByProvider = new Map(
    (integrations ?? []).map((integration) => [
      integration.provider,
      integration,
    ]),
  );
  const integrationHealthByProvider = new Map(
    (integrationHealthSnapshots ?? []).map((snapshot) => [
      snapshot.provider,
      snapshot,
    ]),
  );
  const syncRunByProvider = new Map(
    (syncRuns ?? []).map((syncRun) => [syncRun.provider, syncRun]),
  );
  const providerList = [
    ...new Set([
      ...(supportedProviders ?? []),
      ...(integrations ?? []).map((integration) => integration.provider),
      ...Object.keys(INTEGRATION_PROVIDER_META),
    ]),
  ];
  const backgroundLocationStatusLabel = backgroundLocationTrackingEnabled
    ? backgroundLocationRuntimeStatus?.fullyEnabled
      ? "enabled"
      : "Not fully enabled"
    : "disabled";
  const callActivityModuleStatusLabel =
    callActivityDiagnostics?.moduleStatus === "not_supported"
      ? "not supported"
      : (callActivityDiagnostics?.moduleStatus ?? "checking");
  const callActivityPermissionStatusLabel =
    callActivityDiagnostics?.permissionStatus === "not_supported"
      ? "not supported"
      : (callActivityDiagnostics?.permissionStatus ?? "checking");
  const outboxLastSyncStatusColor =
    offlineOutboxSnapshot.lastSyncResult?.status === "error"
      ? c.error
      : offlineOutboxSnapshot.lastSyncResult?.status === "partial"
        ? c.warning
        : c.success;

  /* ── About links ─────────────────────── */
  const aboutLinks: AboutLink[] = [
    {
      title: "Privacy Policy",
      icon: "shield-checkmark-outline",
      path: "/privacy",
    },
    {
      title: "Terms of Service",
      icon: "document-text-outline",
      path: "/terms",
    },
  ];
  const activeSectionMeta =
    PROFILE_SECTIONS.find((section) => section.key === activeSection) ??
    PROFILE_SECTIONS[0];
  const sessionTimeoutLabel =
    sessionTimeoutOptions.find((option) => option.valueMs === sessionTimeoutMs)
      ?.label ?? "5 minutes";
  const quietHoursRangeLabel = `${format24hTo12h(quietHoursStart)} — ${format24hTo12h(quietHoursEnd)}`;
  const preferencesSnapshot: PreferencesSnapshot | undefined = preferences
    ? {
        reminderType: preferences.reminderType,
        formattedTime: preferences.formattedTime,
        focusAreas: preferences.focusAreas,
        theme: preferences.theme,
        defaultMemoryMood: preferences.defaultMemoryMood,
        locationPermissionStatus: preferences.locationPermissionStatus,
        locationLastUpdatedAt: preferences.locationLastUpdatedAt,
        locationLastArea: preferences.locationLastArea,
      }
    : undefined;
  const lastOutboxSyncResult: OutboxLastSyncResult =
    offlineOutboxSnapshot.lastSyncResult
      ? {
          status: offlineOutboxSnapshot.lastSyncResult.status,
          updatedAt: offlineOutboxSnapshot.lastSyncResult.updatedAt,
          message: offlineOutboxSnapshot.lastSyncResult.message,
        }
      : null;
  const isLoading =
    isAuthLoading ||
    (isAuthenticated &&
      (integrations === undefined ||
        preferences === undefined ||
        supportedProviders === undefined ||
        syncRuns === undefined ||
        locationTrackingRuntimeConfig === undefined));

  return {
    postIntegrationRedirect,
    isLoading,
    styles,
    c,
    router,
    activeSection,
    setActiveSection,
    userName,
    userEmail,
    profileImageUrl,
    providerImageOptions,
    isUpdatingProfileImage,
    handleUploadProfileImage,
    handleUseProviderProfileImage,
    handleResetProfileImage,
    preferences,
    darkMode,
    handleDarkModeToggle,
    defaultMemoryMood,
    handleDefaultMemoryMoodChange,
    offlineOutboxSnapshot,
    reminderRuntime,
    locationTrackingEnabled,
    backgroundLocationStatusLabel,
    showAdvancedStatus,
    setShowAdvancedStatus,
    preferencesSnapshot,
    fitnessTrackingEnabled,
    calendarContextEnabled,
    callLogsTrackingEnabled,
    moodAssistanceEnabled,
    quietHoursRangeLabel,
    lastOutboxSyncResult,
    outboxLastSyncStatusColor,
    backgroundLocationRuntimeStatus,
    biometricEnabled,
    isAppLockReady,
    biometricAvailable,
    biometricDisplayName,
    promptOnAppOpen,
    sessionTimeoutLabel,
    hasAppPassword,
    locationTrackingRuntimeConfig,
    backgroundLocationTrackingEnabled,
    callActivityCollectionSupported,
    callActivityModuleStatusLabel,
    callActivityPermissionStatusLabel,
    callActivityDiagnostics,
    aboutLinks,
    handleLocationTrackingToggle,
    handleBackgroundLocationTrackingToggle,
    handleFitnessTrackingToggle,
    handleCalendarContextToggle,
    handleCallSummaryToggle,
    handleMoodAssistanceToggle,
    handleBiometricToggle,
    handlePromptOnAppOpenToggle,
    handleSelectSessionTimeout,
    handleManageAppPassword,
    handleOpenAboutLink,
    allNotifications,
    weeklyInsights,
    dailySummary,
    quietHours,
    quietHoursStart,
    quietHoursEnd,
    isUpdatingReminderPreference,
    handleAllNotificationsToggle,
    updateReminderType,
    handleQuietHoursToggle,
    openQuietHoursPicker,
    supportedProviders,
    autoSyncIntegrations,
    handleAutoSyncIntegrationsToggle,
    integrationFeedback,
    providerList,
    integrationByProvider,
    integrationHealthByProvider,
    syncRunByProvider,
    providerPendingAction,
    handleShowAppleHealthSetup,
    handleConnectIntegration,
    handleDisconnectIntegration,
    handleSyncIntegration,
    handleExportData,
    handleSignOut,
    handleDeleteAccount,
    isRequestingAccountDeletion,
    isFinalizingAccountDeletion,
    isAccountDeletionInProgress,
    canRetryAccountDeletion,
    deletionState,
    deletionStateLabel,
    deletionStageLabel,
    deletionProgressPercent,
    accountDeletionStatus,
    accountDeletionStatusMessage,
    showAppPasswordModal,
    closeAppPasswordModal,
    handleSaveAppPassword,
    isSavingAppPassword,
    appPasswordValue,
    setAppPasswordValue,
    appPasswordConfirmValue,
    setAppPasswordConfirmValue,
    appPasswordError,
    showQuietHoursPicker,
    setShowQuietHoursPicker,
    quietHoursPickerValue,
    handleQuietHoursPickerChange,
    handleQuietHoursPickerDone,
    activeSectionMeta,
  };
}

export type ProfileScreenLoadedProps = Omit<
  ReturnType<typeof useProfileScreen>,
  "postIntegrationRedirect" | "isLoading"
>;
