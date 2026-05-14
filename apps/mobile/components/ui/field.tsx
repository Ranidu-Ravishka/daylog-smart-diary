import React from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { Spacing, Typography, type ThemeColors } from "@/constants/theme";

type FieldProps = {
  label: string;
  children: React.ReactNode;
  hint?: string;
  colors?: ThemeColors;
  style?: StyleProp<ViewStyle>;
};

export function Field({ label, children, hint, colors, style }: FieldProps) {
  return (
    <View style={[styles.wrap, style]}>
      <Text
        style={[
          styles.label,
          colors ? { color: colors.textSecondary } : undefined,
        ]}
      >
        {label}
      </Text>
      {children}
      {hint ? (
        <Text
          style={[
            styles.hint,
            colors ? { color: colors.textTertiary } : undefined,
          ]}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.xs,
  },
  label: {
    ...Typography.label,
    opacity: 0.85,
  },
  hint: {
    ...Typography.caption,
    opacity: 0.7,
  },
});
