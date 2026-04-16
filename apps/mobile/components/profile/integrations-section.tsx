import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  Modal,
  ScrollView,
  TouchableWithoutFeedback,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { INTEGRATION_PROVIDER_META } from "@repo/ui/lib/constants";
import { AppCard } from "@/components/ui/app-card";
import { SectionHeader } from "@/components/ui/section-header";
import { getAppleHealthSetupIssue } from "@/lib/apple-health-sync";
import { Spacing, type ThemeColors } from "@/constants/theme";
import type { ProfileStyles } from "./profile-styles";
import type {
  IntegrationDoc,
  IntegrationFeedback,
  IntegrationHealthSnapshot,
  IntegrationSyncRunDoc,
  IoniconName,
  ProviderPendingAction,
} from "./types";
import { ProfileToggleRow } from "./profile-toggle-row";

type SyncReliabilityState = "success" | "failure" | "monitoring";

function deriveSyncReliabilityState(args: {
  integrationStatus: IntegrationDoc["status"] | "disconnected";
  healthStatus?: "connected" | "degraded" | "failed";
  lastOutcome?: "success" | "error" | "skipped";
}): SyncReliabilityState {
  if (
    args.lastOutcome === "error" ||
    args.integrationStatus === "error" ||
    args.healthStatus === "failed"
  ) {
    return "failure";
  }

  if (args.lastOutcome === "success" || args.healthStatus === "connected") {
    return "success";
  }

  return "monitoring";
}

function formatSyncTimestamp(value: number | undefined): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function formatDashboardUpdatedTimestamp(value: number): string {
  if (value <= 0) return "No health events yet";

  const absolute = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

  const elapsedMs = Date.now() - value;
  const elapsedMinutes = Math.floor(elapsedMs / (60 * 1000));

  if (elapsedMinutes < 1) return `${absolute} (just now)`;
  if (elapsedMinutes < 60) return `${absolute} (${elapsedMinutes}m ago)`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${absolute} (${elapsedHours}h ago)`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${absolute} (${elapsedDays}d ago)`;
}

function sanitizeProviderFailureMessage(args: {
  message: string | undefined;
  providerKey: string;
  providerLabel: string;
  fallback: string;
}): string {
  if (!args.message) return args.fallback;

  let normalized = args.message;
  normalized = normalized.replaceAll(
    `"${args.providerKey}"`,
    args.providerLabel,
  );
  normalized = normalized.replaceAll(args.providerKey, args.providerLabel);
  normalized = normalized.replaceAll('provider "', "");
  normalized = normalized.replaceAll("provider '", "");
  normalized = normalized.replaceAll("provider", "");
  normalized = normalized.replaceAll('".', ".");
  normalized = normalized.replace(/\s{2,}/g, " ").trim();

  return normalized || args.fallback;
}

type IntegrationsSectionProps = {
  styles: ProfileStyles;
  colors: ThemeColors;
  isPreferencesMissing: boolean;
  autoSyncIntegrations: boolean;
  onToggleAutoSyncIntegrations: () => void;
  integrationFeedback: IntegrationFeedback;
  providerList: string[];
  integrationByProvider: Map<string, IntegrationDoc>;
  integrationHealthByProvider: Map<string, IntegrationHealthSnapshot>;
  syncRunByProvider: Map<string, IntegrationSyncRunDoc>;
  providerPendingAction: ProviderPendingAction;
  integrationIcons: Record<string, IoniconName>;
  integrationNames: Record<string, string>;
  onShowAppleHealthSetup: () => void;
  onConnectIntegration: (provider: string) => void;
  onDisconnectIntegration: (
    provider: string,
    integrationId: IntegrationDoc["_id"],
  ) => void;
  onSyncIntegration: (provider: string) => void;
};

export function IntegrationsSection({
  styles,
  colors,
  isPreferencesMissing,
  autoSyncIntegrations,
  onToggleAutoSyncIntegrations,
  integrationFeedback,
  providerList,
  integrationByProvider,
  integrationHealthByProvider,
  syncRunByProvider,
  providerPendingAction,
  integrationIcons,
  integrationNames,
  onShowAppleHealthSetup,
  onConnectIntegration,
  onDisconnectIntegration,
  onSyncIntegration,
}: IntegrationsSectionProps) {
  const [selectedProviderForDetail, setSelectedProviderForDetail] =
    React.useState<string | null>(null);

  const getProviderLabel = React.useCallback(
    (provider: string) =>
      INTEGRATION_PROVIDER_META[
        provider as keyof typeof INTEGRATION_PROVIDER_META
      ]?.label ??
      integrationNames[provider] ??
      provider,
    [integrationNames],
  );

  const integrationHealthRows = providerList.map((provider) => {
    const integration = integrationByProvider.get(provider);
    const healthSnapshot = integrationHealthByProvider.get(provider);
    const health = healthSnapshot?.health ?? null;
    const providerLabel = getProviderLabel(provider);
    const integrationStatus =
      integration?.status ??
      healthSnapshot?.integrationStatus ??
      "disconnected";
    const lastOutcome = health?.recentOutcomes.length
      ? health.recentOutcomes[health.recentOutcomes.length - 1]
      : undefined;
    const syncState = deriveSyncReliabilityState({
      integrationStatus,
      healthStatus: health?.status,
      lastOutcome,
    });
    const latestFailure = health?.recentFailures.length
      ? health.recentFailures[health.recentFailures.length - 1]
      : undefined;

    return {
      provider,
      providerLabel,
      integrationStatus,
      syncState,
      healthUpdatedAt: health?.updatedAt,
      recentFailures: health?.recentFailures ?? [],
      lastSyncAt:
        health?.lastSyncAt ??
        healthSnapshot?.integrationLastSyncAt ??
        integration?.lastSyncAt,
      warningMessage:
        syncState === "failure"
          ? sanitizeProviderFailureMessage({
              message:
                latestFailure?.error ??
                healthSnapshot?.integrationLastError ??
                integration?.lastError,
              providerKey: provider,
              providerLabel,
              fallback:
                "Latest provider sync failed. Retry sync to restore reliability.",
            })
          : undefined,
    };
  });

  const selectedProviderDetail = selectedProviderForDetail
    ? (integrationHealthRows.find(
        (row) => row.provider === selectedProviderForDetail,
      ) ?? null)
    : null;

  const dashboardLastUpdatedAt = integrationHealthRows.reduce((latest, row) => {
    if (
      typeof row.healthUpdatedAt === "number" &&
      row.healthUpdatedAt > latest
    ) {
      return row.healthUpdatedAt;
    }

    return latest;
  }, 0);

  const dashboardLastUpdatedLabel =
    dashboardLastUpdatedAt > 0
      ? formatDashboardUpdatedTimestamp(dashboardLastUpdatedAt)
      : "No health events yet";

  const connectedCount = integrationHealthRows.filter(
    (row) => row.integrationStatus === "connected",
  ).length;
  const successCount = integrationHealthRows.filter(
    (row) => row.syncState === "success",
  ).length;
  const failedRows = integrationHealthRows.filter(
    (row) => row.syncState === "failure",
  );

  return (
    <>
      <View style={styles.pad}>
        <SectionHeader title="Sync Preferences" />
        <AppCard>
          <ProfileToggleRow
            styles={styles}
            colors={colors}
            label="Auto-sync Integrations"
            subtitle="Automatically sync connected providers"
            value={autoSyncIntegrations}
            onToggle={onToggleAutoSyncIntegrations}
            disabled={isPreferencesMissing}
          />
        </AppCard>
      </View>

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
                    ? { color: colors.success }
                    : { color: colors.error },
                ]}
              >
                {integrationFeedback.message}
              </Text>
            </View>
          ) : null}

          <View style={styles.integrationHealthDashboard}>
            <Text style={styles.integrationHealthDashboardTitle}>
              Integration health dashboard
            </Text>
            <Text style={styles.integrationSubMuted}>
              Connection status, last sync time, and sync reliability from
              backend health snapshots.
            </Text>
            <Text style={styles.integrationSubMuted}>
              Provider health can differ from your latest personal sync run.
            </Text>
            <Text style={styles.integrationHealthUpdatedText}>
              Last updated: {dashboardLastUpdatedLabel}
            </Text>

            <View style={styles.integrationHealthMetricRow}>
              <View style={styles.integrationHealthMetricCard}>
                <Text style={styles.integrationHealthMetricValue}>
                  {connectedCount}
                </Text>
                <Text style={styles.integrationHealthMetricLabel}>
                  Connected
                </Text>
              </View>
              <View style={styles.integrationHealthMetricCard}>
                <Text style={styles.integrationHealthMetricValue}>
                  {successCount}
                </Text>
                <Text style={styles.integrationHealthMetricLabel}>Healthy</Text>
              </View>
              <View style={styles.integrationHealthMetricCard}>
                <Text
                  style={[
                    styles.integrationHealthMetricValue,
                    failedRows.length > 0
                      ? styles.integrationHealthMetricValueWarn
                      : null,
                  ]}
                >
                  {failedRows.length}
                </Text>
                <Text style={styles.integrationHealthMetricLabel}>Failed</Text>
              </View>
            </View>

            {failedRows.length > 0 ? (
              <View style={styles.integrationHealthWarningCard}>
                <View style={styles.integrationHealthWarningHeader}>
                  <Ionicons
                    name="warning-outline"
                    size={14}
                    color={colors.warning}
                  />
                  <Text style={styles.integrationHealthWarningTitle}>
                    {failedRows.length} failed sync
                    {failedRows.length === 1 ? "" : "s"} detected
                  </Text>
                </View>

                {failedRows.slice(0, 3).map((row) => {
                  return (
                    <Text
                      key={`failed-${row.provider}`}
                      style={styles.integrationHealthWarningText}
                    >
                      {row.providerLabel}: {row.warningMessage}
                    </Text>
                  );
                })}
              </View>
            ) : null}
          </View>

          {providerList.map((provider, index) => {
            const integration = integrationByProvider.get(provider);
            const healthSnapshot = integrationHealthByProvider.get(provider);
            const health = healthSnapshot?.health ?? null;
            const syncRun = syncRunByProvider.get(provider);
            const status =
              integration?.status ??
              healthSnapshot?.integrationStatus ??
              "disconnected";
            const pending = providerPendingAction[provider];
            const appleHealthSetupIssue =
              provider === "apple_health" ? getAppleHealthSetupIssue() : null;
            const isAppleHealthSetupBlocked =
              provider === "apple_health" && Boolean(appleHealthSetupIssue);
            const isSyncing =
              pending === "sync" || syncRun?.status === "in_progress";
            const lastOutcome = health?.recentOutcomes.length
              ? health.recentOutcomes[health.recentOutcomes.length - 1]
              : undefined;
            const syncState = deriveSyncReliabilityState({
              integrationStatus: status,
              healthStatus: health?.status,
              lastOutcome,
            });
            const latestFailure = health?.recentFailures.length
              ? health.recentFailures[health.recentFailures.length - 1]
              : undefined;
            const warningMessage =
              syncState === "failure"
                ? (latestFailure?.error ??
                  healthSnapshot?.integrationLastError ??
                  integration?.lastError ??
                  "Latest sync failed. Retry to recover.")
                : undefined;
            const statusLabel = isAppleHealthSetupBlocked
              ? Platform.OS === "ios"
                ? "setup required"
                : "iOS only"
              : status;
            const syncStateLabel =
              syncState === "success"
                ? "success"
                : syncState === "failure"
                  ? "failure"
                  : "monitoring";
            const latestSyncAt =
              health?.lastSyncAt ??
              healthSnapshot?.integrationLastSyncAt ??
              integration?.lastSyncAt;

            const label = getProviderLabel(provider);
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
                    color={colors.icon}
                  />
                  <View style={{ flex: 1, marginLeft: Spacing.md }}>
                    <View style={styles.integrationHeadingRow}>
                      <Text style={styles.integrationTitle}>{label}</Text>
                      <View style={styles.integrationHeadingBadges}>
                        <View
                          style={[
                            styles.integrationStatusBadge,
                            isAppleHealthSetupBlocked
                              ? styles.integrationStatusSetupRequired
                              : status === "connected"
                                ? styles.integrationStatusConnected
                                : status === "error"
                                  ? styles.integrationStatusError
                                  : styles.integrationStatusDisconnected,
                          ]}
                        >
                          <Text style={styles.integrationStatusText}>
                            {statusLabel}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {!!description ? (
                      <Text style={styles.integrationSub}>{description}</Text>
                    ) : null}

                    {provider === "apple_health" ? (
                      <View style={styles.appleHealthHintCard}>
                        <Text style={styles.appleHealthHintText}>
                          {Platform.OS === "ios"
                            ? "Requires iOS native build + HealthKit setup for real device data."
                            : "Apple Health sync is only available on iOS devices."}
                        </Text>
                        <TouchableOpacity
                          onPress={onShowAppleHealthSetup}
                          activeOpacity={0.75}
                        >
                          <Text style={styles.appleHealthHintAction}>
                            How to enable
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}

                    <Text style={styles.integrationSubMuted}>
                      Last sync: {formatSyncTimestamp(latestSyncAt)}
                    </Text>

                    <View style={styles.integrationHealthStateRow}>
                      <Text style={styles.integrationSubMuted}>Provider:</Text>
                      <View
                        style={[
                          styles.integrationHealthStateBadge,
                          syncState === "success"
                            ? styles.integrationHealthStateBadgeSuccess
                            : syncState === "failure"
                              ? styles.integrationHealthStateBadgeFailure
                              : styles.integrationHealthStateBadgeMonitoring,
                        ]}
                      >
                        <Text style={styles.integrationHealthStateText}>
                          {syncStateLabel}
                        </Text>
                      </View>
                    </View>

                    {syncRun?.status ? (
                      <Text style={styles.integrationSubMuted}>
                        Your run today: {syncRun.status}
                        {syncRun.lastError ? ` — ${syncRun.lastError}` : ""}
                      </Text>
                    ) : null}

                    {warningMessage ? (
                      <View style={styles.integrationSyncWarningRow}>
                        <Ionicons
                          name="warning-outline"
                          size={13}
                          color={colors.warning}
                        />
                        <Text style={styles.integrationErrorText}>
                          {warningMessage}
                        </Text>
                      </View>
                    ) : null}

                    <TouchableOpacity
                      style={styles.integrationDetailLinkButton}
                      onPress={() => setSelectedProviderForDetail(provider)}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.integrationDetailLinkText}>
                        View health details
                      </Text>
                    </TouchableOpacity>

                    <View style={styles.integrationActionsRow}>
                      {status !== "connected" ? (
                        <TouchableOpacity
                          style={styles.integrationPrimaryBtn}
                          onPress={() => {
                            if (isAppleHealthSetupBlocked) {
                              onShowAppleHealthSetup();
                              return;
                            }

                            onConnectIntegration(provider);
                          }}
                          disabled={pending !== undefined}
                          activeOpacity={0.75}
                        >
                          <Text style={styles.integrationPrimaryBtnText}>
                            {isAppleHealthSetupBlocked
                              ? "Setup required"
                              : pending === "connect"
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
                              onDisconnectIntegration(
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
                              if (isAppleHealthSetupBlocked) {
                                onShowAppleHealthSetup();
                                return;
                              }

                              onSyncIntegration(provider);
                            }}
                            disabled={
                              pending !== undefined ||
                              (!isAppleHealthSetupBlocked && isSyncing)
                            }
                            activeOpacity={0.75}
                          >
                            <Text style={styles.integrationPrimaryBtnText}>
                              {isAppleHealthSetupBlocked
                                ? "Setup required"
                                : isSyncing
                                  ? "Syncing..."
                                  : "Sync now"}
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

      <Modal
        transparent
        animationType="fade"
        visible={selectedProviderDetail !== null}
        onRequestClose={() => setSelectedProviderForDetail(null)}
      >
        <TouchableWithoutFeedback
          onPress={() => setSelectedProviderForDetail(null)}
        >
          <View style={styles.integrationDetailModalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.integrationDetailModalCard}>
                <View style={styles.integrationDetailModalHeader}>
                  <Text style={styles.integrationDetailModalTitle}>
                    {selectedProviderDetail?.providerLabel ??
                      "Integration health details"}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedProviderForDetail(null)}
                    hitSlop={8}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.integrationDetailModalCloseText}>
                      Close
                    </Text>
                  </TouchableOpacity>
                </View>

                {selectedProviderDetail ? (
                  <>
                    <Text style={styles.integrationSubMuted}>
                      Last sync:{" "}
                      {formatSyncTimestamp(selectedProviderDetail.lastSyncAt)}
                    </Text>
                    <Text style={styles.integrationSubMuted}>
                      Provider state: {selectedProviderDetail.syncState}
                    </Text>

                    <Text style={styles.integrationDetailFailureHeading}>
                      Recent failure history
                    </Text>

                    {selectedProviderDetail.recentFailures.length === 0 ? (
                      <Text style={styles.integrationDetailEmptyStateText}>
                        No recent failures recorded for this provider.
                      </Text>
                    ) : (
                      <ScrollView
                        style={styles.integrationDetailFailureList}
                        contentContainerStyle={
                          styles.integrationDetailFailureListContent
                        }
                      >
                        {selectedProviderDetail.recentFailures
                          .slice(-10)
                          .reverse()
                          .map((failure) => (
                            <View
                              key={`${failure.at}-${failure.error}`}
                              style={styles.integrationDetailFailureItem}
                            >
                              <Text style={styles.integrationDetailFailureTime}>
                                {new Date(failure.at).toLocaleString()}
                              </Text>
                              <Text
                                style={styles.integrationDetailFailureMessage}
                              >
                                {sanitizeProviderFailureMessage({
                                  message: failure.error,
                                  providerKey: selectedProviderDetail.provider,
                                  providerLabel:
                                    selectedProviderDetail.providerLabel,
                                  fallback: "Provider sync failed.",
                                })}
                              </Text>
                              {failure.dayKey ? (
                                <Text
                                  style={styles.integrationDetailFailureMeta}
                                >
                                  Day: {failure.dayKey}
                                </Text>
                              ) : null}
                            </View>
                          ))}
                      </ScrollView>
                    )}
                  </>
                ) : null}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}
