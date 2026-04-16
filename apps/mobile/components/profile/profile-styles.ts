import { StyleSheet } from "react-native";
import { withOpacity } from "@/lib/color-utils";
import {
  Spacing,
  Typography,
  Radius,
  Shadows,
  type ThemeColors,
} from "@/constants/theme";

export function createProfileStyles(c: ThemeColors) {
  return StyleSheet.create({
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
    pageSubtitle: {
      ...Typography.callout,
      color: c.textSecondary,
      marginTop: Spacing.xs,
    },
    sectionNavWrap: {
      paddingHorizontal: Spacing.xl,
      marginBottom: Spacing.lg,
    },
    sectionNavContent: {
      gap: Spacing.sm,
      paddingRight: Spacing.xs,
    },
    sectionChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.xs,
      borderWidth: 1,
      borderColor: c.divider,
      backgroundColor: c.surface,
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    sectionChipActive: {
      borderColor: c.tint,
      backgroundColor: c.tintLight,
    },
    sectionChipText: {
      ...Typography.caption1,
      color: c.textSecondary,
      fontWeight: "600",
    },
    sectionChipTextActive: {
      color: c.tint,
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
      backgroundColor: c.overlay,
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
    integrationHealthStateRow: {
      marginTop: 4,
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.xs,
    },
    integrationHealthStateBadge: {
      borderRadius: Radius.full,
      borderWidth: 1,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 1,
    },
    integrationHealthStateBadgeSuccess: {
      backgroundColor: withOpacity(c.success, 0.16),
      borderColor: withOpacity(c.success, 0.45),
    },
    integrationHealthStateBadgeFailure: {
      backgroundColor: withOpacity(c.error, 0.16),
      borderColor: withOpacity(c.error, 0.45),
    },
    integrationHealthStateBadgeMonitoring: {
      backgroundColor: c.surfaceSecondary,
      borderColor: c.divider,
    },
    integrationHealthStateText: {
      ...Typography.caption2,
      color: c.textSecondary,
      textTransform: "capitalize",
      fontWeight: "600",
    },
    integrationErrorText: {
      ...Typography.caption1,
      color: c.error,
      marginTop: 4,
      flex: 1,
    },
    integrationSyncWarningRow: {
      marginTop: 4,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: Spacing.xs,
    },
    integrationDetailLinkButton: {
      marginTop: Spacing.xs,
      alignSelf: "flex-start",
      paddingVertical: 2,
    },
    integrationDetailLinkText: {
      ...Typography.caption1,
      color: c.tint,
      fontWeight: "600",
    },
    integrationStatusBadge: {
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderWidth: 1,
    },
    integrationStatusConnected: {
      backgroundColor: withOpacity(c.success, 0.16),
      borderColor: withOpacity(c.success, 0.45),
    },
    integrationStatusError: {
      backgroundColor: withOpacity(c.error, 0.16),
      borderColor: withOpacity(c.error, 0.45),
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
      color: c.inverseText,
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
      borderColor: withOpacity(c.success, 0.45),
      backgroundColor: withOpacity(c.success, 0.12),
    },
    integrationFeedbackError: {
      borderColor: withOpacity(c.error, 0.45),
      backgroundColor: withOpacity(c.error, 0.12),
    },
    integrationFeedbackText: {
      ...Typography.caption1,
    },
    integrationHealthDashboard: {
      marginBottom: Spacing.md,
      borderWidth: 1,
      borderColor: c.divider,
      borderRadius: Radius.md,
      backgroundColor: c.surfaceSecondary,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
      gap: Spacing.sm,
    },
    integrationHealthDashboardTitle: {
      ...Typography.callout,
      color: c.text,
      fontWeight: "600",
    },
    integrationHealthUpdatedText: {
      ...Typography.caption2,
      color: c.textTertiary,
    },
    integrationHealthMetricRow: {
      flexDirection: "row",
      gap: Spacing.sm,
    },
    integrationHealthMetricCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.divider,
      borderRadius: Radius.sm,
      backgroundColor: c.surface,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.sm,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
    },
    integrationHealthMetricValue: {
      ...Typography.callout,
      color: c.text,
      fontWeight: "700",
    },
    integrationHealthMetricValueWarn: {
      color: c.warning,
    },
    integrationHealthMetricLabel: {
      ...Typography.caption2,
      color: c.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    integrationHealthWarningCard: {
      borderWidth: 1,
      borderColor: withOpacity(c.warning, 0.5),
      borderRadius: Radius.sm,
      backgroundColor: c.warningLight,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.sm,
      gap: 4,
    },
    integrationHealthWarningHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.xs,
    },
    integrationHealthWarningTitle: {
      ...Typography.caption1,
      color: c.text,
      fontWeight: "600",
    },
    integrationHealthWarningText: {
      ...Typography.caption1,
      color: c.textSecondary,
    },
    integrationDetailModalOverlay: {
      flex: 1,
      backgroundColor: c.overlay,
      justifyContent: "center",
      paddingHorizontal: Spacing.xl,
    },
    integrationDetailModalCard: {
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: c.divider,
      backgroundColor: c.surface,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
      maxHeight: "70%",
      gap: Spacing.xs,
    },
    integrationDetailModalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    integrationDetailModalTitle: {
      ...Typography.body,
      color: c.text,
      fontWeight: "700",
      flex: 1,
    },
    integrationDetailModalCloseText: {
      ...Typography.caption1,
      color: c.tint,
      fontWeight: "600",
    },
    integrationDetailFailureHeading: {
      ...Typography.caption1,
      color: c.text,
      fontWeight: "600",
      marginTop: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    integrationDetailFailureList: {
      maxHeight: 260,
    },
    integrationDetailFailureListContent: {
      gap: Spacing.xs,
    },
    integrationDetailFailureItem: {
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: withOpacity(c.error, 0.35),
      backgroundColor: withOpacity(c.error, 0.08),
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.sm,
      gap: 2,
    },
    integrationDetailFailureTime: {
      ...Typography.caption2,
      color: c.textSecondary,
      fontWeight: "600",
    },
    integrationDetailFailureMessage: {
      ...Typography.caption1,
      color: c.error,
    },
    integrationDetailFailureMeta: {
      ...Typography.caption2,
      color: c.textTertiary,
    },
    integrationDetailEmptyStateText: {
      ...Typography.caption1,
      color: c.textSecondary,
      marginBottom: Spacing.xs,
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
    syncHeading: {
      ...Typography.caption1,
      color: c.text,
      textTransform: "uppercase",
      marginBottom: 4,
    },
    syncText: {
      ...Typography.callout,
      color: c.textSecondary,
    },
    inlineActionRow: {
      marginTop: Spacing.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: Spacing.sm,
    },
    inlineActionText: {
      ...Typography.caption1,
      color: c.textSecondary,
      fontWeight: "600",
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
    dangerBtnDisabled: {
      opacity: 0.55,
    },
    dangerText: {
      ...Typography.callout,
      color: c.error,
    },
    dangerStatusCard: {
      marginTop: Spacing.sm,
      borderWidth: 1,
      borderColor: c.divider,
      borderRadius: Radius.md,
      padding: Spacing.sm,
      gap: Spacing.xs,
    },
    dangerStatusHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: Spacing.sm,
    },
    dangerStateBadge: {
      borderRadius: 999,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
    },
    dangerStateBadgeRequested: {
      backgroundColor: c.surfaceSecondary,
    },
    dangerStateBadgeProcessing: {
      backgroundColor: c.warningLight,
    },
    dangerStateBadgeCompleted: {
      backgroundColor: withOpacity(c.success, 0.18),
    },
    dangerStateBadgeFailed: {
      backgroundColor: c.error,
    },
    dangerStateBadgeText: {
      ...Typography.caption1,
      color: c.text,
      fontWeight: "700",
    },
    dangerStateBadgeTextInverted: {
      color: c.inverseText,
    },
    dangerJobIdText: {
      ...Typography.caption2,
      color: c.textTertiary,
    },
    dangerProgressMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    dangerProgressMetaText: {
      ...Typography.caption2,
      color: c.textSecondary,
    },
    dangerProgressTrack: {
      height: 6,
      borderRadius: 999,
      backgroundColor: c.divider,
      overflow: "hidden",
    },
    dangerProgressFill: {
      height: "100%",
      borderRadius: 999,
    },
    dangerProgressFillActive: {
      backgroundColor: c.tint,
    },
    dangerProgressFillCompleted: {
      backgroundColor: c.success,
    },
    dangerProgressFillFailed: {
      backgroundColor: c.error,
    },
    dangerStatusText: {
      ...Typography.caption1,
      color: c.textSecondary,
      textAlign: "center",
      marginTop: Spacing.xs,
    },
    dangerStatusTextError: {
      color: c.error,
    },
  });
}

export type ProfileStyles = ReturnType<typeof createProfileStyles>;
