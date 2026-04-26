import React from "react";
import { View, ViewStyle, StyleSheet } from "react-native";
import { Radius, Shadows, Spacing, type ThemeColors } from "@/constants/theme";
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
      borderWidth: 1,
      borderColor: c.border,
      ...(c.inverseText === "#FFFFFF" ? Shadows.md : {}),
      ...(c.inverseText === "#000000"
        ? {
            shadowColor: "transparent",
            elevation: 0,
          }
        : {}),
    },
    padded: {
      padding: Spacing.xl,
    },
  });
}
