import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useUser, useAuth } from "@clerk/clerk-expo";
import { useQuery, useConvexAuth } from "convex/react";
import { api } from "@repo/backend/convex";
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
  const { user } = useUser();
  const { signOut } = useAuth();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();

  const integrations = useQuery(
    api.integrations.listMyIntegrations,
    isAuthenticated ? {} : "skip",
  );
  const preferences = useQuery(
    api.userPreferences.getMyUserPreferences,
    isAuthenticated ? {} : "skip",
  );

  const [darkMode, setDarkMode] = useState(false);
  const [allNotifications, setAllNotifications] = useState(true);
  const [weeklyInsights, setWeeklyInsights] = useState(true);
  const [dailySummary, setDailySummary] = useState(true);
  const [quietHours, setQuietHours] = useState(false);

  useEffect(() => {
    if (preferences) {
      setDailySummary(preferences.reminderType === "daily");
      setWeeklyInsights(preferences.reminderType === "weekly");
    }
  }, [preferences]);

  /* ── Callbacks ────────────────────────── */
  const handleSignOut = useCallback(() => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => signOut() },
    ]);
  }, [signOut]);

  const handleExportData = useCallback(() => {
    Alert.alert(
      "Export Data",
      "Data export will be available in a future update.",
    );
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
          onPress: () =>
            Alert.alert(
              "Contact Support",
              "Please contact support to delete your account.",
            ),
        },
      ],
    );
  }, []);

  const isLoading =
    isAuthLoading || (isAuthenticated && integrations === undefined);

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

  const integrationItems = (integrations ?? []).map((integration: any) => ({
    title: integrationNames[integration.provider] ?? integration.provider,
    subtitle:
      integration.status === "connected"
        ? "Connected"
        : integration.status === "error"
          ? "Error"
          : "Disconnected",
    icon: integrationIcons[integration.provider] ?? ("link" as IoniconName),
    connected: integration.status === "connected",
  }));

  /* ── Toggle row helper ───────────────── */
  const ToggleRow = ({
    label,
    subtitle,
    value,
    onToggle,
    disabled,
  }: {
    label: string;
    subtitle?: string;
    value: boolean;
    onToggle: () => void;
    disabled?: boolean;
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
        trackColor={{ false: c.border, true: c.tint }}
        thumbColor="#FFF"
      />
    </View>
  );

  /* ── About links ─────────────────────── */
  const aboutLinks: { title: string; icon: IoniconName }[] = [
    { title: "Help Center", icon: "help-circle-outline" },
    { title: "Privacy Policy", icon: "shield-checkmark-outline" },
    { title: "Terms of Service", icon: "document-text-outline" },
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
              onToggle={() => setDarkMode((v) => !v)}
            />
          </AppCard>
        </View>

        {/* ── Integrations ────────────────────────── */}
        <View style={styles.pad}>
          <SectionHeader title="Integrations" />
          <AppCard>
            {integrationItems.length === 0 ? (
              <View style={styles.emptyRow}>
                <Ionicons
                  name="link-outline"
                  size={18}
                  color={c.textTertiary}
                />
                <Text style={styles.emptyText}>No integrations connected</Text>
              </View>
            ) : (
              integrationItems.map((item, i) => (
                <View key={i}>
                  {i > 0 && <View style={styles.divider} />}
                  <View style={styles.integrationRow}>
                    <Ionicons name={item.icon} size={20} color={c.icon} />
                    <View style={{ flex: 1, marginLeft: Spacing.md }}>
                      <Text style={styles.integrationTitle}>{item.title}</Text>
                      <Text
                        style={[
                          styles.integrationSub,
                          item.connected && { color: c.success },
                        ]}
                      >
                        {item.subtitle}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={c.textTertiary}
                    />
                  </View>
                </View>
              ))
            )}
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
              onToggle={() => setAllNotifications((v) => !v)}
            />
            <View style={styles.divider} />
            <ToggleRow
              label="Weekly Insights"
              value={weeklyInsights}
              onToggle={() => setWeeklyInsights((v) => !v)}
              disabled={!allNotifications}
            />
            <View style={styles.divider} />
            <ToggleRow
              label="Daily Summary"
              value={dailySummary}
              onToggle={() => setDailySummary((v) => !v)}
              disabled={!allNotifications}
            />
            <View style={styles.divider} />
            <ToggleRow
              label="Quiet Hours"
              subtitle="10:00 PM — 7:00 AM"
              value={quietHours}
              onToggle={() => setQuietHours((v) => !v)}
              disabled={!allNotifications}
            />
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
                <TouchableOpacity style={styles.aboutRow} activeOpacity={0.6}>
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

  /* Integration rows */
  integrationRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  integrationTitle: {
    ...Typography.body,
    color: c.text,
  },
  integrationSub: {
    ...Typography.caption1,
    color: c.textSecondary,
    marginTop: 2,
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
