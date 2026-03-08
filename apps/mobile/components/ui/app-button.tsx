import React from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from "react-native";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";

interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}

export function AppButton({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  style,
  textStyle,
  icon,
}: AppButtonProps) {
  const c = Colors.light;
  const isDisabled = disabled || loading;

  const bgMap = {
    primary: c.tint,
    secondary: c.tintLight,
    ghost: "transparent",
    danger: c.error,
  };

  const textColorMap = {
    primary: "#FFFFFF",
    secondary: c.tint,
    ghost: c.tint,
    danger: "#FFFFFF",
  };

  const heightMap = { sm: 36, md: 44, lg: 52 };

  return (
    <TouchableOpacity
      style={[
        styles.base,
        {
          backgroundColor: bgMap[variant],
          height: heightMap[size],
          opacity: isDisabled ? 0.5 : 1,
        },
        variant === "ghost" && styles.ghost,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator color={textColorMap[variant]} size="small" />
      ) : (
        <>
          {icon}
          <Text
            style={[
              styles.text,
              size === "sm" && Typography.caption1,
              size === "lg" && { fontSize: 16 },
              { color: textColorMap[variant] },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  ghost: {
    paddingHorizontal: Spacing.md,
  },
  text: {
    ...Typography.bodyMedium,
  },
});
