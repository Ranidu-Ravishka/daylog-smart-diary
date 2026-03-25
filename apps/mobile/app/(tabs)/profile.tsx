import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Modal,
  Platform,
  TouchableWithoutFeedback,
  Linking,
} from "react-native";
import * as Location from "expo-location";
import * as WebBrowser from "expo-web-browser";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useUser, useAuth } from "@clerk/clerk-expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAction, useMutation, useQuery, useConvexAuth } from "convex/react";
import { api } from "@repo/backend/convex";
import {
  INTEGRATION_PROVIDER_META,
  MEMORY_MOOD_OPTIONS,
  SETTINGS_DEFAULTS,
} from "@repo/ui/lib/constants";
import type { GenericId } from "convex/values";
import {
  ensureReminderPermissions,
  getReminderRuntimeState,
  syncReminderNotifications,
  type ReminderRuntimeState,
} from "@/lib/reminder-notifications";
import { collectAppleHealthDailyDataForDay } from "../../lib/apple-health-sync";
import { collectAndroidScreenTimeDailyDataForDay } from "../../lib/android-screen-time-sync";
import { collectIosScreenTimeDailyDataForDay } from "../../lib/ios-screen-time-sync";
import {
  Colors,
  Spacing,
  Typography,
  Radius,
  Shadows,
} from "@/constants/theme";
import { AppCard } from "@/components/ui/app-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton-loader";

const c = Colors.light;

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
type IntegrationDoc = {
  _id: GenericId<"integrations">;
  provider: string;
  status: "connected" | "disconnected" | "error";
  lastSyncAt?: number;
  lastError?: string;
};

type IntegrationSyncRunDoc = {
  provider: string;
  dayKey: string;
  status: "in_progress" | "success" | "error";
  updatedAt: number;
  lastError?: string;
};

function getTodayDayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isOAuthProvider(provider: string): boolean {
  return (
    provider === "google_calendar" ||
    provider === "google_fit" ||
    provider === "spotify"
  );
}

function format24hTo12h(time: string): string {
  const [rawHour, rawMinute] = time.split(":").map(Number);
  if (!Number.isFinite(rawHour) || !Number.isFinite(rawMinute)) return time;

  const ampm = rawHour >= 12 ? "PM" : "AM";
  const hour12 = rawHour % 12 || 12;
  return `${hour12}:${String(rawMinute).padStart(2, "0")} ${ampm}`;
}

function parseTimeToDate(time: string): Date {
  const [hourRaw, minuteRaw] = time.split(":").map(Number);
  const date = new Date();

  if (
    Number.isFinite(hourRaw) &&
    Number.isFinite(minuteRaw) &&
    hourRaw >= 0 &&
    hourRaw <= 23 &&
    minuteRaw >= 0 &&
    minuteRaw <= 59
  ) {
    date.setHours(hourRaw, minuteRaw, 0, 0);
    return date;
  }

  date.setHours(22, 0, 0, 0);
  return date;
}

function formatDateTo24h(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function snapToQuarterHour(value: Date): Date {
  const snapped = new Date(value);
  const minutes = snapped.getMinutes();
  const snappedMinutes = Math.round(minutes / 15) * 15;

  if (snappedMinutes === 60) {
    snapped.setHours(snapped.getHours() + 1, 0, 0, 0);
    return snapped;
  }

  snapped.setMinutes(snappedMinutes, 0, 0);
  return snapped;
}

/* ── Skeleton ──────────────────────────────────────────── */
function ProfileSkeleton() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.scroll}>
        <Skeleton
          width={100}
          height={24}
          style={{ marginLeft: Spacing.xl, marginBottom: Spacing.xl }}
        />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={1} />
        <SkeletonCard lines={4} />
      </View>
    </SafeAreaView>
  );
}

/* ── Screen ────────────────────────────────────────────── */
const SettingsScreen = () => {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{
    integrationProvider?: string;
    integrationStatus?: string;
    integrationMessage?: string;
  }>();
  const { user } = useUser();
  const { signOut } = useAuth();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const todayDayKey = getTodayDayKey();

  const supportedProviders = useQuery(
    api.integrations.listSupportedProviders,
    isAuthenticated ? {} : "skip",
  );
  const integrations = useQuery(
    api.integrations.listMyIntegrations,
    isAuthenticated ? {} : "skip",
  ) as IntegrationDoc[] | undefined;
  const syncRuns = useQuery(
    api.integrations.listMyIntegrationSyncRunsForDay,
    isAuthenticated ? { dayKey: todayDayKey } : "skip",
  ) as IntegrationSyncRunDoc[] | undefined;
  const preferences = useQuery(
    api.userPreferences.getMyUserPreferences,
    isAuthenticated ? {} : "skip",
  );
  const connectIntegration = useMutation(api.integrations.connectIntegration);
  const disconnectIntegration = useMutation(
    api.integrations.disconnectIntegration,
  );
  const syncUserPreferences = useMutation(
    api.userPreferences.syncMyUserPreferences,
  );
  const syncMyIntegrationForDay = useAction(
    api.integrations.syncMyIntegrationForDay,
  );
  const syncAppleHealthDailyData = useMutation(
    api.integrations.syncAppleHealthDailyData,
  );
  const upsertMyIntegrationDailyData = useMutation(
    api.integrations.upsertMyIntegrationDailyData,
  );
  const updateMyLocationTrackingState = useMutation(
    api.userPreferences.updateMyLocationTrackingState,
  );

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
  const [defaultMemoryMood, setDefaultMemoryMood] = useState<string>(
    SETTINGS_DEFAULTS.defaultMemoryMood,
  );
  const [locationTrackingEnabled, setLocationTrackingEnabled] =
    useState<boolean>(SETTINGS_DEFAULTS.locationTrackingEnabled);
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

  const savePreferencePatch = useCallback(
    async (
      patch: Partial<{
        reminderType: "daily" | "weekly";
        theme: "light" | "dark" | "system";
        notificationsEnabled: boolean;
        dailySummaryEnabled: boolean;
        weeklyInsightsEnabled: boolean;
        quietHoursEnabled: boolean;
        quietHoursStart: string;
        quietHoursEnd: string;
        autoSyncIntegrations: boolean;
        defaultMemoryMood: string;
      }>,
    ) => {
      if (!preferences) {
        Alert.alert("Complete quick setup", "Set your preferences first.", [
          {
            text: "Open Setup",
            onPress: () => router.push("/quick-setup"),
          },
          { text: "Cancel", style: "cancel" },
        ]);
        return false;
      }

      await syncUserPreferences({
        focusAreas: preferences.focusAreas,
        reminderType: patch.reminderType ?? preferences.reminderType,
        dailyTime: preferences.dailyTime,
        weeklyDay: preferences.weeklyDay,
        formattedTime: preferences.formattedTime,
        theme: patch.theme ?? preferences.theme,
        notificationsEnabled:
          patch.notificationsEnabled ?? preferences.notificationsEnabled,
        dailySummaryEnabled:
          patch.dailySummaryEnabled ?? preferences.dailySummaryEnabled,
        weeklyInsightsEnabled:
          patch.weeklyInsightsEnabled ?? preferences.weeklyInsightsEnabled,
        quietHoursEnabled:
          patch.quietHoursEnabled ?? preferences.quietHoursEnabled,
        quietHoursStart: patch.quietHoursStart ?? preferences.quietHoursStart,
        quietHoursEnd: patch.quietHoursEnd ?? preferences.quietHoursEnd,
        autoSyncIntegrations:
          patch.autoSyncIntegrations ?? preferences.autoSyncIntegrations,
        defaultMemoryMood:
          patch.defaultMemoryMood ?? preferences.defaultMemoryMood,
      });

      await syncReminderRuntimeFromPreferences({
        reminderType: patch.reminderType ?? preferences.reminderType,
        dailyTime: preferences.dailyTime,
        weeklyDay: preferences.weeklyDay,
        formattedTime: preferences.formattedTime,
        notificationsEnabled:
          patch.notificationsEnabled ?? preferences.notificationsEnabled,
        dailySummaryEnabled:
          patch.dailySummaryEnabled ?? preferences.dailySummaryEnabled,
        weeklyInsightsEnabled:
          patch.weeklyInsightsEnabled ?? preferences.weeklyInsightsEnabled,
        quietHoursEnabled:
          patch.quietHoursEnabled ?? preferences.quietHoursEnabled,
        quietHoursStart: patch.quietHoursStart ?? preferences.quietHoursStart,
        quietHoursEnd: patch.quietHoursEnd ?? preferences.quietHoursEnd,
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
      setDarkMode(false);
      setAllNotifications(true);
      setDailySummary(false);
      setWeeklyInsights(false);
      setQuietHours(false);
      setQuietHoursStart(SETTINGS_DEFAULTS.quietHoursStart);
      setQuietHoursEnd(SETTINGS_DEFAULTS.quietHoursEnd);
      setAutoSyncIntegrations(SETTINGS_DEFAULTS.autoSyncIntegrations);
      setDefaultMemoryMood(SETTINGS_DEFAULTS.defaultMemoryMood);
      setLocationTrackingEnabled(SETTINGS_DEFAULTS.locationTrackingEnabled);
      return;
    }

    setDarkMode(preferences.theme === "dark");
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
  }, [preferences]);

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

    router.replace("/(tabs)/profile");
  }, [
    router,
    searchParams.integrationMessage,
    searchParams.integrationProvider,
    searchParams.integrationStatus,
  ]);

  useEffect(() => {
    void (async () => {
      const runtime = await getReminderRuntimeState();
      setReminderRuntime(runtime);
    })();
  }, []);

  const updateReminderType = useCallback(
    async (nextReminderType: "daily" | "weekly") => {
      if (!preferences) {
        Alert.alert(
          "Complete quick setup",
          "Set your reminder preferences first.",
          [
            {
              text: "Open Setup",
              onPress: () => router.push("/quick-setup"),
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

    try {
      await savePreferencePatch({ theme: next ? "dark" : "light" });
    } catch {
      setDarkMode(previous);
      Alert.alert("Update failed", "Theme preference could not be saved.");
    }
  }, [darkMode, savePreferencePatch]);

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
          onPress: () => router.push("/quick-setup"),
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

    try {
      await updateMyLocationTrackingState({
        locationTrackingEnabled: next,
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
    locationTrackingEnabled,
    preferences,
    router,
    updateMyLocationTrackingState,
  ]);

  /* ── Callbacks ────────────────────────── */
  const handleSignOut = useCallback(() => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => signOut() },
    ]);
  }, [signOut]);

  const handleExportData = useCallback(() => {
    const webAppUrl =
      process.env.EXPO_PUBLIC_WEB_APP_URL ?? "http://localhost:3000";
    const exportUrl = `${webAppUrl.replace(/\/$/, "")}/dashboard/export`;

    void WebBrowser.openBrowserAsync(exportUrl).catch(() => {
      Alert.alert(
        "Export unavailable",
        "Could not open the export page right now. Please try again.",
      );
    });
  }, []);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      "Delete Account",
      "This action is permanent and cannot be undone. All your data will be deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                if (!user) {
                  Alert.alert(
                    "Delete failed",
                    "No signed-in user found. Please sign in again.",
                  );
                  return;
                }

                await user.delete();
                await signOut();
              } catch {
                Alert.alert(
                  "Delete failed",
                  "We could not delete your account right now. Please try again.",
                );
              }
            })();
          },
        },
      ],
    );
  }, [signOut, user]);

  const handleOpenAboutLink = useCallback((path: string) => {
    const webAppUrl =
      process.env.EXPO_PUBLIC_WEB_APP_URL ?? "http://localhost:3000";
    const targetUrl = `${webAppUrl.replace(/\/$/, "")}${path}`;

    void WebBrowser.openBrowserAsync(targetUrl).catch(() => {
      Alert.alert("Link unavailable", "Could not open this page right now.");
    });
  }, []);

  const setProviderAction = useCallback(
    (
      provider: string,
      action: "connect" | "disconnect" | "sync" | undefined,
    ) => {
      setProviderPendingAction((prev) => ({ ...prev, [provider]: action }));
    },
    [],
  );

  const handleConnectIntegration = useCallback(
    async (provider: string) => {
      setProviderAction(provider, "connect");
      setIntegrationFeedback(null);

      try {
        if (isOAuthProvider(provider)) {
          const webAppUrl =
            process.env.EXPO_PUBLIC_WEB_APP_URL ?? "http://localhost:3000";
          const startUrl = `${webAppUrl}/api/integrations/oauth/${provider}/start?returnTo=${encodeURIComponent("/integrations/oauth/complete?mode=mobile")}`;

          await WebBrowser.openBrowserAsync(startUrl);

          const label =
            INTEGRATION_PROVIDER_META[
              provider as keyof typeof INTEGRATION_PROVIDER_META
            ]?.label ?? provider;

          setIntegrationFeedback({
            type: "success",
            message: `${label} OAuth flow opened in browser. Finish sign-in there, then return to app.`,
          });
          return;
        }

        await connectIntegration({ provider, scopes: [] });
        const label =
          INTEGRATION_PROVIDER_META[
            provider as keyof typeof INTEGRATION_PROVIDER_META
          ]?.label ?? provider;

        setIntegrationFeedback({
          type: "success",
          message: `${label} connected successfully.`,
        });
      } catch (error) {
        setIntegrationFeedback({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : `Failed to connect ${provider}`,
        });
      } finally {
        setProviderAction(provider, undefined);
      }
    },
    [connectIntegration, setProviderAction],
  );

  const handleDisconnectIntegration = useCallback(
    async (provider: string, integrationId: GenericId<"integrations">) => {
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
    [disconnectIntegration, setProviderAction],
  );

  const handleSyncIntegration = useCallback(
    async (provider: string) => {
      setProviderAction(provider, "sync");
      setIntegrationFeedback(null);

      try {
        if (provider === "apple_health") {
          const appleHealthData =
            await collectAppleHealthDailyDataForDay(todayDayKey);

          await syncAppleHealthDailyData({
            dayKey: todayDayKey,
            metrics: appleHealthData.metrics,
            summary: appleHealthData.summary,
            signals: appleHealthData.signals,
          });

          setIntegrationFeedback({
            type: "success",
            message: "Apple Health data synced from this device.",
          });

          return;
        }

        const result = await syncMyIntegrationForDay({
          provider,
          dayKey: todayDayKey,
        });

        let screenTimeMessage = "";
        if (provider === "google_fit" && Platform.OS === "android") {
          try {
            const screenTimeData =
              await collectAndroidScreenTimeDailyDataForDay(todayDayKey);

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
          setIntegrationFeedback({
            type: "success",
            message:
              result.skippedReason === "already_synced"
                ? "Already synced for today."
                : "Sync is already in progress.",
          });
        } else {
          setIntegrationFeedback({
            type: "success",
            message: `Sync completed successfully.${screenTimeMessage}`,
          });
        }
      } catch (error) {
        setIntegrationFeedback({
          type: "error",
          message: error instanceof Error ? error.message : "Sync failed.",
        });
      } finally {
        setProviderAction(provider, undefined);
      }
    },
    [
      setProviderAction,
      upsertMyIntegrationDailyData,
      syncAppleHealthDailyData,
      syncMyIntegrationForDay,
      todayDayKey,
    ],
  );

  const handleShowAppleHealthSetup = useCallback(() => {
    if (Platform.OS !== "ios") {
      Alert.alert(
        "Apple Health is iOS only",
        "Apple Health sync is available only on iOS devices.",
      );
      return;
    }

    Alert.alert(
      "Apple Health setup",
      "Use an iOS development build (not Expo Go), install react-native-health, enable HealthKit entitlements, then tap Sync now.",
    );
  }, []);

  const isLoading =
    isAuthLoading ||
    (isAuthenticated &&
      (integrations === undefined ||
        preferences === undefined ||
        supportedProviders === undefined ||
        syncRuns === undefined));

  if (isLoading) return <ProfileSkeleton />;

  const userName = user?.fullName ?? user?.firstName ?? "User";
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";

  /* ── Integration data ────────────────── */
  const integrationIcons: Record<string, IoniconName> = {
    apple_health: "heart",
    google_calendar: "calendar",
    spotify: "musical-notes",
    google_fit: "fitness",
  };
  const integrationNames: Record<string, string> = {
    apple_health: "Apple Health",
    google_calendar: "Google Calendar",
    spotify: "Spotify",
    google_fit: "Google Fit",
  };

  const integrationByProvider = new Map(
    (integrations ?? []).map((integration) => [
      integration.provider,
      integration,
    ]),
  );
  const syncRunByProvider = new Map(
    (syncRuns ?? []).map((syncRun) => [syncRun.provider, syncRun]),
  );
  const providerList =
    supportedProviders && supportedProviders.length > 0
      ? supportedProviders
      : Object.keys(INTEGRATION_PROVIDER_META);

  /* ── Toggle row helper ───────────────── */
  const ToggleRow = ({
    label,
    subtitle,
    value,
    onToggle,
    disabled,
    testID,
  }: {
    label: string;
    subtitle?: string;
    value: boolean;
    onToggle: () => void;
    disabled?: boolean;
    testID?: string;
  }) => (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, disabled && { opacity: 0.45 }]}>
          {label}
        </Text>
        {subtitle && <Text style={styles.toggleSub}>{subtitle}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        testID={testID}
        trackColor={{ false: c.border, true: c.tint }}
        thumbColor="#FFF"
      />
    </View>
  );

  /* ── About links ─────────────────────── */
  const aboutLinks: { title: string; icon: IoniconName; path: string }[] = [
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

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────── */}
        <View style={styles.headerRow}>
          <Text style={styles.pageTitle}>Settings</Text>
        </View>

        {/* ── Profile Card ────────────────────────── */}
        <View style={styles.pad}>
          <AppCard>
            <View style={styles.profileRow}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={24} color={c.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{userName}</Text>
                <Text style={styles.profileEmail}>{userEmail}</Text>
              </View>
            </View>
          </AppCard>
        </View>

        {/* ── Quick Actions ───────────────────────── */}
        <View style={[styles.pad, styles.quickRow]}>
          <TouchableOpacity style={styles.quickBtn} onPress={handleExportData}>
            <Ionicons name="download-outline" size={18} color={c.text} />
            <Text style={styles.quickText}>Export Data</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickBtn} onPress={handleSignOut}>
            <Ionicons name="log-out-outline" size={18} color={c.error} />
            <Text style={[styles.quickText, { color: c.error }]}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* ── App Preferences ─────────────────────── */}
        <View style={styles.pad}>
          <SectionHeader title="App Preferences" />
          <AppCard>
            <ToggleRow
              label="Dark Mode"
              value={darkMode}
              onToggle={() => {
                void handleDarkModeToggle();
              }}
              disabled={preferences === null}
            />
          </AppCard>
        </View>

        <View style={styles.pad}>
          <SectionHeader title="Memory Defaults" />
          <AppCard>
            <Text style={styles.toggleSub}>Default mood for new memories</Text>
            <View style={styles.moodChipsRow}>
              {MEMORY_MOOD_OPTIONS.map((mood) => {
                const selected = defaultMemoryMood === mood;
                return (
                  <TouchableOpacity
                    key={mood}
                    style={[
                      styles.moodChip,
                      selected && styles.moodChipSelected,
                    ]}
                    onPress={() => {
                      void handleDefaultMemoryMoodChange(mood);
                    }}
                    disabled={preferences === null}
                  >
                    <Text
                      style={[
                        styles.moodChipLabel,
                        selected && styles.moodChipLabelSelected,
                      ]}
                    >
                      {mood}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </AppCard>
        </View>

        {/* ── Integrations ────────────────────────── */}
        <View style={styles.pad}>
          <SectionHeader title="Integrations" />
          <AppCard>
            <Text style={styles.integrationSubMuted}>
              Connected providers can contribute daily context to AI summaries
              after you sync them.
            </Text>

            {integrationFeedback ? (
              <View
                style={[
                  styles.integrationFeedback,
                  integrationFeedback.type === "success"
                    ? styles.integrationFeedbackSuccess
                    : styles.integrationFeedbackError,
                ]}
              >
                <Text
                  style={[
                    styles.integrationFeedbackText,
                    integrationFeedback.type === "success"
                      ? { color: c.success }
                      : { color: c.error },
                  ]}
                >
                  {integrationFeedback.message}
                </Text>
              </View>
            ) : null}

            {providerList.map((provider, index) => {
              const integration = integrationByProvider.get(provider);
              const syncRun = syncRunByProvider.get(provider);
              const status = integration?.status ?? "disconnected";
              const pending = providerPendingAction[provider];
              const isSyncing =
                pending === "sync" || syncRun?.status === "in_progress";

              const label =
                INTEGRATION_PROVIDER_META[
                  provider as keyof typeof INTEGRATION_PROVIDER_META
                ]?.label ??
                integrationNames[provider] ??
                provider;
              const description =
                INTEGRATION_PROVIDER_META[
                  provider as keyof typeof INTEGRATION_PROVIDER_META
                ]?.description ?? "";

              return (
                <View key={provider}>
                  {index > 0 && <View style={styles.divider} />}
                  <View style={styles.integrationRow}>
                    <Ionicons
                      name={integrationIcons[provider] ?? "link"}
                      size={20}
                      color={c.icon}
                    />
                    <View style={{ flex: 1, marginLeft: Spacing.md }}>
                      <View style={styles.integrationHeadingRow}>
                        <Text style={styles.integrationTitle}>{label}</Text>
                        <View style={styles.integrationHeadingBadges}>
                          {provider === "apple_health" && (
                            <View
                              style={[
                                styles.integrationStatusBadge,
                                styles.integrationStatusSetupRequired,
                              ]}
                            >
                              <Text style={styles.integrationStatusText}>
                                {Platform.OS === "ios"
                                  ? "setup required"
                                  : "iOS only"}
                              </Text>
                            </View>
                          )}

                          <View
                            style={[
                              styles.integrationStatusBadge,
                              status === "connected"
                                ? styles.integrationStatusConnected
                                : status === "error"
                                  ? styles.integrationStatusError
                                  : styles.integrationStatusDisconnected,
                            ]}
                          >
                            <Text style={styles.integrationStatusText}>
                              {status}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {!!description && (
                        <Text style={styles.integrationSub}>{description}</Text>
                      )}

                      {provider === "apple_health" && (
                        <View style={styles.appleHealthHintCard}>
                          <Text style={styles.appleHealthHintText}>
                            {Platform.OS === "ios"
                              ? "Requires iOS native build + HealthKit setup for real device data."
                              : "Apple Health sync is only available on iOS devices."}
                          </Text>
                          <TouchableOpacity
                            onPress={handleShowAppleHealthSetup}
                            activeOpacity={0.75}
                          >
                            <Text style={styles.appleHealthHintAction}>
                              How to enable
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      <Text style={styles.integrationSubMuted}>
                        Last sync:{" "}
                        {integration?.lastSyncAt
                          ? new Date(integration.lastSyncAt).toLocaleString()
                          : "Never"}
                      </Text>

                      {syncRun?.status ? (
                        <Text style={styles.integrationSubMuted}>
                          Today: {syncRun.status}
                          {syncRun.lastError ? ` — ${syncRun.lastError}` : ""}
                        </Text>
                      ) : null}

                      {integration?.lastError ? (
                        <Text style={styles.integrationErrorText}>
                          Error: {integration.lastError}
                        </Text>
                      ) : null}

                      <View style={styles.integrationActionsRow}>
                        {status !== "connected" ? (
                          <TouchableOpacity
                            style={styles.integrationPrimaryBtn}
                            onPress={() => {
                              void handleConnectIntegration(provider);
                            }}
                            disabled={pending !== undefined}
                            activeOpacity={0.75}
                          >
                            <Text style={styles.integrationPrimaryBtnText}>
                              {pending === "connect"
                                ? "Connecting..."
                                : "Connect"}
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <>
                            <TouchableOpacity
                              style={styles.integrationSecondaryBtn}
                              onPress={() => {
                                if (!integration) return;
                                void handleDisconnectIntegration(
                                  provider,
                                  integration._id,
                                );
                              }}
                              disabled={pending !== undefined}
                              activeOpacity={0.75}
                            >
                              <Text style={styles.integrationSecondaryBtnText}>
                                {pending === "disconnect"
                                  ? "Disconnecting..."
                                  : "Disconnect"}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={styles.integrationPrimaryBtn}
                              onPress={() => {
                                void handleSyncIntegration(provider);
                              }}
                              disabled={pending !== undefined || isSyncing}
                              activeOpacity={0.75}
                            >
                              <Text style={styles.integrationPrimaryBtnText}>
                                {isSyncing ? "Syncing..." : "Sync now"}
                              </Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </AppCard>
        </View>

        {/* ── Notifications ───────────────────────── */}
        <View style={styles.pad}>
          <SectionHeader title="Notifications" />
          <AppCard>
            <ToggleRow
              label="All Notifications"
              subtitle="Master switch"
              value={allNotifications}
              onToggle={() => {
                void handleAllNotificationsToggle();
              }}
              disabled={preferences === null}
            />
            <View style={styles.divider} />
            <ToggleRow
              label="Weekly Insights"
              value={weeklyInsights}
              onToggle={() => {
                void updateReminderType("weekly");
              }}
              disabled={
                !allNotifications ||
                isUpdatingReminderPreference ||
                preferences === null
              }
            />
            <View style={styles.divider} />
            <ToggleRow
              label="Daily Summary"
              value={dailySummary}
              onToggle={() => {
                void updateReminderType("daily");
              }}
              disabled={
                !allNotifications ||
                isUpdatingReminderPreference ||
                preferences === null
              }
            />
            <View style={styles.divider} />
            <ToggleRow
              label="Quiet Hours"
              subtitle={`${format24hTo12h(quietHoursStart)} — ${format24hTo12h(quietHoursEnd)}`}
              value={quietHours}
              onToggle={() => {
                void handleQuietHoursToggle();
              }}
              disabled={!allNotifications || preferences === null}
            />
            <View style={styles.divider} />
            <View style={styles.quietHoursConfigRow}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.toggleLabel,
                    (!quietHours ||
                      !allNotifications ||
                      preferences === null) && {
                      opacity: 0.45,
                    },
                  ]}
                >
                  Quiet hours start
                </Text>
                <Text style={styles.toggleSub}>
                  Tap to choose time (15-min steps)
                </Text>
              </View>
              <TouchableOpacity
                style={styles.quietHoursChip}
                onPress={() => {
                  openQuietHoursPicker("start");
                }}
                disabled={
                  !quietHours || !allNotifications || preferences === null
                }
              >
                <Text style={styles.quietHoursChipText}>
                  {format24hTo12h(quietHoursStart)}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.divider} />
            <View style={styles.quietHoursConfigRow}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.toggleLabel,
                    (!quietHours ||
                      !allNotifications ||
                      preferences === null) && {
                      opacity: 0.45,
                    },
                  ]}
                >
                  Quiet hours end
                </Text>
                <Text style={styles.toggleSub}>
                  Tap to choose time (15-min steps)
                </Text>
              </View>
              <TouchableOpacity
                style={styles.quietHoursChip}
                onPress={() => {
                  openQuietHoursPicker("end");
                }}
                disabled={
                  !quietHours || !allNotifications || preferences === null
                }
              >
                <Text style={styles.quietHoursChipText}>
                  {format24hTo12h(quietHoursEnd)}
                </Text>
              </TouchableOpacity>
            </View>
          </AppCard>
        </View>

        <View style={styles.pad}>
          <SectionHeader title="Integration Preferences" />
          <AppCard>
            <ToggleRow
              label="Auto-sync Integrations"
              subtitle="Automatically sync connected providers"
              value={autoSyncIntegrations}
              onToggle={() => {
                void handleAutoSyncIntegrationsToggle();
              }}
              disabled={preferences === null}
            />
            <View style={styles.divider} />
            <ToggleRow
              label="Foreground Location Tracking"
              subtitle={
                preferences?.locationPermissionStatus === "denied"
                  ? "Permission denied. Enable location in system settings and turn this back on."
                  : "Collect coarse location only while the app is open."
              }
              value={locationTrackingEnabled}
              onToggle={() => {
                void handleLocationTrackingToggle();
              }}
              disabled={preferences === null}
              testID="location-tracking-switch"
            />
            <Text style={styles.integrationSubMuted}>
              Permission: {preferences?.locationPermissionStatus ?? "unknown"}
            </Text>
            <Text style={styles.integrationSubMuted}>
              Last update:{" "}
              {preferences?.locationLastUpdatedAt
                ? new Date(preferences.locationLastUpdatedAt).toLocaleString()
                : "Never"}
            </Text>
            <Text style={styles.integrationSubMuted}>
              Last area: {preferences?.locationLastArea ?? "Not available"}
            </Text>
          </AppCard>
        </View>

        {/* ── Sync Status ─────────────────────────── */}
        {preferences && (
          <View style={styles.pad}>
            <SectionHeader title="Sync Status" />
            <AppCard>
              <Text style={styles.syncText}>
                Reminder: {preferences.reminderType} at{" "}
                {preferences.formattedTime}
              </Text>
              <Text style={[styles.syncText, { marginTop: 4 }]}>
                Focus areas: {preferences.focusAreas?.length ?? 0} selected
              </Text>
              <Text style={[styles.syncText, { marginTop: 4 }]}>
                Theme: {preferences.theme ?? "system"}
              </Text>
              <Text style={[styles.syncText, { marginTop: 4 }]}>
                Default memory mood:{" "}
                {preferences.defaultMemoryMood ??
                  SETTINGS_DEFAULTS.defaultMemoryMood}
              </Text>
              <Text style={[styles.syncText, { marginTop: 4 }]}>
                Foreground location:{" "}
                {locationTrackingEnabled ? "enabled" : "disabled"}
              </Text>
              <Text style={[styles.syncText, { marginTop: 4 }]}>
                Location permission:{" "}
                {preferences.locationPermissionStatus ?? "unknown"}
              </Text>
              <Text style={[styles.syncText, { marginTop: 4 }]}>
                Location last update:{" "}
                {preferences.locationLastUpdatedAt
                  ? new Date(preferences.locationLastUpdatedAt).toLocaleString()
                  : "Never"}
              </Text>
              <Text style={[styles.syncText, { marginTop: 4 }]}>
                Notification permission:{" "}
                {reminderRuntime?.permissionStatus ?? "unknown"}
              </Text>
              <Text style={[styles.syncText, { marginTop: 4 }]}>
                Reminder delivery:{" "}
                {reminderRuntime?.deliveryEnabled ? "active" : "paused"}
              </Text>
              <Text style={[styles.syncText, { marginTop: 4 }]}>
                Quiet hours: {format24hTo12h(quietHoursStart)} —{" "}
                {format24hTo12h(quietHoursEnd)}
              </Text>
              <Text style={[styles.syncText, { marginTop: 4 }]}>
                Scheduled reminders: {reminderRuntime?.scheduledCount ?? 0}
              </Text>
              {reminderRuntime?.error ? (
                <Text
                  style={[styles.syncText, { marginTop: 4, color: c.error }]}
                >
                  Reminder error: {reminderRuntime.error}
                </Text>
              ) : null}
            </AppCard>
          </View>
        )}

        {preferences === null && (
          <View style={styles.pad}>
            <SectionHeader title="Sync Status" />
            <AppCard>
              <Text style={styles.syncText}>
                Preferences not set yet. Complete Quick Setup to sync reminders.
              </Text>
              <TouchableOpacity
                onPress={() => router.push("/quick-setup")}
                style={[styles.quickBtn, { marginTop: Spacing.md }]}
              >
                <Ionicons name="settings-outline" size={16} color={c.tint} />
                <Text style={styles.quickText}>Open Quick Setup</Text>
              </TouchableOpacity>
            </AppCard>
          </View>
        )}

        {/* ── About & Help ────────────────────────── */}
        <View style={styles.pad}>
          <SectionHeader title="About & Help" />
          <AppCard>
            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>Version</Text>
              <Text style={styles.versionValue}>DayLog v2.1.4</Text>
            </View>
            {aboutLinks.map((item, i) => (
              <View key={i}>
                <View style={styles.divider} />
                <TouchableOpacity
                  style={styles.aboutRow}
                  activeOpacity={0.6}
                  onPress={() => handleOpenAboutLink(item.path)}
                >
                  <Ionicons name={item.icon} size={18} color={c.icon} />
                  <Text style={styles.aboutText}>{item.title}</Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={c.textTertiary}
                  />
                </TouchableOpacity>
              </View>
            ))}
          </AppCard>
        </View>

        {/* ── Danger Zone ─────────────────────────── */}
        <View style={styles.pad}>
          <TouchableOpacity
            style={styles.dangerBtn}
            onPress={handleDeleteAccount}
          >
            <Ionicons name="trash-outline" size={16} color={c.error} />
            <Text style={styles.dangerText}>Delete Account</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {showQuietHoursPicker && Platform.OS === "ios" && (
        <Modal transparent animationType="slide" visible={showQuietHoursPicker}>
          <TouchableWithoutFeedback
            onPress={() => setShowQuietHoursPicker(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.pickerContainer}>
                <View style={styles.pickerHeader}>
                  <TouchableOpacity
                    onPress={() => setShowQuietHoursPicker(false)}
                  >
                    <Text style={styles.pickerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={styles.pickerTitle}>Select time</Text>
                  <TouchableOpacity onPress={handleQuietHoursPickerDone}>
                    <Text style={styles.pickerDoneText}>Done</Text>
                  </TouchableOpacity>
                </View>

                <DateTimePicker
                  value={quietHoursPickerValue}
                  mode="time"
                  display="spinner"
                  onChange={handleQuietHoursPickerChange}
                />
              </View>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}

      {showQuietHoursPicker && Platform.OS === "android" && (
        <DateTimePicker
          value={quietHoursPickerValue}
          mode="time"
          display="default"
          onChange={handleQuietHoursPickerChange}
        />
      )}
    </SafeAreaView>
  );
};

export default SettingsScreen;

/* ── Styles ──────────────────────────────────────────── */
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: c.background,
  },
  scroll: {
    paddingTop: Spacing.lg,
  },
  headerRow: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing["2xl"],
  },
  pageTitle: {
    ...Typography.title1,
    color: c.text,
  },
  pad: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.xl,
  },

  /* Profile */
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.tintLight,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.lg,
  },
  profileName: {
    ...Typography.bodyMedium,
    color: c.text,
  },
  profileEmail: {
    ...Typography.caption1,
    color: c.textSecondary,
    marginTop: 2,
  },

  /* Quick actions */
  quickRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  quickBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: c.surface,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    ...Shadows.sm,
  },
  quickText: {
    ...Typography.callout,
    color: c.text,
  },

  /* Toggle rows */
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.xs,
  },
  toggleLabel: {
    ...Typography.body,
    color: c.text,
  },
  toggleSub: {
    ...Typography.caption1,
    color: c.textTertiary,
    marginTop: 2,
  },
  quietHoursConfigRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.xs,
    gap: Spacing.md,
  },
  quietHoursChip: {
    borderWidth: 1,
    borderColor: c.divider,
    backgroundColor: c.surfaceSecondary,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  quietHoursChipText: {
    ...Typography.caption1,
    color: c.text,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  pickerContainer: {
    backgroundColor: c.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.lg,
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.divider,
  },
  pickerTitle: {
    ...Typography.bodyMedium,
    color: c.text,
  },
  pickerCancelText: {
    ...Typography.callout,
    color: c.textSecondary,
  },
  pickerDoneText: {
    ...Typography.callout,
    color: c.tint,
    fontWeight: "600",
  },
  moodChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  moodChip: {
    borderWidth: 1,
    borderColor: c.divider,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: c.background,
  },
  moodChipSelected: {
    backgroundColor: c.tintLight,
    borderColor: c.tint,
  },
  moodChipLabel: {
    ...Typography.caption1,
    color: c.textSecondary,
    textTransform: "capitalize",
  },
  moodChipLabelSelected: {
    color: c.tint,
  },

  /* Integration rows */
  integrationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: Spacing.sm,
  },
  integrationHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  integrationHeadingBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  integrationTitle: {
    ...Typography.body,
    color: c.text,
  },
  integrationSub: {
    ...Typography.callout,
    color: c.textSecondary,
    marginTop: 4,
  },
  integrationSubMuted: {
    ...Typography.caption1,
    color: c.textTertiary,
    marginTop: 4,
  },
  integrationErrorText: {
    ...Typography.caption1,
    color: c.error,
    marginTop: 4,
  },
  integrationStatusBadge: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
  },
  integrationStatusConnected: {
    backgroundColor: "#ECFDF3",
    borderColor: "#BBF7D0",
  },
  integrationStatusError: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  integrationStatusDisconnected: {
    backgroundColor: c.surfaceSecondary,
    borderColor: c.divider,
  },
  integrationStatusSetupRequired: {
    backgroundColor: c.tintLight,
    borderColor: c.tint,
  },
  integrationStatusText: {
    ...Typography.caption1,
    color: c.textSecondary,
    textTransform: "capitalize",
  },
  integrationActionsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  integrationPrimaryBtn: {
    backgroundColor: c.tint,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  integrationPrimaryBtnText: {
    ...Typography.caption1,
    color: "#FFFFFF",
    fontWeight: "600",
  },
  integrationSecondaryBtn: {
    borderWidth: 1,
    borderColor: c.divider,
    backgroundColor: c.background,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  integrationSecondaryBtnText: {
    ...Typography.caption1,
    color: c.text,
    fontWeight: "600",
  },
  integrationFeedback: {
    borderRadius: Radius.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  integrationFeedbackSuccess: {
    borderColor: "#BBF7D0",
    backgroundColor: "#F0FDF4",
  },
  integrationFeedbackError: {
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
  },
  integrationFeedbackText: {
    ...Typography.caption1,
  },
  appleHealthHintCard: {
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: c.divider,
    borderRadius: Radius.sm,
    backgroundColor: c.surfaceSecondary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    gap: 6,
  },
  appleHealthHintText: {
    ...Typography.caption1,
    color: c.textSecondary,
  },
  appleHealthHintAction: {
    ...Typography.caption1,
    color: c.tint,
    fontWeight: "600",
  },
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  emptyText: {
    ...Typography.callout,
    color: c.textTertiary,
  },

  /* Divider */
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.divider,
    marginVertical: Spacing.sm,
  },

  /* Sync */
  syncText: {
    ...Typography.callout,
    color: c.textSecondary,
  },

  /* Version / About */
  versionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
  versionLabel: {
    ...Typography.caption1,
    color: c.textTertiary,
  },
  versionValue: {
    ...Typography.caption1,
    color: c.text,
  },
  aboutRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  aboutText: {
    ...Typography.body,
    color: c.text,
    flex: 1,
    marginLeft: Spacing.md,
  },

  /* Danger */
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  dangerText: {
    ...Typography.callout,
    color: c.error,
  },
});
