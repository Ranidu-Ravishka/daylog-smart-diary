import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { MOOD_LABELS } from "@repo/ui/lib/constants";
import {
  Radius,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";
import { MoodEmoji } from "@/components/ui/mood-emoji";

type MoodDistributionBarProps = {
  mood: string;
  count: number;
  maxCount: number;
  index: number;
  colors: ThemeColors;
};

function MoodDistributionBarComponent({
  mood,
  count,
  maxCount,
  index,
  colors,
}: MoodDistributionBarProps) {
  const targetWidth = Math.max(0, Math.min(1, count / Math.max(maxCount, 1)));
  const widthRatio = useSharedValue(0);

  useEffect(() => {
    widthRatio.value = 0;
    widthRatio.value = withDelay(
      index * 90,
      withTiming(targetWidth, {
        duration: 620,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [targetWidth, widthRatio, index]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${widthRatio.value * 100}%`,
  }));

  const label =
    MOOD_LABELS[mood] ?? mood.charAt(0).toUpperCase() + mood.slice(1);

  return (
    <View style={styles.row} accessibilityRole="text">
      <View style={styles.emojiWrap}>
        <MoodEmoji mood={mood} size={20} />
      </View>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <View
        style={[
          styles.barOuter,
          {
            backgroundColor: colors.surfaceSecondary,
            borderColor: colors.border,
          },
        ]}
      >
        <Animated.View
          style={[styles.barInner, { backgroundColor: colors.tint }, fillStyle]}
        />
      </View>
      <Text style={[styles.count, { color: colors.textSecondary }]}>
        {count}
      </Text>
    </View>
  );
}

export const MoodDistributionBar = React.memo(MoodDistributionBarComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  emojiWrap: {
    width: 24,
    alignItems: "center",
  },
  label: {
    ...Typography.callout,
    width: 78,
  },
  barOuter: {
    flex: 1,
    height: 8,
    borderRadius: Radius.full,
    overflow: "hidden",
    borderWidth: 1,
  },
  barInner: {
    height: "100%",
    borderRadius: Radius.full,
  },
  count: {
    ...Typography.label,
    minWidth: 24,
    textAlign: "right",
  },
});
