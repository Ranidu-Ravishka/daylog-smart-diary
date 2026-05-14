import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Spacing, Typography, type ThemeColors } from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";

interface SectionHeaderProps {
  title: string;
  /** Optional right-side caption when not using a tappable action. */
  action?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, action, onAction }: SectionHeaderProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  const rightSide =
    action && onAction ? (
      <Pressable
        onPress={onAction}
        hitSlop={8}
        style={({ pressed }) => [
          styles.actionPressable,
          pressed && styles.actionPressablePressed,
        ]}
      >
        <Text style={styles.action}>{action}</Text>
      </Pressable>
    ) : action ? (
      <Text style={styles.actionCaption}>{action}</Text>
    ) : null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {rightSide}
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: Spacing.md,
    },
    title: {
      ...Typography.title3,
      color: c.text,
    },
    action: {
      ...Typography.button,
      color: c.tint,
    },
    actionCaption: {
      ...Typography.caption2,
      color: c.textSecondary,
      textAlign: "right",
      flexShrink: 1,
      marginLeft: Spacing.md,
    },
    actionPressable: {
      opacity: 1,
    },
    actionPressablePressed: {
      opacity: 0.7,
    },
  });
}
