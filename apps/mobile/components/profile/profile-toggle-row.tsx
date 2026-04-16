import React from "react";
import { View, Text, Switch } from "react-native";
import type { ThemeColors } from "@/constants/theme";
import type { ProfileStyles } from "./profile-styles";

type ProfileToggleRowProps = {
  styles: ProfileStyles;
  colors: ThemeColors;
  label: string;
  subtitle?: string;
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
  testID?: string;
};

export function ProfileToggleRow({
  styles,
  colors,
  label,
  subtitle,
  value,
  onToggle,
  disabled,
  testID,
}: ProfileToggleRowProps) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, disabled && { opacity: 0.45 }]}>
          {label}
        </Text>
        {subtitle ? <Text style={styles.toggleSub}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        testID={testID}
        trackColor={{ false: colors.border, true: colors.tint }}
        thumbColor={colors.surface}
      />
    </View>
  );
}
