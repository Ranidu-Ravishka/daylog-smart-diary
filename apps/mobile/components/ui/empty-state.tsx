import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Spacing,
  Typography,
  Radius,
  type ThemeColors,
} from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";

interface EmptyStateProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const { colors: c } = useAppTheme();
  const styles = React.useMemo(() => createStyles(c), [c]);

  return (
    <View style={styles.container}>
      <View style={[styles.iconCircle, { backgroundColor: c.tintLight }]}>
        <Ionicons name={icon} size={28} color={c.tint} />
      </View>
      <Text style={[styles.title, { color: c.text }]}>{title}</Text>
      {subtitle && (
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          {subtitle}
        </Text>
      )}
      {actionLabel && onAction && (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: c.tint }]}
          onPress={onAction}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      alignItems: "center",
      paddingVertical: Spacing["3xl"],
      paddingHorizontal: Spacing["2xl"],
    },
    iconCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.lg,
    },
    title: {
      ...Typography.title3,
      textAlign: "center",
      marginBottom: Spacing.xs,
    },
    subtitle: {
      ...Typography.callout,
      textAlign: "center",
      lineHeight: 20,
      maxWidth: 260,
    },
    button: {
      marginTop: Spacing.xl,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing["2xl"],
      borderRadius: Radius.md,
    },
    buttonText: {
      ...Typography.bodyMedium,
      color: "#fff",
    },
  });
}
