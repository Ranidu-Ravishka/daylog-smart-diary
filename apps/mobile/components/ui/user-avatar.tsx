import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Radius, Typography, type ThemeColors } from "@/constants/theme";

type UserAvatarProps = {
  colors: ThemeColors;
  name: string;
  imageUrl?: string | null;
  size?: number;
  editable?: boolean;
  onPress?: () => void;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function UserAvatar({
  colors,
  name,
  imageUrl,
  size = 48,
  editable = false,
  onPress,
}: UserAvatarProps) {
  const radius = size / 2;
  const initials = getInitials(name);
  const avatarContent = imageUrl ? (
    <Image
      source={{ uri: imageUrl }}
      style={{ width: size, height: size, borderRadius: radius }}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={120}
    />
  ) : (
    <View
      style={[
        styles.fallback,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: colors.tintLight,
        },
      ]}
    >
      <Text style={[styles.initials, { color: colors.tint }]}>{initials}</Text>
    </View>
  );

  const badgeSize = Math.max(16, Math.floor(size * 0.34));
  const badgeIconSize = Math.max(9, Math.floor(badgeSize * 0.52));

  if (!editable) {
    return avatarContent;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { width: size, height: size },
        pressed && styles.avatarPressablePressed,
      ]}
    >
      {avatarContent}
      <View
        style={[
          styles.editBadge,
          {
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            backgroundColor: colors.tint,
            borderColor: colors.background,
          },
        ]}
      >
        <Ionicons
          name="camera"
          size={badgeIconSize}
          color={colors.inverseText}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  initials: {
    ...Typography.bodyMedium,
    fontWeight: "700",
  },
  editBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: Radius.full,
  },
  avatarPressablePressed: {
    opacity: 0.82,
  },
});
