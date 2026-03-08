import React, { useEffect, useRef } from "react";
import { View, ViewStyle, Animated, StyleSheet } from "react-native";
import { Colors, Radius } from "@/constants/theme";

interface SkeletonProps {
  width: number | string;
  height: number;
  radius?: number;
  style?: ViewStyle;
}

export function Skeleton({
  width,
  height,
  radius = Radius.sm,
  style,
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius: radius,
          backgroundColor: Colors.light.skeleton,
          opacity,
        },
        style,
      ]}
    />
  );
}

interface SkeletonCardProps {
  lines?: number;
  style?: ViewStyle;
}

export function SkeletonCard({ lines = 3, style }: SkeletonCardProps) {
  return (
    <View style={[styles.card, style]}>
      <Skeleton width="60%" height={14} style={{ marginBottom: 16 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? "40%" : "100%"}
          height={12}
          style={{ marginBottom: i < lines - 1 ? 10 : 0 }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.surface,
    borderRadius: Radius.lg,
    padding: 20,
    marginBottom: 16,
  },
});
