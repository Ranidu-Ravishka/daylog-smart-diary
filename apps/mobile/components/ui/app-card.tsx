import React from "react";
import { View, ViewStyle, StyleSheet } from "react-native";
import { Radius, Spacing, type ThemeColors } from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";

interface AppCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
}

export function AppCard({ children, style, padded = true }: AppCardProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[styles.card, padded && styles.padded, style]}>
      {children}
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: Radius.lg,
      shadowColor: c.cardShadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.18,
      shadowRadius: 3,
      elevation: 1,
    },
    padded: {
      padding: Spacing.xl,
    },
  });
}
