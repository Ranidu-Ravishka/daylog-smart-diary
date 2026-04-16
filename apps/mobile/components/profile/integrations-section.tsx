import React from "react";
import { View, Text, TouchableOpacity, Platform } from "react-native";
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
  IntegrationSyncRunDoc,
  IoniconName,
  ProviderPendingAction,
} from "./types";
import { ProfileToggleRow } from "./profile-toggle-row";

type IntegrationsSectionProps = {
  styles: ProfileStyles;
  colors: ThemeColors;
  isPreferencesMissing: boolean;
  autoSyncIntegrations: boolean;
  onToggleAutoSyncIntegrations: () => void;
  integrationFeedback: IntegrationFeedback;
  providerList: string[];
  integrationByProvider: Map<string, IntegrationDoc>;
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
  syncRunByProvider,
  providerPendingAction,
  integrationIcons,
  integrationNames,
  onShowAppleHealthSetup,
  onConnectIntegration,
  onDisconnectIntegration,
  onSyncIntegration,
}: IntegrationsSectionProps) {
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

          {providerList.map((provider, index) => {
            const integration = integrationByProvider.get(provider);
            const syncRun = syncRunByProvider.get(provider);
            const status = integration?.status ?? "disconnected";
            const pending = providerPendingAction[provider];
            const appleHealthSetupIssue =
              provider === "apple_health" ? getAppleHealthSetupIssue() : null;
            const isAppleHealthSetupBlocked =
              provider === "apple_health" && Boolean(appleHealthSetupIssue);
            const isSyncing =
              pending === "sync" || syncRun?.status === "in_progress";
            const statusLabel = isAppleHealthSetupBlocked
              ? Platform.OS === "ios"
                ? "setup required"
                : "iOS only"
              : status;

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
    </>
  );
}
