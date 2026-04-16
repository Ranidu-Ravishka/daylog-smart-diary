import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { AppCard } from "@/components/ui/app-card";
import { SectionHeader } from "@/components/ui/section-header";
import type { ThemeColors } from "@/constants/theme";
import type { ProfileStyles } from "./profile-styles";
import { ProfileToggleRow } from "./profile-toggle-row";

type NotificationsSectionProps = {
  styles: ProfileStyles;
  colors: ThemeColors;
  isPreferencesMissing: boolean;
  allNotifications: boolean;
  weeklyInsights: boolean;
  dailySummary: boolean;
  quietHours: boolean;
  quietHoursRangeLabel: string;
  quietHoursStartLabel: string;
  quietHoursEndLabel: string;
  isUpdatingReminderPreference: boolean;
  onToggleAllNotifications: () => void;
  onSetWeeklyInsights: () => void;
  onSetDailySummary: () => void;
  onToggleQuietHours: () => void;
  onOpenQuietHoursStart: () => void;
  onOpenQuietHoursEnd: () => void;
};

export function NotificationsSection({
  styles,
  colors,
  isPreferencesMissing,
  allNotifications,
  weeklyInsights,
  dailySummary,
  quietHours,
  quietHoursRangeLabel,
  quietHoursStartLabel,
  quietHoursEndLabel,
  isUpdatingReminderPreference,
  onToggleAllNotifications,
  onSetWeeklyInsights,
  onSetDailySummary,
  onToggleQuietHours,
  onOpenQuietHoursStart,
  onOpenQuietHoursEnd,
}: NotificationsSectionProps) {
  return (
    <View style={styles.pad}>
      <SectionHeader title="Notifications" />
      <AppCard>
        <ProfileToggleRow
          styles={styles}
          colors={colors}
          label="All Notifications"
          subtitle="Master switch"
          value={allNotifications}
          onToggle={onToggleAllNotifications}
          disabled={isPreferencesMissing}
        />
        <View style={styles.divider} />
        <ProfileToggleRow
          styles={styles}
          colors={colors}
          label="Weekly Insights"
          value={weeklyInsights}
          onToggle={onSetWeeklyInsights}
          disabled={
            !allNotifications ||
            isUpdatingReminderPreference ||
            isPreferencesMissing
          }
        />
        <View style={styles.divider} />
        <ProfileToggleRow
          styles={styles}
          colors={colors}
          label="Daily Summary"
          value={dailySummary}
          onToggle={onSetDailySummary}
          disabled={
            !allNotifications ||
            isUpdatingReminderPreference ||
            isPreferencesMissing
          }
        />
        <View style={styles.divider} />
        <ProfileToggleRow
          styles={styles}
          colors={colors}
          label="Quiet Hours"
          subtitle={quietHoursRangeLabel}
          value={quietHours}
          onToggle={onToggleQuietHours}
          disabled={!allNotifications || isPreferencesMissing}
        />
        <View style={styles.divider} />
        <View style={styles.quietHoursConfigRow}>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.toggleLabel,
                (!quietHours || !allNotifications || isPreferencesMissing) && {
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
            onPress={onOpenQuietHoursStart}
            disabled={!quietHours || !allNotifications || isPreferencesMissing}
          >
            <Text style={styles.quietHoursChipText}>
              {quietHoursStartLabel}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.divider} />
        <View style={styles.quietHoursConfigRow}>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.toggleLabel,
                (!quietHours || !allNotifications || isPreferencesMissing) && {
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
            onPress={onOpenQuietHoursEnd}
            disabled={!quietHours || !allNotifications || isPreferencesMissing}
          >
            <Text style={styles.quietHoursChipText}>{quietHoursEndLabel}</Text>
          </TouchableOpacity>
        </View>
      </AppCard>
    </View>
  );
}
