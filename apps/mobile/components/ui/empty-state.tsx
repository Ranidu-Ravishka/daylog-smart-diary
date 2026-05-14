import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
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
  /** When set, replaces the default circular icon (e.g. custom illustration). */
  illustration?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  illustration,
}: EmptyStateProps) {
  const { colors: c } = useAppTheme();
  const styles = React.useMemo(() => createStyles(c), [c]);

  return (
    <View style={styles.container}>
      {illustration ?? (
        <View style={[styles.iconCircle, { backgroundColor: c.tintLight }]}>
          <Ionicons name={icon} size={28} color={c.tint} />
        </View>
      )}
      <Text style={[styles.title, { color: c.text }]}>{title}</Text>
      {subtitle && (
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          {subtitle}
        </Text>
      )}
      {actionLabel && onAction && (
        <Pressable
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: c.tint },
            pressed && styles.buttonPressed,
          ]}
          onPress={onAction}
        >
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
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
      borderWidth: 1,
      borderColor: c.border,
    },
    buttonPressed: {
      opacity: 0.84,
    },
    buttonText: {
      ...Typography.bodyMedium,
      color: c.inverseText,
    },
  });
}
