import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MEMORY_MOOD_OPTIONS, SETTINGS_DEFAULTS } from "@repo/ui/lib/constants";
import { Spacing, type ThemeColors } from "@/constants/theme";
import { AppCard } from "@/components/ui/app-card";
import { SectionHeader } from "@/components/ui/section-header";
import type { OutboxLastSyncResult, PreferencesSnapshot } from "./types";
import type { ProfileStyles } from "./profile-styles";
import { ProfileToggleRow } from "./profile-toggle-row";

type ProfileOverviewSectionProps = {
  styles: ProfileStyles;
  colors: ThemeColors;
  userName: string;
  userEmail: string;
  isPreferencesMissing: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  defaultMemoryMood: string;
  onChangeDefaultMemoryMood: (mood: string) => void;
  pendingOutboxCount: number;
  dueNowOutboxCount: number;
  reminderDeliveryEnabled: boolean;
  locationTrackingEnabled: boolean;
  backgroundLocationStatusLabel: string;
  onOpenQuickSetup: () => void;
  showAdvancedStatus: boolean;
  onToggleAdvancedStatus: () => void;
  preferencesSnapshot?: PreferencesSnapshot;
  fitnessTrackingEnabled: boolean;
  calendarContextEnabled: boolean;
  callLogsTrackingEnabled: boolean;
  moodAssistanceEnabled: boolean;
  notificationPermissionStatus: string;
  quietHoursRangeLabel: string;
  scheduledReminders: number;
  reminderError?: string;
  backgroundLocationDetail?: string;
  oldestQueuedAt?: number;
  lastOutboxSyncResult?: OutboxLastSyncResult;
  outboxLastSyncStatusColor: string;
};

export function ProfileOverviewSection({
  styles,
  colors,
  userName,
  userEmail,
  isPreferencesMissing,
  darkMode,
  onToggleDarkMode,
  defaultMemoryMood,
  onChangeDefaultMemoryMood,
  pendingOutboxCount,
  dueNowOutboxCount,
  reminderDeliveryEnabled,
  locationTrackingEnabled,
  backgroundLocationStatusLabel,
  onOpenQuickSetup,
  showAdvancedStatus,
  onToggleAdvancedStatus,
  preferencesSnapshot,
  fitnessTrackingEnabled,
  calendarContextEnabled,
  callLogsTrackingEnabled,
  moodAssistanceEnabled,
  notificationPermissionStatus,
  quietHoursRangeLabel,
  scheduledReminders,
  reminderError,
  backgroundLocationDetail,
  oldestQueuedAt,
  lastOutboxSyncResult,
  outboxLastSyncStatusColor,
}: ProfileOverviewSectionProps) {
  return (
    <>
      <View style={styles.pad}>
        <SectionHeader title="Profile Overview" />
        <AppCard>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={24} color={colors.tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{userName}</Text>
              <Text style={styles.profileEmail}>{userEmail}</Text>
            </View>
          </View>
        </AppCard>
      </View>

      <View style={styles.pad}>
        <SectionHeader title="App Preferences" />
        <AppCard>
          <ProfileToggleRow
            styles={styles}
            colors={colors}
            label="Dark Mode"
            value={darkMode}
            onToggle={onToggleDarkMode}
            disabled={isPreferencesMissing}
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
                  style={[styles.moodChip, selected && styles.moodChipSelected]}
                  onPress={() => onChangeDefaultMemoryMood(mood)}
                  disabled={isPreferencesMissing}
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

      <View style={styles.pad}>
        <SectionHeader title="Status Snapshot" />
        <AppCard>
          <Text style={styles.syncHeading}>Operational</Text>
          <Text style={styles.syncText}>
            Pending operations: {pendingOutboxCount}
            {dueNowOutboxCount > 0 ? ` (${dueNowOutboxCount} ready now)` : ""}
          </Text>
          <Text style={[styles.syncText, { marginTop: 4 }]}>
            Reminder delivery: {reminderDeliveryEnabled ? "active" : "paused"}
          </Text>
          <Text style={[styles.syncText, { marginTop: 4 }]}>
            Foreground location:{" "}
            {locationTrackingEnabled ? "enabled" : "disabled"}
          </Text>
          <Text style={[styles.syncText, { marginTop: 4 }]}>
            Background location: {backgroundLocationStatusLabel}
          </Text>

          {isPreferencesMissing ? (
            <TouchableOpacity
              onPress={onOpenQuickSetup}
              style={[styles.quickBtn, { marginTop: Spacing.md }]}
            >
              <Ionicons name="settings-outline" size={16} color={colors.tint} />
              <Text style={styles.quickText}>Open Quick Setup</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.inlineActionRow}
            onPress={onToggleAdvancedStatus}
            activeOpacity={0.75}
          >
            <Text style={styles.inlineActionText}>
              {showAdvancedStatus
                ? "Hide advanced diagnostics"
                : "Show advanced diagnostics"}
            </Text>
            <Ionicons
              name={showAdvancedStatus ? "chevron-up" : "chevron-down"}
              size={16}
              color={colors.textSecondary}
            />
          </TouchableOpacity>

          {showAdvancedStatus ? (
            <>
              <View style={styles.divider} />
              {preferencesSnapshot ? (
                <>
                  <Text style={styles.syncText}>
                    Reminder: {preferencesSnapshot.reminderType} at{" "}
                    {preferencesSnapshot.formattedTime}
                  </Text>
                  <Text style={[styles.syncText, { marginTop: 4 }]}>
                    Focus areas: {preferencesSnapshot.focusAreas?.length ?? 0}{" "}
                    selected
                  </Text>
                  <Text style={[styles.syncText, { marginTop: 4 }]}>
                    Theme: {preferencesSnapshot.theme ?? "system"}
                  </Text>
                  <Text style={[styles.syncText, { marginTop: 4 }]}>
                    Default memory mood:{" "}
                    {preferencesSnapshot.defaultMemoryMood ??
                      SETTINGS_DEFAULTS.defaultMemoryMood}
                  </Text>
                  <Text style={[styles.syncText, { marginTop: 4 }]}>
                    Location permission:{" "}
                    {preferencesSnapshot.locationPermissionStatus ?? "unknown"}
                  </Text>
                  <Text style={[styles.syncText, { marginTop: 4 }]}>
                    Location last update:{" "}
                    {preferencesSnapshot.locationLastUpdatedAt
                      ? new Date(
                          preferencesSnapshot.locationLastUpdatedAt,
                        ).toLocaleString()
                      : "Never"}
                  </Text>
                  {backgroundLocationStatusLabel === "Not fully enabled" &&
                  backgroundLocationDetail ? (
                    <Text
                      style={[
                        styles.syncText,
                        { marginTop: 4, color: colors.error },
                      ]}
                    >
                      Background location detail: {backgroundLocationDetail}
                    </Text>
                  ) : null}
                  <Text style={[styles.syncText, { marginTop: 4 }]}>
                    Fitness context:{" "}
                    {fitnessTrackingEnabled ? "enabled" : "disabled"}
                  </Text>
                  <Text style={[styles.syncText, { marginTop: 4 }]}>
                    Calendar context:{" "}
                    {calendarContextEnabled ? "enabled" : "disabled"}
                  </Text>
                  <Text style={[styles.syncText, { marginTop: 4 }]}>
                    Communication summary:{" "}
                    {callLogsTrackingEnabled ? "enabled" : "disabled"}
                  </Text>
                  <Text style={[styles.syncText, { marginTop: 4 }]}>
                    Mood assistance:{" "}
                    {moodAssistanceEnabled ? "enabled" : "disabled"}
                  </Text>
                  <Text style={[styles.syncText, { marginTop: 4 }]}>
                    Notification permission: {notificationPermissionStatus}
                  </Text>
                  <Text style={[styles.syncText, { marginTop: 4 }]}>
                    Quiet hours: {quietHoursRangeLabel}
                  </Text>
                  <Text style={[styles.syncText, { marginTop: 4 }]}>
                    Scheduled reminders: {scheduledReminders}
                  </Text>
                  {reminderError ? (
                    <Text
                      style={[
                        styles.syncText,
                        { marginTop: 4, color: colors.error },
                      ]}
                    >
                      Reminder error: {reminderError}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.syncText}>
                  Preferences not set yet. Complete Quick Setup to unlock
                  reminder and context sync.
                </Text>
              )}

              <View style={styles.divider} />
              <Text style={styles.syncHeading}>Offline Outbox</Text>
              <Text style={styles.syncText}>
                Oldest queued item:{" "}
                {oldestQueuedAt
                  ? new Date(oldestQueuedAt).toLocaleString()
                  : "None"}
              </Text>
              <Text style={[styles.syncText, { marginTop: 4 }]}>
                Last outbox sync:{" "}
                {lastOutboxSyncResult
                  ? new Date(lastOutboxSyncResult.updatedAt).toLocaleString()
                  : "No sync attempts yet"}
              </Text>
              {lastOutboxSyncResult ? (
                <Text
                  style={[
                    styles.syncText,
                    { marginTop: 4, color: outboxLastSyncStatusColor },
                  ]}
                >
                  Result: {lastOutboxSyncResult.message}
                </Text>
              ) : null}
            </>
          ) : null}
        </AppCard>
      </View>
    </>
  );
}
