import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { INTEGRATION_PROVIDER_META } from "@repo/ui/lib/constants";
import { Radius, Spacing, ThemeColors, Typography } from "@/constants/theme";

type FinishStepProps = {
  focusCount: number;
  reminderType: "daily" | "weekly" | null;
  dailyTime: Date;
  weeklyDay: string;
  colors: ThemeColors;
};

function formatTime(date: Date): string {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${suffix}`;
}

const providerIcons: Record<
  string,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  google_calendar: "calendar-outline",
  google_fit: "walk-outline",
  gmail_summary: "mail-outline",
  spotify: "musical-notes-outline",
  apple_health: "heart-outline",
  apple_calendar: "calendar-number-outline",
  notion: "document-text-outline",
  slack: "chatbubbles-outline",
  strava: "bicycle-outline",
  todoist: "list-outline",
};

export function FinishStep({
  focusCount,
  reminderType,
  dailyTime,
  weeklyDay,
  colors,
}: FinishStepProps) {
  const reminderSummary =
    reminderType === "weekly"
      ? `Weekly on ${weeklyDay}`
      : `Daily at ${formatTime(dailyTime)}`;

  return (
    <View>
      <Text style={[styles.title, { color: colors.text }]}>
        You’re all set ✨
      </Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        DayLog is now personalized. Finish setup to open your dashboard.
      </Text>

      <View
        style={[
          styles.summaryCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.summaryRow}>
          <Ionicons name="sparkles-outline" size={16} color={colors.tint} />
          <Text style={[styles.summaryText, { color: colors.textSecondary }]}>
            {focusCount} focus area{focusCount === 1 ? "" : "s"} selected
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Ionicons
            name="notifications-outline"
            size={16}
            color={colors.tint}
          />
          <Text style={[styles.summaryText, { color: colors.textSecondary }]}>
            {reminderSummary}
          </Text>
        </View>
      </View>

      <Text style={[styles.integrationLabel, { color: colors.textTertiary }]}>
        Connect anytime in Profile
      </Text>
      <View style={styles.integrationStack}>
        {Object.entries(INTEGRATION_PROVIDER_META).map(
          ([provider, meta], index) => (
            <Animated.View
              key={provider}
              entering={FadeInDown.delay(index * 32).duration(210)}
            >
              <View
                style={[
                  styles.integrationCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.integrationIcon,
                    { backgroundColor: colors.surfaceSecondary },
                  ]}
                >
                  <Ionicons
                    name={providerIcons[provider] ?? "link-outline"}
                    size={16}
                    color={colors.textSecondary}
                  />
                </View>

                <View style={styles.integrationTextWrap}>
                  <Text
                    style={[styles.integrationTitle, { color: colors.text }]}
                  >
                    {meta.label}
                  </Text>
                  <Text
                    style={[
                      styles.integrationDescription,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {meta.description}
                  </Text>
                </View>

                <Text
                  style={[styles.integrationAction, { color: colors.tint }]}
                >
                  Later
                </Text>
              </View>
            </Animated.View>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    ...Typography.title1,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.callout,
    marginBottom: Spacing.lg,
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: Radius.xl,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  summaryText: {
    ...Typography.callout,
  },
  integrationLabel: {
    ...Typography.caption2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  integrationStack: {
    gap: Spacing.sm,
  },
  integrationCard: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  integrationIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  integrationTextWrap: {
    flex: 1,
  },
  integrationTitle: {
    ...Typography.bodyMedium,
    marginBottom: 2,
  },
  integrationDescription: {
    ...Typography.caption2,
  },
  integrationAction: {
    ...Typography.caption1,
    fontWeight: "600",
  },
});
