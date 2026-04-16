import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppCard } from "@/components/ui/app-card";
import { SectionHeader } from "@/components/ui/section-header";
import type { ThemeColors } from "@/constants/theme";
import type { ProfileStyles } from "./profile-styles";
import type { DeletionState } from "./types";

type AccountSectionProps = {
  styles: ProfileStyles;
  colors: ThemeColors;
  onExportData: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => void;
  isRequestingAccountDeletion: boolean;
  isFinalizingAccountDeletion: boolean;
  isAccountDeletionInProgress: boolean;
  canRetryAccountDeletion: boolean;
  deletionState: DeletionState;
  deletionStateLabel?: string | null;
  deletionStageLabel: string;
  deletionProgressPercent: number;
  accountDeletionJobId?: string;
  accountDeletionStatusMessage?: string | null;
};

export function AccountSection({
  styles,
  colors,
  onExportData,
  onSignOut,
  onDeleteAccount,
  isRequestingAccountDeletion,
  isFinalizingAccountDeletion,
  isAccountDeletionInProgress,
  canRetryAccountDeletion,
  deletionState,
  deletionStateLabel,
  deletionStageLabel,
  deletionProgressPercent,
  accountDeletionJobId,
  accountDeletionStatusMessage,
}: AccountSectionProps) {
  const isDeleteActionDisabled =
    isRequestingAccountDeletion ||
    isFinalizingAccountDeletion ||
    (isAccountDeletionInProgress && !canRetryAccountDeletion);

  return (
    <>
      <View style={[styles.pad, styles.quickRow]}>
        <TouchableOpacity
          style={styles.quickBtn}
          onPress={onExportData}
          activeOpacity={0.75}
        >
          <Ionicons name="download-outline" size={18} color={colors.text} />
          <Text style={styles.quickText}>Export Data</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickBtn}
          onPress={onSignOut}
          activeOpacity={0.75}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={[styles.quickText, { color: colors.error }]}>
            Sign Out
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.pad}>
        <SectionHeader title="About" />
        <AppCard>
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>Version</Text>
            <Text style={styles.versionValue}>DayLog v2.1.4</Text>
          </View>
        </AppCard>
      </View>

      <View style={styles.pad}>
        <SectionHeader title="Account Lifecycle" />
        <AppCard>
          <TouchableOpacity
            style={[
              styles.dangerBtn,
              isDeleteActionDisabled && styles.dangerBtnDisabled,
            ]}
            onPress={onDeleteAccount}
            disabled={isDeleteActionDisabled}
          >
            <Ionicons name="trash-outline" size={16} color={colors.error} />
            <Text style={styles.dangerText}>
              {isFinalizingAccountDeletion
                ? "Finalizing account deletion..."
                : isRequestingAccountDeletion
                  ? "Requesting backend deletion..."
                  : canRetryAccountDeletion
                    ? "Retry Account Deletion"
                    : isAccountDeletionInProgress
                      ? "Cleaning up backend data..."
                      : "Delete Account"}
            </Text>
          </TouchableOpacity>

          {deletionStateLabel ? (
            <View style={styles.dangerStatusCard}>
              <View style={styles.dangerStatusHeader}>
                <View
                  style={[
                    styles.dangerStateBadge,
                    deletionState === "completed"
                      ? styles.dangerStateBadgeCompleted
                      : deletionState === "failed"
                        ? styles.dangerStateBadgeFailed
                        : deletionState === "processing"
                          ? styles.dangerStateBadgeProcessing
                          : styles.dangerStateBadgeRequested,
                  ]}
                >
                  <Text
                    style={[
                      styles.dangerStateBadgeText,
                      deletionState === "failed"
                        ? styles.dangerStateBadgeTextInverted
                        : null,
                    ]}
                  >
                    {deletionStateLabel}
                  </Text>
                </View>

                {accountDeletionJobId ? (
                  <Text style={styles.dangerJobIdText}>
                    Job {accountDeletionJobId}
                  </Text>
                ) : null}
              </View>

              <View style={styles.dangerProgressMetaRow}>
                <Text style={styles.dangerProgressMetaText}>
                  Stage: {deletionStageLabel}
                </Text>
                <Text style={styles.dangerProgressMetaText}>
                  {deletionProgressPercent}%
                </Text>
              </View>

              <View style={styles.dangerProgressTrack}>
                <View
                  style={[
                    styles.dangerProgressFill,
                    deletionState === "completed"
                      ? styles.dangerProgressFillCompleted
                      : deletionState === "failed"
                        ? styles.dangerProgressFillFailed
                        : styles.dangerProgressFillActive,
                    { width: `${deletionProgressPercent}%` },
                  ]}
                />
              </View>
            </View>
          ) : null}

          {accountDeletionStatusMessage ? (
            <Text
              style={[
                styles.dangerStatusText,
                canRetryAccountDeletion ? styles.dangerStatusTextError : null,
              ]}
            >
              {accountDeletionStatusMessage}
            </Text>
          ) : null}
        </AppCard>
      </View>
    </>
  );
}
