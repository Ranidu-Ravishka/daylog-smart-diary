import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  FadeInDown,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useAuth, useUser } from "@clerk/clerk-expo";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@repo/backend/convex";
import { normalizeUserSettings } from "@repo/user-settings/lib/user-settings";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { FocusAreasStep } from "@/components/onboarding/focus-areas-step";
import { ReminderStep } from "@/components/onboarding/reminder-step";
import { FinishStep } from "@/components/onboarding/finish-step";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  ensureReminderPermissions,
  syncReminderNotifications,
} from "@/lib/reminder-notifications";
import { captureException } from "@/lib/observability";

const TOTAL_STEPS = 3;

export default function QuickSetupScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
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
  const buttonScale = useSharedValue(1);

  const [stepIndex, setStepIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [selectedFocus, setSelectedFocus] = useState<number[]>([]);
  const [reminderType, setReminderType] = useState<"daily" | "weekly" | null>(
    null,
  );
  const [weeklyDay, setWeeklyDay] = useState("Sunday");
  const [dailyTime, setDailyTime] = useState(() => {
    const initial = new Date();
    initial.setHours(20, 0, 0, 0);
    return initial;
  });
  const normalizedSavedSettings = useMemo(
    () => normalizeUserSettings(savedPreferences),
    [savedPreferences],
  );

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  useEffect(() => {
    if (!isSignedIn) {
      router.replace("/sign-in");
    }
  }, [isSignedIn, router]);

  useEffect(() => {
    if (isConvexAuthLoading || !isAuthenticated) return;
    if ((savedPreferences?.focusAreas?.length ?? 0) > 0) {
      router.replace("/(tabs)");
    }
  }, [savedPreferences, router, isAuthenticated, isConvexAuthLoading]);

  useEffect(() => {
    if (didPrefill.current || !savedPreferences) return;

    setSelectedFocus(savedPreferences.focusAreas ?? []);
    setReminderType(savedPreferences.reminderType ?? null);
    setWeeklyDay(savedPreferences.weeklyDay ?? "Sunday");

    const parsedTime = new Date(savedPreferences.dailyTime);
    if (!Number.isNaN(parsedTime.getTime())) {
      setDailyTime(parsedTime);
    }

    didPrefill.current = true;
  }, [savedPreferences]);

  const canContinue = useMemo(() => {
    if (stepIndex === 0) return selectedFocus.length > 0;
    if (stepIndex === 1) return reminderType !== null;
    return true;
  }, [stepIndex, selectedFocus.length, reminderType]);

  const primaryLabel =
    stepIndex === TOTAL_STEPS - 1
      ? isSaving
        ? "Finishing..."
        : "Finish Setup"
      : "Continue";

  const toggleFocusArea = (focusId: number) => {
    setSelectedFocus((prev) =>
      prev.includes(focusId)
        ? prev.filter((item) => item !== focusId)
        : [...prev, focusId],
    );
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

    if (event.type === "dismissed" && Platform.OS === "android") {
      setShowTimePicker(false);
    }
  };

  const formatTime = (date: Date) => {
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  };

  const handleFinishSetup = async () => {
    if (!user || selectedFocus.length === 0 || reminderType === null) return;

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
          "Notifications are off on this device. You can enable them later in Profile.",
        );
      }

      const updatedPreferences = await syncUserPreferences({
        focusAreas: selectedFocus,
        reminderType,
        dailyTime: dailyTime.toISOString(),
        weeklyDay,
        formattedTime: formatTime(dailyTime),
        theme: normalizedSavedSettings.theme,
        notificationsEnabled,
        dailySummaryEnabled:
          savedPreferences?.dailySummaryEnabled ?? reminderType === "daily",
        weeklyInsightsEnabled:
          savedPreferences?.weeklyInsightsEnabled ?? reminderType === "weekly",
        quietHoursEnabled:
          savedPreferences?.quietHoursEnabled ??
          normalizedSavedSettings.quietHoursEnabled,
        quietHoursStart:
          savedPreferences?.quietHoursStart ??
          normalizedSavedSettings.quietHoursStart,
        quietHoursEnd:
          savedPreferences?.quietHoursEnd ??
          normalizedSavedSettings.quietHoursEnd,
        autoSyncIntegrations:
          savedPreferences?.autoSyncIntegrations ??
          normalizedSavedSettings.autoSyncIntegrations,
        defaultMemoryMood:
          savedPreferences?.defaultMemoryMood ??
          normalizedSavedSettings.defaultMemoryMood,
      });

      await syncReminderNotifications(updatedPreferences);
      router.replace("/(tabs)");
    } catch (error) {
      captureException("mobile_quick_setup_complete_failed", error, {
        selectedFocusCount: selectedFocus.length,
        reminderType,
      });
      Alert.alert(
        "Setup failed",
        "We couldn’t save your preferences. Please try again.",
      );
      setIsSaving(false);
    }
  };

  const handlePrimaryPress = () => {
    if (stepIndex === TOTAL_STEPS - 1) {
      void handleFinishSetup();
      return;
    }

    setStepIndex((prev) => Math.min(prev + 1, TOTAL_STEPS - 1));
  };

  const handleBack = () => {
    if (stepIndex === 0) return;
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const renderStep = () => {
    if (stepIndex === 0) {
      return (
        <FocusAreasStep
          selectedFocus={selectedFocus}
          onToggleFocus={toggleFocusArea}
          colors={colors}
        />
      );
    }

    if (stepIndex === 1) {
      return (
        <ReminderStep
          reminderType={reminderType}
          dailyTime={dailyTime}
          weeklyDay={weeklyDay}
          onSelectReminderType={setReminderType}
          onOpenTimePicker={() => setShowTimePicker(true)}
          onSelectWeeklyDay={setWeeklyDay}
          colors={colors}
        />
      );
    }

    return (
      <FinishStep
        focusCount={selectedFocus.length}
        reminderType={reminderType}
        dailyTime={dailyTime}
        weeklyDay={weeklyDay}
        colors={colors}
      />
    );
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={[styles.stepCounter, { color: colors.textTertiary }]}>
            Quick Setup
          </Text>
          <Text style={[styles.stepCounter, { color: colors.textTertiary }]}>
            {stepIndex + 1}/{TOTAL_STEPS}
          </Text>
        </View>

        <View style={styles.dotsRow}>
          {Array.from({ length: TOTAL_STEPS }).map((_, index) => {
            const active = index === stepIndex;
            const completed = index < stepIndex;

            return (
              <View
                key={index}
                style={[
                  styles.dot,
                  {
                    width: active ? 22 : 8,
                    backgroundColor:
                      active || completed ? colors.tint : colors.border,
                  },
                ]}
              />
            );
          })}
        </View>

        <View
          style={[
            styles.contentCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Animated.View
              key={stepIndex}
              entering={FadeInDown.duration(220)}
              exiting={FadeOutUp.duration(170)}
            >
              {renderStep()}
            </Animated.View>
          </ScrollView>
        </View>

        <View style={styles.actionsWrap}>
          <View style={styles.actionRow}>
            <Pressable
              onPress={handleBack}
              disabled={stepIndex === 0 || isSaving}
              style={({ pressed }) => [
                styles.backButton,
                {
                  borderColor: colors.border,
                  opacity:
                    stepIndex === 0 || isSaving ? 0.4 : pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text
                style={[styles.backButtonText, { color: colors.textSecondary }]}
              >
                Back
              </Text>
            </Pressable>

            <Animated.View
              style={[styles.primaryButtonWrap, buttonAnimatedStyle]}
            >
              <Pressable
                onPress={handlePrimaryPress}
                disabled={!canContinue || isSaving}
                onPressIn={() => {
                  buttonScale.value = withTiming(0.985, { duration: 90 });
                }}
                onPressOut={() => {
                  buttonScale.value = withTiming(1, { duration: 90 });
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor:
                      canContinue && !isSaving ? colors.tint : colors.tintMuted,
                    opacity: pressed ? 0.95 : 1,
                  },
                ]}
              >
                <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
              </Pressable>
            </Animated.View>
          </View>

          <Pressable
            onPress={() => router.replace("/(tabs)")}
            disabled={isSaving}
            style={({ pressed }) => ({
              opacity: pressed || isSaving ? 0.7 : 1,
              alignSelf: "center",
            })}
          >
            <Text style={[styles.skipText, { color: colors.textTertiary }]}>
              Skip for now
            </Text>
          </Pressable>
        </View>
      </View>

      {showTimePicker && Platform.OS === "ios" ? (
        <Modal transparent animationType="slide" visible={showTimePicker}>
          <TouchableWithoutFeedback onPress={() => setShowTimePicker(false)}>
            <View
              style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
            >
              <View
                style={[
                  styles.pickerContainer,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.pickerHeader,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <Pressable onPress={() => setShowTimePicker(false)}>
                    <Text
                      style={[
                        styles.pickerAction,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Cancel
                    </Text>
                  </Pressable>
                  <Text style={[styles.pickerTitle, { color: colors.text }]}>
                    Select time
                  </Text>
                  <Pressable onPress={() => setShowTimePicker(false)}>
                    <Text style={[styles.pickerAction, { color: colors.tint }]}>
                      Done
                    </Text>
                  </Pressable>
                </View>

                <DateTimePicker
                  value={dailyTime}
                  mode="time"
                  display="spinner"
                  onChange={handleTimeChange}
                  style={styles.picker}
                  textColor={colorScheme === "dark" ? "#F8F9FA" : "#212529"}
                />
              </View>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      ) : null}

      {showTimePicker && Platform.OS === "android" ? (
        <DateTimePicker
          value={dailyTime}
          mode="time"
          display="default"
          onChange={handleTimeChange}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.sm,
  },
  stepCounter: {
    ...Typography.caption1,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  dot: {
    height: 8,
    borderRadius: Radius.full,
  },
  contentCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.xl,
    overflow: "hidden",
  },
  scrollContent: {
    padding: Spacing.xl,
    paddingBottom: Spacing["2xl"],
  },
  actionsWrap: {
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  backButton: {
    minWidth: 88,
    height: 46,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  backButtonText: {
    ...Typography.bodyMedium,
  },
  primaryButtonWrap: {
    flex: 1,
  },
  primaryButton: {
    height: 46,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    ...Typography.bodyMedium,
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  skipText: {
    ...Typography.caption1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  pickerContainer: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: "hidden",
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  pickerTitle: {
    ...Typography.bodyMedium,
  },
  pickerAction: {
    ...Typography.callout,
    fontWeight: "600",
  },
  picker: {
    height: 210,
    alignSelf: "stretch",
  },
});
