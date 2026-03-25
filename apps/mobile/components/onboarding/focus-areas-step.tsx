import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { FOCUS_AREAS } from "@repo/ui/lib/constants";
import { Radius, Spacing, ThemeColors, Typography } from "@/constants/theme";

type FocusAreasStepProps = {
  selectedFocus: number[];
  onToggleFocus: (focusId: number) => void;
  colors: ThemeColors;
};

const iconMap: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  time: "time-outline",
  fitness: "fitness-outline",
  people: "people-outline",
  "trending-up": "trending-up-outline",
  compass: "compass-outline",
};

export function FocusAreasStep({
  selectedFocus,
  onToggleFocus,
  colors,
}: FocusAreasStepProps) {
  return (
    <View>
      <Text style={[styles.title, { color: colors.text }]}>
        What matters most right now?
      </Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Pick one or more focus areas. We’ll tailor your daily insights around
        them.
      </Text>

      <View style={styles.stack}>
        {FOCUS_AREAS.map((area, index) => {
          const isSelected = selectedFocus.includes(area.id);
          return (
            <Animated.View
              key={area.id}
              entering={FadeInDown.delay(32 * index).duration(220)}
            >
              <Pressable
                onPress={() => onToggleFocus(area.id)}
                style={({ pressed }) => [
                  styles.card,
                  {
                    borderColor: isSelected ? colors.tint : colors.border,
                    backgroundColor: isSelected
                      ? colors.tintLight
                      : colors.surface,
                    opacity: pressed ? 0.95 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.iconWrap,
                    {
                      backgroundColor: isSelected
                        ? colors.tintMuted
                        : colors.surfaceSecondary,
                    },
                  ]}
                >
                  <Ionicons
                    name={iconMap[area.icon] ?? "sparkles-outline"}
                    size={18}
                    color={isSelected ? colors.tint : colors.textSecondary}
                  />
                </View>

                <Text
                  style={[
                    styles.cardLabel,
                    { color: isSelected ? colors.text : colors.textSecondary },
                  ]}
                >
                  {area.label}
                </Text>

                <View
                  style={[
                    styles.selectionDot,
                    {
                      borderColor: isSelected ? colors.tint : colors.border,
                      backgroundColor: isSelected ? colors.tint : "transparent",
                    },
                  ]}
                >
                  {isSelected ? (
                    <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                  ) : null}
                </View>
              </Pressable>
            </Animated.View>
          );
        })}
      </View>

      <Text style={[styles.helper, { color: colors.textTertiary }]}>
        {selectedFocus.length > 0
          ? `${selectedFocus.length} selected`
          : "Select at least one to continue"}
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
    gap: Spacing.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cardLabel: {
    ...Typography.bodyMedium,
    flex: 1,
  },
  selectionDot: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  helper: {
    ...Typography.caption1,
    marginTop: Spacing.md,
    textAlign: "right",
  },
});
