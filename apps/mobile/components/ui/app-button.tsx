import React from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from "react-native";
import {
  Radius,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";

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
  const { colors: c } = useAppTheme();
  const styles = React.useMemo(() => createStyles(c), [c]);
  const isDisabled = disabled || loading;

  const bgMap = {
    primary: c.tint,
    secondary: c.surface,
    ghost: "transparent",
    danger: c.error,
  };

  const textColorMap = {
    primary: c.inverseText,
    secondary: c.text,
    ghost: c.tint,
    danger: c.inverseText,
  };

  const heightMap = { sm: 36, md: 44, lg: 52 };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: bgMap[variant],
          height: heightMap[size],
          opacity: isDisabled ? 0.5 : pressed ? 0.84 : 1,
          borderColor: c.border,
        },
        variant === "ghost" && styles.ghost,
        variant === "secondary" && styles.secondary,
        variant === "danger" && styles.danger,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
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
    </Pressable>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
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
      borderWidth: 0,
    },
    secondary: {
      borderWidth: 1,
    },
    danger: {
      borderWidth: 1,
      borderColor: c.text,
    },
    text: {
      ...Typography.bodyMedium,
      color: c.text,
    },
  });
}
