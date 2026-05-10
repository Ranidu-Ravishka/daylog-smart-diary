import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Radius, Spacing, type ThemeColors } from "@/constants/theme";

/**
 * Lightweight “premium empty” motif: soft rings + focal icon (no raster assets).
 */
export function MemoryEmptyIllustration({ colors }: { colors: ThemeColors }) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.wrap} accessibilityElementsHidden>
      <View style={styles.ringOuter} />
      <View style={styles.ringMid} />
      <View style={styles.iconBubble}>
        <Ionicons name="images-outline" size={26} color={colors.tint} />
      </View>
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      width: 112,
      height: 112,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.lg,
    },
    ringOuter: {
      position: "absolute",
      width: 112,
      height: 112,
      borderRadius: 56,
      borderWidth: 1,
      borderColor: c.border,
      opacity: 0.45,
    },
    ringMid: {
      position: "absolute",
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: c.tintLight,
      opacity: 0.55,
    },
    iconBubble: {
      width: 56,
      height: 56,
      borderRadius: Radius.full,
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
