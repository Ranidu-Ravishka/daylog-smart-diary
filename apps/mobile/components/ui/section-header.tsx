import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Colors, Spacing, Typography } from "@/constants/theme";

interface SectionHeaderProps {
  title: string;
  action?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, action, onAction }: SectionHeaderProps) {
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

const c = Colors.light;

const styles = StyleSheet.create({
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
