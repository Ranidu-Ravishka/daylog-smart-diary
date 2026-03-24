import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Platform,
  Modal,
  TouchableWithoutFeedback,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { useAuth, useUser } from "@clerk/clerk-expo";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@repo/backend/convex";
import { FOCUS_AREAS, SETTINGS_DEFAULTS } from "@repo/ui/lib/constants";
import {
  ensureReminderPermissions,
  syncReminderNotifications,
} from "@/lib/reminder-notifications";

export default function QuickSetupScreen() {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { isAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const { user } = useUser();
  const syncUserPreferences = useMutation(
    api.userPreferences.syncMyUserPreferences,
  );
  const savedPreferences = useQuery(
    api.userPreferences.getMyUserPreferences,
    isAuthenticated ? {} : "skip",
  );
  const didPrefill = useRef(false);

  const [isSaving, setIsSaving] = useState(false);
  const [loadedFromSaved, setLoadedFromSaved] = useState(false);
  const [selectedFocus, setSelectedFocus] = useState<number[]>([]);
  const [reminderType, setReminderType] = useState<"daily" | "weekly" | null>(
    null,
  );
  const [dailyTime, setDailyTime] = useState(new Date());
  const [weeklyDay, setWeeklyDay] = useState("Sunday");
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showDayPicker, setShowDayPicker] = useState(false);
  const [, setPickerMode] = useState("time");

  // Initialize dates
  useEffect(() => {
    // Set initial daily time to 8:00 PM
    const initialDailyTime = new Date();
    initialDailyTime.setHours(20, 0, 0, 0);
    setDailyTime(initialDailyTime);
  }, []);

  // Redirect if not signed in
  useEffect(() => {
    if (!isSignedIn) {
      router.replace("/sign-in");
    }
  }, [isSignedIn, router]);

  // Auto-redirect to home if preferences already exist (onboarding complete)
  useEffect(() => {
    if (isConvexAuthLoading) return;
    if (!isAuthenticated) return;
    if (
      savedPreferences &&
      savedPreferences.focusAreas &&
      savedPreferences.focusAreas.length > 0
    ) {
      router.replace("/(tabs)");
    }
  }, [savedPreferences, router, isAuthenticated, isConvexAuthLoading]);

  useEffect(() => {
    if (didPrefill.current) return;
    if (!savedPreferences) return;

    setSelectedFocus(savedPreferences.focusAreas ?? []);
    setReminderType(savedPreferences.reminderType ?? null);
    setWeeklyDay(savedPreferences.weeklyDay ?? "Sunday");

    const parsed = new Date(savedPreferences.dailyTime);
    if (!Number.isNaN(parsed.getTime())) {
      setDailyTime(parsed);
    }

    setLoadedFromSaved(true);
    didPrefill.current = true;
  }, [savedPreferences]);

  const resetToDefaults = () => {
    setSelectedFocus([]);
    setReminderType(null);
    setWeeklyDay("Sunday");

    const initialDailyTime = new Date();
    initialDailyTime.setHours(20, 0, 0, 0);
    setDailyTime(initialDailyTime);

    setLoadedFromSaved(false);
  };

  const focusOptions = FOCUS_AREAS;

  const reminderOptions = [
    { id: "daily", label: "Daily summary at" },
    { id: "weekly", label: "Weekly insights on" },
  ];

  const daysOfWeek = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const handleFocusSelect = (id: number) => {
    if (selectedFocus.includes(id)) {
      setSelectedFocus(selectedFocus.filter((item) => item !== id));
    } else {
      setSelectedFocus([...selectedFocus, id]);
    }
  };

  const handleTimeChange = (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) => {
    if (Platform.OS === "android") {
      setShowTimePicker(false);
    }

    if (selectedDate) {
      setDailyTime(selectedDate);
    }
  };

  const handleDaySelect = (day: string) => {
    setWeeklyDay(day);
    setShowDayPicker(false);
  };

  const formatTime = (date: Date) => {
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";

    hours = hours % 12;
    hours = hours ? hours : 12; // Convert 0 to 12
    const minutesStr = String(minutes).padStart(2, "0");

    return `${hours}:${minutesStr} ${ampm}`;
  };

  const openTimePicker = () => {
    setPickerMode("time");
    if (Platform.OS === "ios") {
      setShowTimePicker(true);
    } else {
      setShowTimePicker(true);
    }
  };

  const openDayPicker = () => {
    if (Platform.OS === "ios") {
      setShowDayPicker(true);
    } else {
      setShowDayPicker(true);
    }
  };

  const handleContinue = async () => {
    if (!user) return;
    if (selectedFocus.length === 0 || reminderType === null) return;

    setIsSaving(true);
    try {
      const permissionStatus = await ensureReminderPermissions();
      const notificationsEnabled =
        permissionStatus === "granted"
          ? (savedPreferences?.notificationsEnabled ?? true)
          : false;

      if (permissionStatus !== "granted") {
        Alert.alert(
          "Notifications disabled",
          "Notifications are disabled on this device. You can enable them later in Settings.",
        );
      }

      const updatedPreferences = await syncUserPreferences({
        focusAreas: selectedFocus,
        reminderType,
        dailyTime: dailyTime.toISOString(),
        weeklyDay,
        formattedTime: formatTime(dailyTime),
        theme: savedPreferences?.theme ?? SETTINGS_DEFAULTS.theme,
        notificationsEnabled,
        dailySummaryEnabled:
          savedPreferences?.dailySummaryEnabled ?? reminderType === "daily",
        weeklyInsightsEnabled:
          savedPreferences?.weeklyInsightsEnabled ?? reminderType === "weekly",
        quietHoursEnabled:
          savedPreferences?.quietHoursEnabled ??
          SETTINGS_DEFAULTS.quietHoursEnabled,
        quietHoursStart:
          savedPreferences?.quietHoursStart ??
          SETTINGS_DEFAULTS.quietHoursStart,
        quietHoursEnd:
          savedPreferences?.quietHoursEnd ?? SETTINGS_DEFAULTS.quietHoursEnd,
        autoSyncIntegrations:
          savedPreferences?.autoSyncIntegrations ??
          SETTINGS_DEFAULTS.autoSyncIntegrations,
        defaultMemoryMood:
          savedPreferences?.defaultMemoryMood ??
          SETTINGS_DEFAULTS.defaultMemoryMood,
      });

      await syncReminderNotifications(updatedPreferences);

      router.replace("/(tabs)");
    } catch (error) {
      console.error("Failed to save user preferences", error);
      setIsSaving(false);
    }
  };

  const iconMap = {
    time: "time-outline",
    fitness: "fitness-outline",
    people: "people-outline",
    "trending-up": "trending-up-outline",
    compass: "compass-outline",
  } as const;

  const getIconName = (icon: string): keyof typeof Ionicons.glyphMap => {
    return iconMap[icon as keyof typeof iconMap] ?? "help-outline";
  };

  const isContinueEnabled =
    !isSaving && selectedFocus.length > 0 && reminderType !== null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        <ThemedView style={styles.container}>
          {/* Header Card */}
          <ThemedView style={styles.headerCard}>
            <ThemedText type="title" style={styles.headerTitle}>
              Quick Setup
            </ThemedText>
            <ThemedText type="default" style={styles.headerSubtitle}>
              What would you like to focus on?
            </ThemedText>

            {loadedFromSaved && (
              <View style={styles.savedHintRow}>
                <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                <ThemedText style={styles.savedHintText}>
                  Loaded your saved setup
                </ThemedText>
                <TouchableOpacity
                  onPress={resetToDefaults}
                  disabled={isSaving}
                  activeOpacity={0.7}
                >
                  <Text style={styles.resetText}>Reset</Text>
                </TouchableOpacity>
              </View>
            )}
          </ThemedView>

          {/* Focus Options */}
          <View style={styles.section}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Select your focus areas
            </ThemedText>
            <ThemedText type="default" style={styles.sectionSubtitle}>
              Choose one or more areas to personalize your experience
            </ThemedText>

            <View style={styles.optionsContainer}>
              {focusOptions.map((option) => (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.optionCard,
                    selectedFocus.includes(option.id) &&
                      styles.optionCardSelected,
                  ]}
                  onPress={() => handleFocusSelect(option.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.optionContent}>
                    <View
                      style={[
                        styles.iconContainer,
                        selectedFocus.includes(option.id) &&
                          styles.iconContainerSelected,
                      ]}
                    >
                      <Ionicons
                        name={getIconName(option.icon)}
                        size={20}
                        color={
                          selectedFocus.includes(option.id)
                            ? "#6366f1"
                            : "#94a3b8"
                        }
                      />
                    </View>
                    <ThemedText
                      style={[
                        styles.optionText,
                        selectedFocus.includes(option.id) &&
                          styles.optionTextSelected,
                      ]}
                    >
                      {option.label}
                    </ThemedText>
                  </View>

                  {selectedFocus.includes(option.id) && (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color="#6366f1"
                      style={styles.checkIcon}
                    />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Reminder Options */}
          <View style={styles.section}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Reminder Preferences
            </ThemedText>
            <ThemedText type="default" style={styles.sectionSubtitle}>
              How would you like to be reminded?
            </ThemedText>

            <View style={styles.optionsContainer}>
              {reminderOptions.map((option) => (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.reminderCard,
                    reminderType === option.id && styles.reminderCardSelected,
                  ]}
                  onPress={() =>
                    setReminderType(option.id as "daily" | "weekly")
                  }
                  activeOpacity={0.7}
                >
                  <View style={styles.reminderContent}>
                    <View style={styles.reminderTextContainer}>
                      <ThemedText
                        style={[
                          styles.reminderLabel,
                          reminderType === option.id &&
                            styles.reminderLabelSelected,
                        ]}
                      >
                        {option.label}
                      </ThemedText>

                      <TouchableOpacity
                        style={styles.timeDayButton}
                        onPress={
                          option.id === "daily" ? openTimePicker : openDayPicker
                        }
                        disabled={reminderType !== option.id}
                      >
                        <Text
                          style={[
                            styles.reminderValue,
                            reminderType !== option.id &&
                              styles.reminderValueDisabled,
                          ]}
                        >
                          {option.id === "daily"
                            ? formatTime(dailyTime)
                            : weeklyDay}
                        </Text>
                        {reminderType === option.id && (
                          <Ionicons
                            name="chevron-down"
                            size={16}
                            color="#6366f1"
                            style={styles.chevronIcon}
                          />
                        )}
                      </TouchableOpacity>
                    </View>

                    <View
                      style={[
                        styles.radioOuter,
                        reminderType === option.id && styles.radioOuterSelected,
                      ]}
                    >
                      {reminderType === option.id && (
                        <View style={styles.radioInner} />
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Continue Button */}
          <TouchableOpacity
            style={[
              styles.continueButton,
              !isContinueEnabled && styles.continueButtonDisabled,
            ]}
            onPress={handleContinue}
            disabled={!isContinueEnabled}
            activeOpacity={0.8}
          >
            <Text style={styles.continueButtonText}>
              {isSaving ? "Saving..." : "Continue"}
            </Text>
            <Ionicons name="arrow-forward" size={20} color="#ffffff" />
          </TouchableOpacity>

          {/* Skip for now */}
          <TouchableOpacity
            style={styles.skipButton}
            onPress={() => router.replace("/(tabs)")}
          >
            <ThemedText style={styles.skipText}>Skip for now</ThemedText>
          </TouchableOpacity>
        </ThemedView>
      </ScrollView>

      {/* Time Picker Modal (iOS) */}
      {showTimePicker && Platform.OS === "ios" && (
        <Modal
          transparent={true}
          animationType="slide"
          visible={showTimePicker}
        >
          <TouchableWithoutFeedback onPress={() => setShowTimePicker(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.pickerContainer}>
                <View style={styles.pickerHeader}>
                  <TouchableOpacity
                    style={styles.pickerCancelButton}
                    onPress={() => setShowTimePicker(false)}
                  >
                    <Text style={styles.pickerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={styles.pickerTitle}>Select Time</Text>
                  <TouchableOpacity
                    style={styles.pickerDoneButton}
                    onPress={() => setShowTimePicker(false)}
                  >
                    <Text style={styles.pickerDoneText}>Done</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={dailyTime}
                  mode="time"
                  display="spinner"
                  onChange={handleTimeChange}
                  style={styles.picker}
                  textColor="#000"
                />
              </View>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}

      {/* Day Picker Modal */}
      {showDayPicker && (
        <Modal transparent={true} animationType="fade" visible={showDayPicker}>
          <TouchableWithoutFeedback onPress={() => setShowDayPicker(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.dayPickerContainer}>
                <View style={styles.dayPickerHeader}>
                  <Text style={styles.dayPickerTitle}>Select Day</Text>
                  <TouchableOpacity
                    style={styles.dayPickerCloseButton}
                    onPress={() => setShowDayPicker(false)}
                  >
                    <Ionicons name="close" size={24} color="#6b7280" />
                  </TouchableOpacity>
                </View>

                <View style={styles.daysContainer}>
                  {daysOfWeek.map((day) => (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.dayButton,
                        weeklyDay === day && styles.dayButtonSelected,
                      ]}
                      onPress={() => handleDaySelect(day)}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          weeklyDay === day && styles.dayTextSelected,
                        ]}
                      >
                        {day}
                      </Text>
                      {weeklyDay === day && (
                        <Ionicons
                          name="checkmark"
                          size={20}
                          color="#6366f1"
                          style={styles.dayCheckIcon}
                        />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}

      {/* Android Time Picker */}
      {showTimePicker && Platform.OS === "android" && (
        <DateTimePicker
          value={dailyTime}
          mode="time"
          display="default"
          onChange={handleTimeChange}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingVertical: 24,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    maxWidth: 400,
    alignSelf: "center",
    width: "100%",
    borderRadius: 24,
  },
  headerCard: {
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    marginBottom: 32,
    backgroundColor: "transparent",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 22,
    opacity: 0.8,
  },
  savedHintRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  savedHintText: {
    fontSize: 13,
    opacity: 0.75,
  },
  resetText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6366f1",
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
    opacity: 0.7,
  },
  optionsContainer: {
    gap: 12,
  },
  optionCard: {
    borderRadius: 16,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderColor: "rgba(0,0,0,0.1)",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  optionCardSelected: {
    backgroundColor: "rgba(99, 102, 241, 0.1)",
    borderColor: "#6366f1",
  },
  optionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconContainerSelected: {
    backgroundColor: "rgba(99, 102, 241, 0.2)",
  },
  optionText: {
    fontSize: 16,
    fontWeight: "500",
    flex: 1,
  },
  optionTextSelected: {
    fontWeight: "600",
  },
  checkIcon: {
    marginLeft: 8,
  },
  reminderCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    borderColor: "rgba(0,0,0,0.1)",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  reminderCardSelected: {
    backgroundColor: "rgba(99, 102, 241, 0.1)",
    borderColor: "#6366f1",
  },
  reminderContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reminderTextContainer: {
    flex: 1,
  },
  reminderLabel: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 12,
  },
  reminderLabelSelected: {
    fontWeight: "600",
  },
  timeDayButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  reminderValue: {
    fontSize: 14,
    color: "#6366f1",
    fontWeight: "700",
    backgroundColor: "rgba(99, 102, 241, 0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 120,
  },
  reminderValueDisabled: {
    opacity: 0.5,
  },
  chevronIcon: {
    marginLeft: 8,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterSelected: {
    borderColor: "#6366f1",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#6366f1",
  },
  continueButton: {
    backgroundColor: "#0f172a",
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginTop: 8,
    marginBottom: 20,
  },
  continueButtonDisabled: {
    backgroundColor: "#cbd5e1",
    opacity: 0.6,
  },
  continueButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  skipButton: {
    alignItems: "center",
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 16,
    fontWeight: "500",
    opacity: 0.7,
  },
  // Time Picker Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  pickerContainer: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
  },
  pickerCancelButton: {
    padding: 8,
  },
  pickerCancelText: {
    fontSize: 16,
    color: "#6b7280",
  },
  pickerDoneButton: {
    padding: 8,
  },
  pickerDoneText: {
    fontSize: 16,
    color: "#6366f1",
    fontWeight: "600",
  },
  picker: {
    height: 200,
    width: "100%",
  },
  // Day Picker Styles
  dayPickerContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    marginHorizontal: 20,
    padding: 24,
    maxWidth: 400,
    alignSelf: "center",
    width: "100%",
  },
  dayPickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  dayPickerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#374151",
  },
  dayPickerCloseButton: {
    padding: 4,
  },
  daysContainer: {
    gap: 8,
  },
  dayButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
  },
  dayButtonSelected: {
    backgroundColor: "rgba(99, 102, 241, 0.1)",
    borderColor: "#6366f1",
  },
  dayText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#374151",
  },
  dayTextSelected: {
    color: "#6366f1",
    fontWeight: "600",
  },
  dayCheckIcon: {
    marginLeft: 8,
  },
});
