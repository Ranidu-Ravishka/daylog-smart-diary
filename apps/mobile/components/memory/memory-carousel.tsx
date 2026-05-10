import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MOOD_LABELS } from "@repo/ui/lib/constants";
import {
  Radius,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";
import { MoodEmoji } from "@/components/ui/mood-emoji";
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
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView
      horizontal
      pagingEnabled
      decelerationRate="fast"
      snapToInterval={CARD_WIDTH + Spacing.md}
      snapToAlignment="start"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.carouselWrap}
    >
      {memories.map((memory) => (
        <MemoryCarouselCard
          key={memory._id}
          memory={memory}
          colors={colors}
          styles={styles}
          onOpen={onOpen}
        />
      ))}
    </ScrollView>
  );
}

type CarouselStyles = ReturnType<typeof createStyles>;

type MemoryCarouselCardProps = {
  memory: MemoryItem;
  colors: ThemeColors;
  styles: CarouselStyles;
  onOpen: (memory: MemoryItem) => void;
};

function MemoryCarouselCardComponent({
  memory,
  colors,
  styles,
  onOpen,
}: MemoryCarouselCardProps) {
  const hasImage = Boolean(memory.thumbnailUrl);
  const dateLabel = memory.happenedAt
    ? new Date(memory.happenedAt).toLocaleDateString()
    : null;
  const moodLabel = memory.mood
    ? (MOOD_LABELS[memory.mood] ?? memory.mood)
    : null;
  const handlePress = useCallback(() => {
    onOpen(memory);
  }, [memory, onOpen]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        !hasImage && styles.cardContentOnly,
        pressed && styles.cardPressed,
      ]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Open memory ${memory.title ?? "Untitled"}`}
    >
      {hasImage ? (
        <Image
          source={{ uri: memory.thumbnailUrl ?? undefined }}
          style={styles.image}
        />
      ) : null}

      <View style={styles.content}>
        {!hasImage && memory.mood ? (
          <View style={styles.moodBadge}>
            <MoodEmoji mood={memory.mood} size={22} />
          </View>
        ) : null}

        <Text
          style={[styles.title, !hasImage && styles.titleLarge]}
          numberOfLines={hasImage ? 1 : 2}
        >
          {memory.title ?? "Untitled memory"}
        </Text>

        {memory.description ? (
          <Text style={styles.description} numberOfLines={hasImage ? 2 : 4}>
            {memory.description}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          {moodLabel ? (
            <View style={styles.metaItem}>
              {hasImage && memory.mood ? (
                <MoodEmoji mood={memory.mood} size={14} />
              ) : (
                <Ionicons name="ellipse" size={6} color={colors.tint} />
              )}
              <Text style={styles.metaText}>{moodLabel}</Text>
            </View>
          ) : null}
          {dateLabel ? <Text style={styles.metaText}>{dateLabel}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const MemoryCarouselCard = React.memo(MemoryCarouselCardComponent);

const CARD_WIDTH = 280;
const IMAGE_HEIGHT = 130;

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    carouselWrap: {
      gap: Spacing.md,
      paddingRight: Spacing.xl,
    },
    card: {
      width: CARD_WIDTH,
      borderRadius: Radius.xl,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      overflow: "hidden",
    },
    cardContentOnly: {
      backgroundColor: c.surfaceSecondary,
      borderColor: c.border,
    },
    cardPressed: {
      opacity: 0.85,
      transform: [{ scale: 0.985 }],
    },
    image: {
      width: "100%",
      height: IMAGE_HEIGHT,
      backgroundColor: c.surfaceSecondary,
    },
    content: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.lg,
      gap: Spacing.xs,
    },
    moodBadge: {
      alignSelf: "flex-start",
      width: 36,
      height: 36,
      borderRadius: Radius.full,
      backgroundColor: c.tintLight,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.sm,
    },
    title: {
      ...Typography.bodyMedium,
      color: c.text,
    },
    titleLarge: {
      ...Typography.title3,
      color: c.text,
    },
    description: {
      ...Typography.callout,
      color: c.textSecondary,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: Spacing.sm,
      gap: Spacing.sm,
    },
    metaItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flexShrink: 1,
    },
    metaText: {
      ...Typography.caption2,
      color: c.textSecondary,
    },
  });
}
