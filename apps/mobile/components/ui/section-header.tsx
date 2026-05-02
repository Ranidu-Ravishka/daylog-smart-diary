import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Spacing, Typography, type ThemeColors } from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";

interface SectionHeaderProps {
  title: string;
  action?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, action, onAction }: SectionHeaderProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {action && onAction && (
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
      )}
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
    actionPressable: {
      opacity: 1,
    },
    actionPressablePressed: {
      opacity: 0.7,
    },
  });
}
