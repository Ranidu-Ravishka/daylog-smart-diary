import React from "react";
import { View, Text, TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ThemeColors } from "@/constants/theme";
import { AppCard } from "@/components/ui/app-card";
import { SectionHeader } from "@/components/ui/section-header";
import type { ProfileStyles } from "./profile-styles";
import type { AboutLink } from "./types";
import { ProfileToggleRow } from "./profile-toggle-row";

type PrivacySecuritySectionProps = {
  styles: ProfileStyles;
  colors: ThemeColors;
  isPreferencesMissing: boolean;
  locationPermissionStatus?: string;
  locationLastUpdatedAt?: number;
  locationLastArea?: string;
  locationTrackingEnabled: boolean;
  backgroundLocationTrackingEnabled: boolean;
  isBackgroundLocationRuntimeEnabled: boolean;
  isBackgroundLocationFullyEnabled?: boolean;
  fitnessTrackingEnabled: boolean;
  calendarContextEnabled: boolean;
  callLogsTrackingEnabled: boolean;
  moodAssistanceEnabled: boolean;
  callActivityCollectionSupported: boolean;
  callActivityModuleStatusLabel: string;
  callActivityPermissionStatusLabel: string;
  callActivityDetail?: string | null;
  aboutLinks: AboutLink[];
  onToggleLocationTracking: () => void;
  onToggleBackgroundLocationTracking: () => void;
  onToggleFitnessTracking: () => void;
  onToggleCalendarContext: () => void;
  onToggleCallSummary: () => void;
  onToggleMoodAssistance: () => void;
  onOpenAboutLink: (path: string) => void;
};

export function PrivacySecuritySection({
  styles,
  colors,
  isPreferencesMissing,
  locationPermissionStatus,
  locationLastUpdatedAt,
  locationLastArea,
  locationTrackingEnabled,
  backgroundLocationTrackingEnabled,
  isBackgroundLocationRuntimeEnabled,
  isBackgroundLocationFullyEnabled,
  fitnessTrackingEnabled,
  calendarContextEnabled,
  callLogsTrackingEnabled,
  moodAssistanceEnabled,
  callActivityCollectionSupported,
  callActivityModuleStatusLabel,
  callActivityPermissionStatusLabel,
  callActivityDetail,
  aboutLinks,
  onToggleLocationTracking,
  onToggleBackgroundLocationTracking,
  onToggleFitnessTracking,
  onToggleCalendarContext,
  onToggleCallSummary,
  onToggleMoodAssistance,
  onOpenAboutLink,
}: PrivacySecuritySectionProps) {
  return (
    <>
      <View style={styles.pad}>
        <SectionHeader title="Privacy & Security" />
        <AppCard>
          <ProfileToggleRow
            styles={styles}
            colors={colors}
            label="Foreground Location Tracking"
            subtitle={
              locationPermissionStatus === "denied"
                ? "Permission denied. Enable location in system settings and turn this back on."
                : "Collect coarse location only while the app is open."
            }
            value={locationTrackingEnabled}
            onToggle={onToggleLocationTracking}
            disabled={isPreferencesMissing}
            testID="location-tracking-switch"
          />
          <Text style={styles.integrationSubMuted}>
            Permission: {locationPermissionStatus ?? "unknown"}
          </Text>
          <Text style={styles.integrationSubMuted}>
            Last update:{" "}
            {locationLastUpdatedAt
              ? new Date(locationLastUpdatedAt).toLocaleString()
              : "Never"}
          </Text>
          <Text style={styles.integrationSubMuted}>
            Last area: {locationLastArea ?? "Not available"}
          </Text>
          <View style={styles.divider} />
          <ProfileToggleRow
            styles={styles}
            colors={colors}
            label="Background Location (Controlled)"
            subtitle={
              isBackgroundLocationRuntimeEnabled
                ? locationTrackingEnabled
                  ? backgroundLocationTrackingEnabled &&
                    isBackgroundLocationFullyEnabled === false
                    ? "Not fully enabled on this device. Verify OS background location setup."
                    : "Collect coarse batches while app is closed with battery safeguards."
                  : "Enable foreground location first before background mode."
                : "Background location is disabled by server runtime policy."
            }
            value={backgroundLocationTrackingEnabled}
            onToggle={onToggleBackgroundLocationTracking}
            disabled={
              isPreferencesMissing ||
              !locationTrackingEnabled ||
              !isBackgroundLocationRuntimeEnabled
            }
          />
          <View style={styles.divider} />
          <ProfileToggleRow
            styles={styles}
            colors={colors}
            label="Fitness Context"
            subtitle={
              Platform.OS === "ios"
                ? "Uses Apple Health signals on-device when available."
                : "Requires connected Google Fit integration on Android."
            }
            value={fitnessTrackingEnabled}
            onToggle={onToggleFitnessTracking}
            disabled={isPreferencesMissing}
          />
          <View style={styles.divider} />
          <ProfileToggleRow
            styles={styles}
            colors={colors}
            label="Calendar & Reminder Context"
            subtitle="Uses reminder/calendar density signals, not message content."
            value={calendarContextEnabled}
            onToggle={onToggleCalendarContext}
            disabled={isPreferencesMissing}
          />
          <View style={styles.divider} />
          <ProfileToggleRow
            styles={styles}
            colors={colors}
            label="Communication Summary"
            subtitle={
              Platform.OS === "android"
                ? callActivityCollectionSupported
                  ? "Android only: aggregate call count and total minutes."
                  : callLogsTrackingEnabled
                    ? "Native call activity module unavailable on this build. You can disable this toggle."
                    : "Requires native call activity module in an Android development build."
                : "Unavailable on iOS due platform restrictions."
            }
            value={callLogsTrackingEnabled}
            onToggle={onToggleCallSummary}
            disabled={
              isPreferencesMissing ||
              Platform.OS !== "android" ||
              (!callActivityCollectionSupported && !callLogsTrackingEnabled)
            }
          />
          <Text style={styles.integrationSubMuted}>
            Call activity diagnostics: module {callActivityModuleStatusLabel},
            permission {callActivityPermissionStatusLabel}
          </Text>
          {callActivityDetail ? (
            <Text style={styles.integrationSubMuted}>{callActivityDetail}</Text>
          ) : null}
          <View style={styles.divider} />
          <ProfileToggleRow
            styles={styles}
            colors={colors}
            label="Mood Assistance (Pattern-based)"
            subtitle="Lightweight non-camera inference from time/activity patterns."
            value={moodAssistanceEnabled}
            onToggle={onToggleMoodAssistance}
            disabled={isPreferencesMissing}
          />
        </AppCard>
      </View>

      <View style={styles.pad}>
        <SectionHeader title="Legal" />
        <AppCard>
          {aboutLinks.map((item, index) => (
            <View key={item.path}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <TouchableOpacity
                style={styles.aboutRow}
                activeOpacity={0.6}
                onPress={() => onOpenAboutLink(item.path)}
              >
                <Ionicons name={item.icon} size={18} color={colors.icon} />
                <Text style={styles.aboutText}>{item.title}</Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.textTertiary}
                />
              </TouchableOpacity>
            </View>
          ))}
        </AppCard>
      </View>
    </>
  );
}
