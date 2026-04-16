import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
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
        <TouchableOpacity onPress={onAction} hitSlop={8}>
          <Text style={styles.action}>{action}</Text>
        </TouchableOpacity>
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
      ...Typography.callout,
      color: c.tint,
      fontWeight: "500",
    },
  });
}
