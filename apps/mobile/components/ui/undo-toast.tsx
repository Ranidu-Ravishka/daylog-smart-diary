import React, { useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Animated } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Radius,
  Spacing,
  Typography,
  Shadows,
  type ThemeColors,
} from "@/constants/theme";
import { MotionTokens } from "@/constants/motion";
import { useReducedMotionPreference } from "@/hooks/use-reduced-motion";

type UndoToastProps = {
  visible: boolean;
  message: string;
  actionLabel: string;
  onUndo: () => void;
  onDismiss: () => void;
  colors: ThemeColors;
  /** Ms before auto-dismiss (undo window). */
  durationMs?: number;
};

/**
 * Bottom snack-style bar for undo flows. Positions above the home indicator.
 */
export function UndoToast({
  visible,
  message,
  actionLabel,
  onUndo,
  onDismiss,
  colors,
  durationMs = 5000,
}: UndoToastProps) {
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const reduceMotion = useReducedMotionPreference();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }

    if (!visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: reduceMotion ? 0 : MotionTokens.duration.quick,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 12,
          duration: reduceMotion ? 0 : MotionTokens.duration.quick,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: reduceMotion ? 0 : MotionTokens.duration.standard,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: reduceMotion ? 0 : MotionTokens.duration.standard,
        useNativeDriver: true,
      }),
    ]).start();

    dismissTimer.current = setTimeout(() => {
      onDismiss();
    }, durationMs);

    return () => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };
  }, [visible, durationMs, onDismiss, opacity, translateY, reduceMotion]);

  if (!visible) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          paddingBottom: Math.max(insets.bottom, Spacing.md),
          opacity,
          transform: [{ translateY }],
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
          Shadows.md,
        ]}
        accessibilityRole="alert"
      >
        <Text style={[styles.message, { color: colors.text }]}>{message}</Text>
        <Pressable
          onPress={onUndo}
          hitSlop={12}
          style={({ pressed }) => [
            styles.actionBtn,
            { opacity: pressed ? 0.85 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} deleted item`}
        >
          <Text style={[styles.actionText, { color: colors.tint }]}>
            {actionLabel}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function createStyles(_c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: Spacing.xl,
      alignItems: "center",
      zIndex: 50,
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: Spacing.md,
      width: "100%",
      maxWidth: 420,
      borderRadius: Radius.lg,
      borderWidth: 1,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
    },
    message: {
      ...Typography.callout,
      flex: 1,
    },
    actionBtn: {
      minWidth: 44,
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
    },
    actionText: {
      ...Typography.button,
    },
  });
}
