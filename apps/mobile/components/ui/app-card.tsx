import React from "react";
import { View, ViewStyle, StyleSheet } from "react-native";
import { Colors, Radius, Spacing, Shadows } from "@/constants/theme";

interface AppCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
}

export function AppCard({ children, style, padded = true }: AppCardProps) {
  return (
    <View style={[styles.card, padded && styles.padded, style]}>
      {children}
    </View>
  );
}

const c = Colors.light;

const styles = StyleSheet.create({
  card: {
    backgroundColor: c.surface,
    borderRadius: Radius.lg,
    ...Shadows.sm,
  },
  padded: {
    padding: Spacing.xl,
  },
});
