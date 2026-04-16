import React from "react";
import {
  TouchableOpacity,
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
    secondary: c.tintLight,
    ghost: "transparent",
    danger: c.error,
  };

  const textColorMap = {
    primary: c.inverseText,
    secondary: c.tint,
    ghost: c.tint,
    danger: c.inverseText,
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
    },
    text: {
      ...Typography.bodyMedium,
      color: c.text,
    },
  });
}
