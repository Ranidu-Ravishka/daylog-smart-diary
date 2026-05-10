import React, { useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Platform,
} from "react-native";
import {
  Radius,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";
import { getTodayDayKey } from "@/lib/day-key";
import {
  formatDayOfMonth,
  formatMonthYearHeading,
  formatWeekdayLetter,
  getWeekDayKeysCentered,
} from "@/lib/journal-calendar";
import { selectionFeedback } from "@/lib/haptics";

type JournalDayStripProps = {
  selectedDayKey: string;
  onSelectDay: (dayKey: string) => void;
  colors: ThemeColors;
};

export const JournalDayStrip = React.memo(function JournalDayStrip({
  selectedDayKey,
  onSelectDay,
  colors: c,
}: JournalDayStripProps) {
  const styles = useMemo(() => createStyles(c), [c]);
  const weekKeys = useMemo(
    () => getWeekDayKeysCentered(selectedDayKey),
    [selectedDayKey],
  );
  const monthHeading = useMemo(
    () => formatMonthYearHeading(selectedDayKey),
    [selectedDayKey],
  );
  const todayKey = useMemo(() => getTodayDayKey(), []);

  const onDayPress = useCallback(
    (key: string) => {
      void selectionFeedback();
      onSelectDay(key);
    },
    [onSelectDay],
  );

  const jumpToday = useCallback(() => {
    void selectionFeedback();
    onSelectDay(todayKey);
  }, [onSelectDay, todayKey]);

  return (
    <View style={styles.wrap}>
      <View style={styles.headingRow}>
        <Text style={styles.monthLabel}>{monthHeading}</Text>
        <Pressable
          onPress={jumpToday}
          style={({ pressed }) => [
            styles.todayPill,
            {
              borderColor: c.border,
              backgroundColor: c.tintLight,
              opacity: pressed ? 0.88 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Jump to today"
          hitSlop={8}
        >
          <Text style={[styles.todayPillText, { color: c.tint }]}>Today</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stripContent}
      >
        {weekKeys.map((key) => {
          const selected = key === selectedDayKey;
          const isToday = key === todayKey;
          return (
            <Pressable
              key={key}
              onPress={() => onDayPress(key)}
              style={({ pressed }) => [
                styles.dayPill,
                {
                  borderColor: selected ? c.tint : c.border,
                  backgroundColor: selected ? c.tintLight : c.surfaceSecondary,
                  opacity: pressed ? 0.9 : 1,
                  ...(selected
                    ? Platform.select({
                        ios: {
                          shadowColor: c.tint,
                          shadowOpacity: 0.18,
                          shadowRadius: 6,
                          shadowOffset: { width: 0, height: 2 },
                        },
                        default: { elevation: 2 },
                      })
                    : null),
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${formatWeekdayLetter(key)} ${formatDayOfMonth(key)} ${selected ? ", selected" : ""}`}
              accessibilityState={{ selected }}
            >
              <Text
                style={[
                  styles.dow,
                  { color: selected ? c.tint : c.textSecondary },
                ]}
              >
                {formatWeekdayLetter(key)}
              </Text>
              <Text
                style={[
                  styles.dom,
                  { color: selected ? c.text : c.text },
                  isToday && !selected && { color: c.tint },
                ]}
              >
                {formatDayOfMonth(key)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
});

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      marginBottom: Spacing.lg,
      gap: Spacing.sm,
    },
    headingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    monthLabel: {
      ...Typography.title3,
      color: c.text,
    },
    todayPill: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      borderRadius: Radius.full,
      borderWidth: 1,
      minHeight: 36,
      justifyContent: "center",
    },
    todayPillText: {
      ...Typography.caption1,
    },
    stripContent: {
      gap: Spacing.sm,
      paddingVertical: 2,
    },
    dayPill: {
      width: 52,
      minHeight: 64,
      borderRadius: Radius.lg,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: Spacing.sm,
    },
    dow: {
      ...Typography.caption2,
      marginBottom: 2,
    },
    dom: {
      ...Typography.title3,
      fontVariant: ["tabular-nums"],
    },
  });
}
