import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Platform,
  TouchableWithoutFeedback,
  TextInput,
  Pressable,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Spacing, Typography } from "@/constants/theme";
import type { ProfileScreenLoadedProps } from "@/hooks/useProfileScreen";
import type { DeletionState } from "@/components/profile/types";
import { ProfileOverviewSection } from "@/components/profile/profile-overview-section";
import { PrivacySecuritySection } from "@/components/profile/privacy-security-section";
import { NotificationsSection } from "@/components/profile/notifications-section";
import { IntegrationsSection } from "@/components/profile/integrations-section";
import { AccountSection } from "@/components/profile/account-section";
import { PROFILE_SECTIONS, format24hTo12h } from "@/lib/profile-screen-helpers";
import {
  PROFILE_INTEGRATION_ICONS,
  PROFILE_INTEGRATION_NAMES,
} from "@/lib/profile-integration-display";

export function ProfileScreenLayout({
  styles,
  c,
  router,
  activeSection,
  setActiveSection,
  userName,
  userEmail,
  profileImageUrl,
  isUpdatingProfileImage,
  providerImageOptions,
  handleUploadProfileImage,
  handleUseProviderProfileImage,
  handleResetProfileImage,
  preferences,
  darkMode,
  handleDarkModeToggle,
  defaultMemoryMood,
  handleDefaultMemoryMoodChange,
  offlineOutboxSnapshot,
  reminderRuntime,
  locationTrackingEnabled,
  backgroundLocationStatusLabel,
  showAdvancedStatus,
  setShowAdvancedStatus,
  preferencesSnapshot,
  fitnessTrackingEnabled,
  calendarContextEnabled,
  callLogsTrackingEnabled,
  moodAssistanceEnabled,
  quietHoursRangeLabel,
  lastOutboxSyncResult,
  outboxLastSyncStatusColor,
  backgroundLocationRuntimeStatus,
  biometricEnabled,
  isAppLockReady,
  biometricAvailable,
  biometricDisplayName,
  promptOnAppOpen,
  sessionTimeoutLabel,
  hasAppPassword,
  locationTrackingRuntimeConfig,
  backgroundLocationTrackingEnabled,
  callActivityCollectionSupported,
  callActivityModuleStatusLabel,
  callActivityPermissionStatusLabel,
  callActivityDiagnostics,
  aboutLinks,
  handleLocationTrackingToggle,
  handleBackgroundLocationTrackingToggle,
  handleFitnessTrackingToggle,
  handleCalendarContextToggle,
  handleCallSummaryToggle,
  handleMoodAssistanceToggle,
  handleBiometricToggle,
  handlePromptOnAppOpenToggle,
  handleSelectSessionTimeout,
  handleManageAppPassword,
  handleOpenAboutLink,
  allNotifications,
  weeklyInsights,
  dailySummary,
  quietHours,
  quietHoursStart,
  quietHoursEnd,
  isUpdatingReminderPreference,
  handleAllNotificationsToggle,
  updateReminderType,
  handleQuietHoursToggle,
  openQuietHoursPicker,
  supportedProviders,
  autoSyncIntegrations,
  handleAutoSyncIntegrationsToggle,
  integrationFeedback,
  providerList,
  integrationByProvider,
  integrationHealthByProvider,
  syncRunByProvider,
  providerPendingAction,
  handleShowAppleHealthSetup,
  handleConnectIntegration,
  handleDisconnectIntegration,
  handleSyncIntegration,
  handleExportData,
  handleSignOut,
  handleDeleteAccount,
  isRequestingAccountDeletion,
  isFinalizingAccountDeletion,
  isAccountDeletionInProgress,
  canRetryAccountDeletion,
  deletionState,
  deletionStateLabel,
  deletionStageLabel,
  deletionProgressPercent,
  accountDeletionStatus,
  accountDeletionStatusMessage,
  showAppPasswordModal,
  closeAppPasswordModal,
  handleSaveAppPassword,
  isSavingAppPassword,
  appPasswordValue,
  setAppPasswordValue,
  appPasswordConfirmValue,
  setAppPasswordConfirmValue,
  appPasswordError,
  showQuietHoursPicker,
  setShowQuietHoursPicker,
  quietHoursPickerValue,
  handleQuietHoursPickerChange,
  handleQuietHoursPickerDone,
  activeSectionMeta,
}: ProfileScreenLoadedProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────── */}
        <View style={styles.headerRow}>
          <Text style={styles.pageTitle}>Profile</Text>
          <Text style={styles.pageSubtitle}>{activeSectionMeta.subtitle}</Text>
        </View>

        <View style={styles.sectionNavWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sectionNavContent}
          >
            {PROFILE_SECTIONS.map((section) => {
              const selected = section.key === activeSection;
              return (
                <TouchableOpacity
                  key={section.key}
                  style={[
                    styles.sectionChip,
                    selected ? styles.sectionChipActive : null,
                  ]}
                  onPress={() => setActiveSection(section.key)}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={section.icon}
                    size={14}
                    color={selected ? c.tint : c.textSecondary}
                  />
                  <Text
                    style={[
                      styles.sectionChipText,
                      selected ? styles.sectionChipTextActive : null,
                    ]}
                  >
                    {section.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {activeSection === "overview" ? (
          <ProfileOverviewSection
            styles={styles}
            colors={c}
            userName={userName}
            userEmail={userEmail}
            userImageUrl={profileImageUrl}
            isUpdatingProfileImage={isUpdatingProfileImage}
            providerImageOptions={providerImageOptions}
            onUploadProfileImage={() => {
              void handleUploadProfileImage();
            }}
            onUseProviderProfileImage={(provider, imageUrl) => {
              void handleUseProviderProfileImage(provider, imageUrl);
            }}
            onResetProfileImage={() => {
              void handleResetProfileImage();
            }}
            isPreferencesMissing={preferences === null}
            darkMode={darkMode}
            onToggleDarkMode={() => {
              void handleDarkModeToggle();
            }}
            defaultMemoryMood={defaultMemoryMood}
            onChangeDefaultMemoryMood={(mood) => {
              void handleDefaultMemoryMoodChange(mood);
            }}
            pendingOutboxCount={offlineOutboxSnapshot.pending}
            dueNowOutboxCount={offlineOutboxSnapshot.dueNow}
            reminderDeliveryEnabled={Boolean(reminderRuntime?.deliveryEnabled)}
            locationTrackingEnabled={locationTrackingEnabled}
            backgroundLocationStatusLabel={backgroundLocationStatusLabel}
            onOpenQuickSetup={() => router.push("/(tabs)/quick-setup")}
            showAdvancedStatus={showAdvancedStatus}
            onToggleAdvancedStatus={() =>
              setShowAdvancedStatus((previous) => !previous)
            }
            preferencesSnapshot={preferencesSnapshot}
            fitnessTrackingEnabled={fitnessTrackingEnabled}
            calendarContextEnabled={calendarContextEnabled}
            callLogsTrackingEnabled={callLogsTrackingEnabled}
            moodAssistanceEnabled={moodAssistanceEnabled}
            notificationPermissionStatus={
              reminderRuntime?.permissionStatus ?? "unknown"
            }
            quietHoursRangeLabel={quietHoursRangeLabel}
            scheduledReminders={reminderRuntime?.scheduledCount ?? 0}
            reminderError={reminderRuntime?.error}
            backgroundLocationDetail={backgroundLocationRuntimeStatus?.reason}
            oldestQueuedAt={offlineOutboxSnapshot.oldestCreatedAt}
            lastOutboxSyncResult={lastOutboxSyncResult}
            outboxLastSyncStatusColor={outboxLastSyncStatusColor}
          />
        ) : null}

        {activeSection === "privacy" ? (
          <PrivacySecuritySection
            styles={styles}
            colors={c}
            biometricEnabled={biometricEnabled}
            biometricAvailable={isAppLockReady && biometricAvailable}
            biometricDisplayName={biometricDisplayName}
            promptOnAppOpen={promptOnAppOpen}
            sessionTimeoutLabel={sessionTimeoutLabel}
            hasAppPassword={hasAppPassword}
            isPreferencesMissing={preferences === null}
            locationPermissionStatus={preferences?.locationPermissionStatus}
            locationLastUpdatedAt={preferences?.locationLastUpdatedAt}
            locationLastArea={preferences?.locationLastArea}
            locationTrackingEnabled={locationTrackingEnabled}
            backgroundLocationTrackingEnabled={
              backgroundLocationTrackingEnabled
            }
            isBackgroundLocationRuntimeEnabled={Boolean(
              locationTrackingRuntimeConfig?.enableBackgroundLocationTracking,
            )}
            isBackgroundLocationFullyEnabled={
              backgroundLocationRuntimeStatus?.fullyEnabled
            }
            fitnessTrackingEnabled={fitnessTrackingEnabled}
            calendarContextEnabled={calendarContextEnabled}
            callLogsTrackingEnabled={callLogsTrackingEnabled}
            moodAssistanceEnabled={moodAssistanceEnabled}
            callActivityCollectionSupported={callActivityCollectionSupported}
            callActivityModuleStatusLabel={callActivityModuleStatusLabel}
            callActivityPermissionStatusLabel={
              callActivityPermissionStatusLabel
            }
            callActivityDetail={callActivityDiagnostics?.detail}
            aboutLinks={aboutLinks}
            onToggleLocationTracking={() => {
              void handleLocationTrackingToggle();
            }}
            onToggleBackgroundLocationTracking={() => {
              void handleBackgroundLocationTrackingToggle();
            }}
            onToggleFitnessTracking={() => {
              void handleFitnessTrackingToggle();
            }}
            onToggleCalendarContext={() => {
              void handleCalendarContextToggle();
            }}
            onToggleCallSummary={() => {
              void handleCallSummaryToggle();
            }}
            onToggleMoodAssistance={() => {
              void handleMoodAssistanceToggle();
            }}
            onToggleBiometric={() => {
              void handleBiometricToggle();
            }}
            onTogglePromptOnAppOpen={() => {
              void handlePromptOnAppOpenToggle();
            }}
            onSelectSessionTimeout={handleSelectSessionTimeout}
            onManageAppPassword={handleManageAppPassword}
            onOpenAboutLink={handleOpenAboutLink}
          />
        ) : null}

        {activeSection === "notifications" ? (
          <NotificationsSection
            styles={styles}
            colors={c}
            isPreferencesMissing={preferences === null}
            allNotifications={allNotifications}
            weeklyInsights={weeklyInsights}
            dailySummary={dailySummary}
            quietHours={quietHours}
            quietHoursRangeLabel={quietHoursRangeLabel}
            quietHoursStartLabel={format24hTo12h(quietHoursStart)}
            quietHoursEndLabel={format24hTo12h(quietHoursEnd)}
            isUpdatingReminderPreference={isUpdatingReminderPreference}
            onToggleAllNotifications={() => {
              void handleAllNotificationsToggle();
            }}
            onSetWeeklyInsights={() => {
              void updateReminderType("weekly");
            }}
            onSetDailySummary={() => {
              void updateReminderType("daily");
            }}
            onToggleQuietHours={() => {
              void handleQuietHoursToggle();
            }}
            onOpenQuietHoursStart={() => openQuietHoursPicker("start")}
            onOpenQuietHoursEnd={() => openQuietHoursPicker("end")}
          />
        ) : null}

        {activeSection === "integrations" ? (
          <IntegrationsSection
            styles={styles}
            colors={c}
            supportedProviders={supportedProviders ?? []}
            isPreferencesMissing={preferences === null}
            autoSyncIntegrations={autoSyncIntegrations}
            onToggleAutoSyncIntegrations={() => {
              void handleAutoSyncIntegrationsToggle();
            }}
            integrationFeedback={integrationFeedback}
            providerList={providerList}
            integrationByProvider={integrationByProvider}
            integrationHealthByProvider={integrationHealthByProvider}
            syncRunByProvider={syncRunByProvider}
            providerPendingAction={providerPendingAction}
            integrationIcons={PROFILE_INTEGRATION_ICONS}
            integrationNames={PROFILE_INTEGRATION_NAMES}
            onShowAppleHealthSetup={handleShowAppleHealthSetup}
            onConnectIntegration={(provider) => {
              void handleConnectIntegration(provider);
            }}
            onDisconnectIntegration={(provider, integrationId) => {
              void handleDisconnectIntegration(provider, integrationId);
            }}
            onSyncIntegration={(provider) => {
              void handleSyncIntegration(provider);
            }}
          />
        ) : null}

        {activeSection === "account" ? (
          <AccountSection
            styles={styles}
            colors={c}
            onExportData={handleExportData}
            onSignOut={handleSignOut}
            onDeleteAccount={handleDeleteAccount}
            isRequestingAccountDeletion={isRequestingAccountDeletion}
            isFinalizingAccountDeletion={isFinalizingAccountDeletion}
            isAccountDeletionInProgress={isAccountDeletionInProgress}
            canRetryAccountDeletion={canRetryAccountDeletion}
            deletionState={deletionState as DeletionState}
            deletionStateLabel={deletionStateLabel}
            deletionStageLabel={deletionStageLabel}
            deletionProgressPercent={deletionProgressPercent}
            accountDeletionJobId={accountDeletionStatus?.job?.id}
            accountDeletionStatusMessage={accountDeletionStatusMessage}
          />
        ) : null}

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal transparent animationType="slide" visible={showAppPasswordModal}>
        <TouchableWithoutFeedback onPress={closeAppPasswordModal}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={styles.pickerContainer}>
                <View style={styles.pickerHeader}>
                  <TouchableOpacity onPress={closeAppPasswordModal}>
                    <Text style={styles.pickerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={styles.pickerTitle}>
                    {hasAppPassword
                      ? "Update App PIN/Password"
                      : "Set App PIN/Password"}
                  </Text>
                  <TouchableOpacity
                    onPress={handleSaveAppPassword}
                    disabled={isSavingAppPassword}
                  >
                    <Text
                      style={[
                        styles.pickerDoneText,
                        isSavingAppPassword ? { opacity: 0.65 } : null,
                      ]}
                    >
                      Save
                    </Text>
                  </TouchableOpacity>
                </View>

                <View
                  style={{
                    paddingHorizontal: Spacing.xl,
                    paddingBottom: Spacing.xl,
                    gap: Spacing.sm,
                  }}
                >
                  <Text style={styles.toggleSub}>
                    This PIN/password is stored securely and used when
                    biometrics are unavailable or locked out.
                  </Text>

                  <TextInput
                    value={appPasswordValue}
                    onChangeText={setAppPasswordValue}
                    placeholder="Enter PIN or password"
                    placeholderTextColor={c.textTertiary}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isSavingAppPassword}
                    style={{
                      borderWidth: 1,
                      borderColor: c.divider,
                      borderRadius: 10,
                      paddingHorizontal: Spacing.md,
                      paddingVertical: Spacing.sm,
                      color: c.text,
                      backgroundColor: c.background,
                    }}
                  />

                  <TextInput
                    value={appPasswordConfirmValue}
                    onChangeText={setAppPasswordConfirmValue}
                    placeholder="Confirm PIN or password"
                    placeholderTextColor={c.textTertiary}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isSavingAppPassword}
                    style={{
                      borderWidth: 1,
                      borderColor: c.divider,
                      borderRadius: 10,
                      paddingHorizontal: Spacing.md,
                      paddingVertical: Spacing.sm,
                      color: c.text,
                      backgroundColor: c.background,
                    }}
                  />

                  {appPasswordError ? (
                    <Text style={{ color: c.error }}>{appPasswordError}</Text>
                  ) : null}

                  <Pressable
                    onPress={handleSaveAppPassword}
                    disabled={isSavingAppPassword}
                    style={{
                      marginTop: Spacing.xs,
                      borderRadius: 10,
                      backgroundColor: c.tint,
                      paddingVertical: Spacing.sm,
                      alignItems: "center",
                      opacity: isSavingAppPassword ? 0.7 : 1,
                    }}
                  >
                    <Text
                      style={{
                        color: c.inverseText,
                        ...Typography.button,
                      }}
                    >
                      Save PIN/Password
                    </Text>
                  </Pressable>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

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
}
