import React from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MOOD_EMOJI, MOOD_LABELS } from "@repo/ui/lib/constants";
import {
  Radius,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";
import type { MemoryItem } from "@/components/memory/types";

type MemoryCarouselProps = {
  colors: ThemeColors;
  memories: MemoryItem[];
  onOpen: (memory: MemoryItem) => void;
};

export function MemoryCarousel({
  colors,
  memories,
  onOpen,
}: MemoryCarouselProps) {
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView
      horizontal
      pagingEnabled
      decelerationRate="fast"
      snapToInterval={280}
      snapToAlignment="start"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.carouselWrap}
    >
      {memories.map((memory) => (
        <Pressable
          key={memory._id}
          style={styles.card}
          onPress={() => onOpen(memory)}
          accessibilityRole="button"
          accessibilityLabel={`Open memory ${memory.title}`}
        >
          {memory.thumbnailUrl ? (
            <Image source={{ uri: memory.thumbnailUrl }} style={styles.image} />
          ) : (
            <View style={styles.imageFallback}>
              <Ionicons name="images-outline" size={20} color={colors.tint} />
            </View>
          )}
          <View style={styles.content}>
            <Text style={styles.title} numberOfLines={1}>
              {memory.title ?? "Untitled memory"}
            </Text>
            {memory.description ? (
              <Text style={styles.description} numberOfLines={2}>
                {memory.description}
              </Text>
            ) : null}
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>
                {MOOD_EMOJI[memory.mood ?? ""] ?? "📝"}{" "}
                {memory.mood
                  ? (MOOD_LABELS[memory.mood] ?? memory.mood)
                  : "memory"}
              </Text>
              {memory.happenedAt ? (
                <Text style={styles.metaText}>
                  {new Date(memory.happenedAt).toLocaleDateString()}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    carouselWrap: {
      gap: Spacing.md,
      paddingRight: Spacing.xl,
    },
    card: {
      width: 270,
      borderRadius: Radius.xl,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      overflow: "hidden",
    },
    image: {
      width: "100%",
      height: 110,
      backgroundColor: c.surfaceSecondary,
    },
    imageFallback: {
      width: "100%",
      height: 110,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.tintLight,
    },
    content: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
      gap: Spacing.xs,
    },
    title: {
      ...Typography.bodyMedium,
      color: c.text,
    },
    description: {
      ...Typography.callout,
      color: c.textSecondary,
    },
    metaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: Spacing.xs,
    },
    metaText: {
      ...Typography.caption2,
      color: c.textSecondary,
    },
  });
}
