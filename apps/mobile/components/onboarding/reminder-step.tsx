import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn } from "react-native-reanimated";
import { Radius, Spacing, ThemeColors, Typography } from "@/constants/theme";

type ReminderType = "daily" | "weekly" | null;

type ReminderStepProps = {
  reminderType: ReminderType;
  dailyTime: Date;
  weeklyDay: string;
  onSelectReminderType: (value: "daily" | "weekly") => void;
  onOpenTimePicker: () => void;
  onSelectWeeklyDay: (day: string) => void;
  colors: ThemeColors;
};

const daysOfWeek = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function formatTime(date: Date): string {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${suffix}`;
}

export function ReminderStep({
  reminderType,
  dailyTime,
  weeklyDay,
  onSelectReminderType,
  onOpenTimePicker,
  onSelectWeeklyDay,
  colors,
}: ReminderStepProps) {
  return (
    <View>
      <Text style={[styles.title, { color: colors.text }]}>
        Set your reminder rhythm
      </Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Keep it light. You can always update this later in Profile.
      </Text>

      <View style={styles.stack}>
        {[
          {
            key: "daily" as const,
            label: "Daily summary",
            value: formatTime(dailyTime),
            icon: "time-outline" as const,
          },
          {
            key: "weekly" as const,
            label: "Weekly insights",
            value: weeklyDay,
            icon: "calendar-outline" as const,
          },
        ].map((option) => {
          const selected = reminderType === option.key;

          return (
            <Pressable
              key={option.key}
              onPress={() => onSelectReminderType(option.key)}
              style={({ pressed }) => [
                styles.card,
                {
                  borderColor: selected ? colors.tint : colors.border,
                  backgroundColor: selected ? colors.tintLight : colors.surface,
                  opacity: pressed ? 0.96 : 1,
                },
              ]}
            >
              <View style={styles.cardMain}>
                <View
                  style={[
                    styles.iconWrap,
                    {
                      backgroundColor: selected
                        ? colors.tintMuted
                        : colors.surfaceSecondary,
                    },
                  ]}
                >
                  <Ionicons
                    name={option.icon}
                    size={18}
                    color={selected ? colors.tint : colors.textSecondary}
                  />
                </View>

                <View style={styles.textWrap}>
                  <Text
                    style={[
                      styles.cardLabel,
                      { color: selected ? colors.text : colors.textSecondary },
                    ]}
                  >
                    {option.label}
                  </Text>
                  <Text style={[styles.cardValue, { color: colors.tint }]}>
                    {option.value}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.selectionDot,
                  {
                    borderColor: selected ? colors.tint : colors.border,
                    backgroundColor: selected ? colors.tint : "transparent",
                  },
                ]}
              >
                {selected ? (
                  <Ionicons
                    name="checkmark"
                    size={12}
                    color={colors.inverseText}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {reminderType === "daily" ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          style={styles.dynamicSection}
        >
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            Delivery time
          </Text>
          <Pressable
            onPress={onOpenTimePicker}
            style={({ pressed }) => [
              styles.valuePill,
              {
                backgroundColor: colors.tintLight,
                borderColor: colors.tintMuted,
                opacity: pressed ? 0.95 : 1,
              },
            ]}
          >
            <Ionicons name="time-outline" size={16} color={colors.tint} />
            <Text style={[styles.pillText, { color: colors.tint }]}>
              {formatTime(dailyTime)}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {reminderType === "weekly" ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          style={styles.dynamicSection}
        >
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            Preferred day
          </Text>
          <View style={styles.dayWrap}>
            {daysOfWeek.map((day) => {
              const active = weeklyDay === day;
              return (
                <Pressable
                  key={day}
                  onPress={() => onSelectWeeklyDay(day)}
                  style={({ pressed }) => [
                    styles.dayChip,
                    {
                      borderColor: active ? colors.tint : colors.border,
                      backgroundColor: active
                        ? colors.tintLight
                        : colors.surface,
                      opacity: pressed ? 0.95 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      { color: active ? colors.tint : colors.textSecondary },
                    ]}
                  >
                    {day.slice(0, 3)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      ) : null}

      <Text style={[styles.helper, { color: colors.textTertiary }]}>
        Minimal nudges, no noise.
      </Text>
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
    marginBottom: Spacing.xl,
  },
  stack: {
    gap: Spacing.md,
  },
  card: {
    borderWidth: 1,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  cardMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    flex: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
  },
  cardLabel: {
    ...Typography.bodyMedium,
    marginBottom: 2,
  },
  cardValue: {
    ...Typography.caption1,
  },
  selectionDot: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dynamicSection: {
    marginTop: Spacing.xl,
  },
  sectionLabel: {
    ...Typography.caption1,
    marginBottom: Spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  valuePill: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pillText: {
    ...Typography.callout,
    fontWeight: "600",
  },
  dayWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  dayChip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 52,
    alignItems: "center",
  },
  dayText: {
    ...Typography.caption1,
    fontWeight: "600",
  },
  helper: {
    ...Typography.caption2,
    marginTop: Spacing.lg,
    textAlign: "right",
  },
});
