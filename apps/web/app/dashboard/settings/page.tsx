"use client";

import { useQuery, useMutation, useConvexAuth, useAction } from "convex/react";
import { api } from "@repo/backend/convex";
import {
  normalizeUserSettings,
  normalizeUserSettingsPatch,
  type UserSettingsDto,
} from "@repo/user-settings/lib/user-settings";
import {
  FOCUS_AREAS,
  INTEGRATION_COMING_SOON_BADGE_LABEL,
  INTEGRATION_COMING_SOON_HELPER_TEXT,
  INTEGRATION_PROVIDER_META,
  INTEGRATION_PROVIDER_STATUS,
  MEMORY_MOOD_OPTIONS,
  SETTINGS_DEFAULTS,
} from "@repo/ui/lib/constants";
import {
  getDayKeyForTimestamp,
  getResolvedTimeZone,
} from "@repo/ui/lib/day-window";
import type { GenericId } from "convex/values";
import { useAuth, useUser } from "@clerk/nextjs";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { captureException, logInfo } from "@/lib/observability";
import { useWebThemePreference } from "@/lib/theme-preference";
import { cn } from "@/lib/utils";
import { toastError, toastInfo, toastSuccess } from "@/lib/toast";

function isValid24HourTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function toTimeInputValue(preferenceDailyTime: string | undefined): string {
  if (!preferenceDailyTime) {
    return "20:00";
  }

  if (isValid24HourTime(preferenceDailyTime)) {
    return preferenceDailyTime;
  }

  const parsed = new Date(preferenceDailyTime);
  if (Number.isNaN(parsed.getTime())) {
    return "20:00";
  }

  const h = String(parsed.getHours()).padStart(2, "0");
  const m = String(parsed.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function areNumberArraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function LoadingSkeleton() {
  return (
    <div className="max-w-xl space-y-6">
      <Skeleton className="h-7 w-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}

type IntegrationDoc = {
  _id: GenericId<"integrations">;
  provider: string;
  status: "connected" | "disconnected" | "error";
  lastSyncAt?: number;
  lastError?: string;
};

type IntegrationSyncRunDoc = {
  provider: string;
  status: "in_progress" | "success" | "error";
  updatedAt: number;
  dayKey: string;
  lastError?: string;
};

type WebSettingsPatch = Pick<
  UserSettingsDto,
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

function formatDateTime(timestamp?: number): string {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleString();
}

function isOAuthProvider(provider: string): boolean {
  return (
    provider === "google_calendar" ||
    provider === "google_fit" ||
    provider === "gmail_summary" ||
    provider === "spotify"
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setThemePreference } = useWebThemePreference();
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const { user } = useUser();
  const canUseIntegrationApis = isLoaded && isSignedIn && isAuthenticated;

  const userTimeZone = getResolvedTimeZone();
  const todayDayKey = getDayKeyForTimestamp(Date.now(), userTimeZone);

  const preferences = useQuery(
    api.userPreferences.getMyUserPreferences,
    isAuthenticated ? {} : "skip",
  );
  const supportedProviders = useQuery(
    api.integrations.listSupportedProviders,
    canUseIntegrationApis ? {} : "skip",
  );
  const integrations = useQuery(
    api.integrations.listMyIntegrations,
    canUseIntegrationApis ? {} : "skip",
  ) as IntegrationDoc[] | undefined;
  const syncRuns = useQuery(
    api.integrations.listMyIntegrationSyncRunsForDay,
    canUseIntegrationApis ? { dayKey: todayDayKey } : "skip",
  ) as IntegrationSyncRunDoc[] | undefined;

  const syncPreferences = useMutation(
    api.userPreferences.syncMyUserPreferences,
  );
  const connectIntegration = useMutation(api.integrations.connectIntegration);
  const disconnectIntegration = useMutation(
    api.integrations.disconnectIntegration,
  );
  const syncMyIntegrationForDay = useAction(
    api.integrations.syncMyIntegrationForDay,
  );

  const [selectedFocus, setSelectedFocus] = useState<number[]>([]);
  const [reminderType, setReminderType] = useState<"daily" | "weekly">("daily");
  const [dailyTime, setDailyTime] = useState("20:00");
  const [weeklyDay, setWeeklyDay] = useState("Sunday");
  const [theme, setTheme] = useState<UserSettingsDto["theme"]>(
    SETTINGS_DEFAULTS.theme,
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(
    SETTINGS_DEFAULTS.notificationsEnabled,
  );
  const [dailySummaryEnabled, setDailySummaryEnabled] = useState<boolean>(
    SETTINGS_DEFAULTS.dailySummaryEnabled,
  );
  const [weeklyInsightsEnabled, setWeeklyInsightsEnabled] = useState<boolean>(
    SETTINGS_DEFAULTS.weeklyInsightsEnabled,
  );
  const [quietHoursEnabled, setQuietHoursEnabled] = useState<boolean>(
    SETTINGS_DEFAULTS.quietHoursEnabled,
  );
  const [quietHoursStart, setQuietHoursStart] = useState<string>(
    SETTINGS_DEFAULTS.quietHoursStart,
  );
  const [quietHoursEnd, setQuietHoursEnd] = useState<string>(
    SETTINGS_DEFAULTS.quietHoursEnd,
  );
  const [autoSyncIntegrations, setAutoSyncIntegrations] = useState<boolean>(
    SETTINGS_DEFAULTS.autoSyncIntegrations,
  );
  const [defaultMemoryMood, setDefaultMemoryMood] = useState<
    UserSettingsDto["defaultMemoryMood"]
  >(SETTINGS_DEFAULTS.defaultMemoryMood);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [providerPendingAction, setProviderPendingAction] = useState<
    Record<string, "connect" | "disconnect" | "sync" | undefined>
  >({});

  useEffect(() => {
    if (preferences) {
      const normalizedSettings = normalizeUserSettings(preferences);
      const nextFocusAreas = preferences.focusAreas ?? [];
      setSelectedFocus((prev) =>
        areNumberArraysEqual(prev, nextFocusAreas) ? prev : nextFocusAreas,
      );
      setReminderType(preferences.reminderType ?? "daily");
      setWeeklyDay(preferences.weeklyDay ?? "Sunday");
      setDailyTime(toTimeInputValue(preferences.dailyTime));
      setTheme(normalizedSettings.theme);
      setNotificationsEnabled(normalizedSettings.notificationsEnabled);
      setDailySummaryEnabled(normalizedSettings.dailySummaryEnabled);
      setWeeklyInsightsEnabled(normalizedSettings.weeklyInsightsEnabled);
      setQuietHoursEnabled(normalizedSettings.quietHoursEnabled);
      setQuietHoursStart(normalizedSettings.quietHoursStart);
      setQuietHoursEnd(normalizedSettings.quietHoursEnd);
      setAutoSyncIntegrations(normalizedSettings.autoSyncIntegrations);
      setDefaultMemoryMood(normalizedSettings.defaultMemoryMood);
    }
  }, [preferences]);

  useEffect(() => {
    const integrationStatus = searchParams.get("integrationStatus");
    const integrationMessage = searchParams.get("integrationMessage");

    if (!integrationStatus || !integrationMessage) {
      return;
    }

    if (integrationStatus === "success") {
      toastSuccess(integrationMessage);
    } else {
      toastError(integrationMessage);
    }

    router.replace("/dashboard/settings", { scroll: false });
  }, [router, searchParams]);

  const isLoading =
    isAuthLoading || (isAuthenticated && preferences === undefined);

  if (isLoading) return <LoadingSkeleton />;

  const handleSave = async () => {
    if (!isValid24HourTime(dailyTime)) {
      toastError("Daily reminder time must be in HH:MM format");
      return;
    }

    if (
      !isValid24HourTime(quietHoursStart) ||
      !isValid24HourTime(quietHoursEnd)
    ) {
      toastError("Quiet hours start/end must be in HH:MM format");
      return;
    }

    setIsSaving(true);
    setSaved(false);
    try {
      const [h, m] = dailyTime.split(":").map(Number);
      const timeDate = new Date();
      timeDate.setHours(h!, m!, 0, 0);

      const fmtH = h! % 12 || 12;
      const ampm = h! >= 12 ? "PM" : "AM";
      const formattedTime = `${fmtH}:${String(m).padStart(2, "0")} ${ampm}`;
      const settingsPatch = normalizeUserSettingsPatch({
        theme,
        notificationsEnabled,
        dailySummaryEnabled,
        weeklyInsightsEnabled,
        quietHoursEnabled,
        quietHoursStart,
        quietHoursEnd,
        autoSyncIntegrations,
        defaultMemoryMood,
      }) as Partial<WebSettingsPatch>;

      await syncPreferences({
        focusAreas: selectedFocus,
        reminderType,
        dailyTime: timeDate.toISOString(),
        weeklyDay,
        formattedTime,
        ...settingsPatch,
      });
      setSaved(true);
      toastSuccess("Preferences saved");
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      captureException("web_settings_save_failed", err, {
        reminderType,
        weeklyDay,
      });
      toastError("Failed to save preferences");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleFocus = (id: number) => {
    setSelectedFocus((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id],
    );
  };

  const weekDays = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const integrationByProvider = new Map(
    (integrations ?? []).map((integration) => [
      integration.provider,
      integration,
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
  const supportedProviderSet = new Set<string>(supportedProviders ?? []);

  const setProviderAction = (
    provider: string,
    action: "connect" | "disconnect" | "sync" | undefined,
  ) => {
    setProviderPendingAction((prev) => ({ ...prev, [provider]: action }));
  };

  const handleConnect = async (provider: string) => {
    if (!canUseIntegrationApis) return;
    const providerStatus =
      INTEGRATION_PROVIDER_STATUS[
        provider as keyof typeof INTEGRATION_PROVIDER_STATUS
      ];

    if (providerStatus === "coming_soon") {
      const helperText =
        INTEGRATION_PROVIDER_META[
          provider as keyof typeof INTEGRATION_PROVIDER_META
        ]?.helperText ?? INTEGRATION_COMING_SOON_HELPER_TEXT;
      toastInfo(helperText);
      return;
    }

    if (!supportedProviderSet.has(provider)) {
      toastError("This integration is currently unavailable.");
      return;
    }

    setProviderAction(provider, "connect");

    if (isOAuthProvider(provider)) {
      const startPath = `/api/integrations/oauth/${provider}/start?returnTo=${encodeURIComponent("/dashboard/settings")}`;
      window.location.assign(startPath);
      return;
    }

    try {
      await connectIntegration({
        provider,
        scopes: [],
      });
      toastSuccess(
        `${INTEGRATION_PROVIDER_META[provider as keyof typeof INTEGRATION_PROVIDER_META]?.label ?? provider} connected`,
      );
      if (provider !== "apple_health") {
        toastInfo(
          "If sync fails, reconnect provider with a valid token source.",
        );
      }
    } catch (error) {
      toastError(
        error instanceof Error
          ? error.message
          : `Failed to connect ${provider}`,
      );
    } finally {
      setProviderAction(provider, undefined);
    }
  };

  const handleDisconnect = async (provider: string) => {
    if (!canUseIntegrationApis) return;
    const integration = integrationByProvider.get(provider);
    if (!integration) return;

    setProviderAction(provider, "disconnect");
    try {
      await disconnectIntegration({ integrationId: integration._id });
      toastSuccess(
        `${INTEGRATION_PROVIDER_META[provider as keyof typeof INTEGRATION_PROVIDER_META]?.label ?? provider} disconnected`,
      );
    } catch (error) {
      toastError(
        error instanceof Error
          ? error.message
          : `Failed to disconnect ${provider}`,
      );
    } finally {
      setProviderAction(provider, undefined);
    }
  };

  const handleSync = async (provider: string) => {
    if (!canUseIntegrationApis) return;
    if (provider === "spotify") {
      const spotifyIntegration = integrationByProvider.get("spotify");
      if (spotifyIntegration?.status !== "connected") {
        toastError("Spotify is not connected. Reconnect Spotify to sync.");
        return;
      }
    }
    logInfo("web_integration_sync_started", {
      status: "started",
      provider,
      dayKey: todayDayKey,
    });

    setProviderAction(provider, "sync");
    try {
      const result = await syncMyIntegrationForDay({
        provider,
        dayKey: todayDayKey,
        timeZone: userTimeZone,
      });
      if (result?.success === false && result.reason === "reauth_required") {
        toastError("Spotify session expired. Please reconnect Spotify.");
        return;
      }

      if (result?.idempotent) {
        logInfo("web_integration_sync_skipped", {
          status: "skipped",
          provider,
          dayKey: todayDayKey,
          reason: result.skippedReason,
        });
        toastInfo(
          result.skippedReason === "already_synced"
            ? "Already synced for today."
            : "Sync is already in progress.",
        );
      } else {
        logInfo("web_integration_sync_succeeded", {
          status: "succeeded",
          provider,
          dayKey: todayDayKey,
        });
        toastSuccess("Sync completed");
      }
    } catch (error) {
      captureException("web_integration_sync_failed", error, {
        status: "failed",
        provider,
        dayKey: todayDayKey,
      });
      toastError(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setProviderAction(provider, undefined);
    }
  };

  return (
    <div className="max-w-xl pb-4">
      <h1 className="text-xl font-semibold tracking-tight mb-1">Settings</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Manage your preferences and reflection schedule.
      </p>

      {/* ── Profile ───────────────────────────────────── */}
      <Card className="mb-6 bg-card/95">
        <CardContent className="flex items-center gap-4 p-5">
          <Avatar className="h-12 w-12">
            {user?.imageUrl && (
              <AvatarImage src={user.imageUrl} alt="Profile" />
            )}
            <AvatarFallback>
              {user?.firstName?.[0]}
              {user?.lastName?.[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-muted-foreground">
              {user?.primaryEmailAddress?.emailAddress}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Focus Areas ───────────────────────────────── */}
      <Card className="mb-6 bg-card/95">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Focus Areas</CardTitle>
          <CardDescription>Choose what matters most to you.</CardDescription>
        </CardHeader>
        <CardContent className="pb-5">
          <div className="flex flex-wrap gap-2">
            {FOCUS_AREAS.map((area) => {
              const isActive = selectedFocus.includes(area.id);
              return (
                <button
                  key={area.id}
                  onClick={() => toggleFocus(area.id)}
                  className={cn(
                    "inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input-border bg-secondary text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {area.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Reminders ─────────────────────────────────── */}
      <Card className="mb-8 bg-card/95">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Reminders</CardTitle>
          <CardDescription>
            Set when you want to be reminded to reflect.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pb-5">
          <div className="flex gap-2">
            <Button
              variant={reminderType === "daily" ? "default" : "outline"}
              size="sm"
              onClick={() => setReminderType("daily")}
            >
              Daily
            </Button>
            <Button
              variant={reminderType === "weekly" ? "default" : "outline"}
              size="sm"
              onClick={() => setReminderType("weekly")}
            >
              Weekly
            </Button>
          </div>

          {reminderType === "daily" && (
            <div className="space-y-1.5">
              <Label htmlFor="time">Time</Label>
              <Input
                id="time"
                type="time"
                value={dailyTime}
                onChange={(e) => setDailyTime(e.target.value)}
                className="max-w-40"
              />
            </div>
          )}

          {reminderType === "weekly" && (
            <div className="space-y-1.5">
              <Label>Day</Label>
              <Select value={weeklyDay} onValueChange={setWeeklyDay}>
                <SelectTrigger className="max-w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weekDays.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Preferences ───────────────────────────────── */}
      <Card className="mb-6 bg-card/95">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Appearance</CardTitle>
          <CardDescription>Choose your app theme.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 pb-5">
          <Label htmlFor="theme">Theme</Label>
          <Select
            value={theme}
            onValueChange={(value: "light" | "dark" | "system") => {
              setTheme(value);
              setThemePreference(value);
            }}
          >
            <SelectTrigger id="theme" className="max-w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="mb-6 bg-card/95">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Notifications</CardTitle>
          <CardDescription>
            Configure reminder and summary notifications.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pb-5">
          <div className="space-y-1.5">
            <Label>All notifications</Label>
            <Select
              value={notificationsEnabled ? "enabled" : "disabled"}
              onValueChange={(value) =>
                setNotificationsEnabled(value === "enabled")
              }
            >
              <SelectTrigger className="max-w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Daily summary notifications</Label>
            <Select
              value={dailySummaryEnabled ? "enabled" : "disabled"}
              onValueChange={(value) =>
                setDailySummaryEnabled(value === "enabled")
              }
            >
              <SelectTrigger className="max-w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Weekly insights notifications</Label>
            <Select
              value={weeklyInsightsEnabled ? "enabled" : "disabled"}
              onValueChange={(value) =>
                setWeeklyInsightsEnabled(value === "enabled")
              }
            >
              <SelectTrigger className="max-w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Quiet hours</Label>
            <Select
              value={quietHoursEnabled ? "enabled" : "disabled"}
              onValueChange={(value) =>
                setQuietHoursEnabled(value === "enabled")
              }
            >
              <SelectTrigger className="max-w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {quietHoursEnabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="quiet-hours-start">Quiet hours start</Label>
                <Input
                  id="quiet-hours-start"
                  type="time"
                  value={quietHoursStart}
                  onChange={(e) => setQuietHoursStart(e.target.value)}
                  className="max-w-40"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quiet-hours-end">Quiet hours end</Label>
                <Input
                  id="quiet-hours-end"
                  type="time"
                  value={quietHoursEnd}
                  onChange={(e) => setQuietHoursEnd(e.target.value)}
                  className="max-w-40"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6 bg-card/95">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Integrations defaults</CardTitle>
          <CardDescription>
            Set integration sync behavior and default memory mood.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pb-5">
          <div className="space-y-1.5">
            <Label>Auto-sync integrations</Label>
            <Select
              value={autoSyncIntegrations ? "enabled" : "disabled"}
              onValueChange={(value) =>
                setAutoSyncIntegrations(value === "enabled")
              }
            >
              <SelectTrigger className="max-w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="default-memory-mood">Default memory mood</Label>
            <Select
              value={defaultMemoryMood}
              onValueChange={setDefaultMemoryMood}
            >
              <SelectTrigger id="default-memory-mood" className="max-w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMORY_MOOD_OPTIONS.map((mood) => (
                  <SelectItem key={mood} value={mood}>
                    {mood}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Integrations ──────────────────────────────── */}
      <Card className="mb-8 bg-card/95">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Integrations</CardTitle>
          <CardDescription>
            Connect providers, check status, and sync today&apos;s data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pb-5">
          {providerList.map((provider) => {
            const integration = integrationByProvider.get(provider);
            const syncRun = syncRunByProvider.get(provider);
            const catalogStatus =
              INTEGRATION_PROVIDER_STATUS[
                provider as keyof typeof INTEGRATION_PROVIDER_STATUS
              ];
            const isComingSoonProvider = catalogStatus === "coming_soon";
            const isSupportedProvider = supportedProviderSet.has(provider);
            const isConnectableProvider =
              isSupportedProvider && !isComingSoonProvider;
            const status = integration?.status ?? "disconnected";
            const pending = providerPendingAction[provider];
            const syncing =
              pending === "sync" || syncRun?.status === "in_progress";
            const statusLabel = isComingSoonProvider
              ? INTEGRATION_COMING_SOON_BADGE_LABEL
              : isSupportedProvider
                ? status
                : "unavailable";

            const label =
              INTEGRATION_PROVIDER_META[
                provider as keyof typeof INTEGRATION_PROVIDER_META
              ]?.label ?? provider;
            const description =
              INTEGRATION_PROVIDER_META[
                provider as keyof typeof INTEGRATION_PROVIDER_META
              ]?.description ?? "";
            const helperText =
              INTEGRATION_PROVIDER_META[
                provider as keyof typeof INTEGRATION_PROVIDER_META
              ]?.helperText ?? INTEGRATION_COMING_SOON_HELPER_TEXT;

            return (
              <div
                key={provider}
                className="space-y-2 rounded-md border border-border bg-secondary p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">
                      {description}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                      isComingSoonProvider
                        ? "bg-muted text-muted-foreground"
                        : !isSupportedProvider
                          ? "bg-muted text-muted-foreground"
                          : status === "connected"
                            ? "bg-success/15 text-success"
                            : status === "error"
                              ? "bg-destructive/15 text-destructive"
                              : "bg-background text-muted-foreground",
                    )}
                  >
                    {statusLabel}
                  </span>
                </div>

                {isConnectableProvider ? (
                  <div className="text-[11px] text-muted-foreground space-y-0.5">
                    <p>Last sync: {formatDateTime(integration?.lastSyncAt)}</p>
                    {syncRun?.status ? (
                      <p>
                        Today&apos;s sync: {syncRun.status}
                        {syncRun.lastError ? ` — ${syncRun.lastError}` : ""}
                      </p>
                    ) : null}
                    {integration?.lastError ? (
                      <p className="text-destructive">
                        Error: {integration.lastError}
                      </p>
                    ) : null}
                  </div>
                ) : isComingSoonProvider ? (
                  <p className="text-[11px] text-muted-foreground">
                    {helperText}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {integration?.status === "connected"
                      ? "Legacy integration is no longer supported. Disconnect it to clean up your account."
                      : "This integration is not available in this deployment."}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {isComingSoonProvider ? (
                    <Button size="sm" variant="outline" disabled>
                      {INTEGRATION_COMING_SOON_BADGE_LABEL}
                    </Button>
                  ) : !isSupportedProvider ? (
                    integration?.status === "connected" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDisconnect(provider)}
                        disabled={pending !== undefined}
                      >
                        {pending === "disconnect"
                          ? "Disconnecting…"
                          : "Disconnect"}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled>
                        Unavailable
                      </Button>
                    )
                  ) : status !== "connected" ? (
                    <Button
                      size="sm"
                      onClick={() => handleConnect(provider)}
                      disabled={pending !== undefined}
                    >
                      {pending === "connect" ? "Connecting…" : "Connect"}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDisconnect(provider)}
                        disabled={pending !== undefined}
                      >
                        {pending === "disconnect"
                          ? "Disconnecting…"
                          : "Disconnect"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleSync(provider)}
                        disabled={pending !== undefined || syncing}
                      >
                        {syncing ? (
                          <>
                            <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                            Syncing…
                          </>
                        ) : (
                          "Sync now"
                        )}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="mb-8 bg-card/95">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Location data transparency</CardTitle>
          <CardDescription>
            DayLog stores privacy-first location signals only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 pb-5 text-xs text-muted-foreground">
          <p>
            • Location is opt-in and collected only while the mobile app is
            open.
          </p>
          <p>
            • Stored values are coarse area labels (approximate), not raw GPS
            trails.
          </p>
          <p>• You control whether location signals are included in exports.</p>
        </CardContent>
      </Card>

      {/* ── Save ──────────────────────────────────────── */}
      <Button onClick={handleSave} disabled={isSaving}>
        {isSaving ? (
          "Saving…"
        ) : saved ? (
          <>
            <Check className="h-4 w-4" />
            Saved
          </>
        ) : (
          "Save preferences"
        )}
      </Button>
    </div>
  );
}
