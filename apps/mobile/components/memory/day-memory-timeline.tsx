import React, { useCallback, useMemo } from "react";
import { View, Text, Pressable, Image, StyleSheet } from "react-native";
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
import type { DayTimelineEntry } from "@/lib/day-timeline";

type DayMemoryTimelineProps = {
  entries: DayTimelineEntry[];
  colors: ThemeColors;
  onOpenMemory: (memory: MemoryItem) => void;
  onPressNote: (index: number) => void;
};

function DayMemoryTimelineComponent({
  entries,
  colors,
  onOpenMemory,
  onPressNote,
}: DayMemoryTimelineProps) {
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.list} accessibilityRole="list">
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        return (
          <TimelineRow
            key={
              entry.kind === "memory"
                ? `m-${String(entry.memory._id)}`
                : `n-${entry.index}`
            }
            entry={entry}
            isLast={isLast}
            styles={styles}
            colors={colors}
            onOpenMemory={onOpenMemory}
            onPressNote={onPressNote}
          />
        );
      })}
    </View>
  );
}

export const DayMemoryTimeline = React.memo(DayMemoryTimelineComponent);

type RowStyles = ReturnType<typeof createStyles>;

type TimelineRowProps = {
  entry: DayTimelineEntry;
  isLast: boolean;
  styles: RowStyles;
  colors: ThemeColors;
  onOpenMemory: (memory: MemoryItem) => void;
  onPressNote: (index: number) => void;
};

function TimelineRowComponent({
  entry,
  isLast,
  styles,
  colors,
  onOpenMemory,
  onPressNote,
}: TimelineRowProps) {
  const handleMemoryPress = useCallback(() => {
    if (entry.kind === "memory") {
      onOpenMemory(entry.memory);
    }
  }, [entry, onOpenMemory]);

  const handleNotePress = useCallback(() => {
    if (entry.kind === "note") {
      onPressNote(entry.index);
    }
  }, [entry, onPressNote]);

  if (entry.kind === "note") {
    return (
      <View style={styles.row}>
        <View style={styles.rail}>
          <View style={[styles.railDot, styles.railDotNote]}>
            <Ionicons name="create-outline" size={12} color={colors.tint} />
          </View>
          {!isLast ? <View style={styles.railLine} /> : null}
        </View>
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={handleNotePress}
          accessibilityRole="button"
          accessibilityLabel={`Manual note: ${entry.text}. Opens edit or delete options.`}
        >
          <Text style={styles.notePillLabel}>Note</Text>
          <Text style={styles.cardTitle} numberOfLines={4}>
            {entry.text}
          </Text>
        </Pressable>
      </View>
    );
  }

  const { memory, timeLabel } = entry;
  const hasImage = Boolean(memory.thumbnailUrl);
  const moodLabel = memory.mood
    ? (MOOD_LABELS[memory.mood] ?? memory.mood)
    : null;

  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View
          style={[
            styles.railDot,
            hasImage ? styles.railDotImage : styles.railDotMemory,
          ]}
        >
          {hasImage ? (
            <Ionicons name="image-outline" size={12} color={colors.tint} />
          ) : memory.mood ? (
            <MoodEmoji mood={memory.mood} size={16} />
          ) : (
            <Ionicons name="bookmark-outline" size={12} color={colors.tint} />
          )}
        </View>
        {!isLast ? <View style={styles.railLine} /> : null}
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.card,
          hasImage && styles.cardMedia,
          pressed && styles.cardPressed,
        ]}
        onPress={handleMemoryPress}
        accessibilityRole="button"
        accessibilityLabel={`Memory at ${timeLabel}. ${memory.title ?? "Untitled"}. ${moodLabel ? `Mood ${moodLabel}.` : ""}`}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.timeLabel}>{timeLabel}</Text>
          {moodLabel ? (
            <Text style={styles.moodCaption}>{moodLabel}</Text>
          ) : null}
        </View>
        {hasImage ? (
          <View style={styles.mediaRow}>
            <Image
              source={{ uri: memory.thumbnailUrl ?? undefined }}
              style={styles.thumb}
            />
            <View style={styles.mediaTextCol}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {memory.title ?? "Untitled memory"}
              </Text>
              {memory.description ? (
                <Text style={styles.cardDesc} numberOfLines={2}>
                  {memory.description}
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {memory.title ?? "Untitled memory"}
            </Text>
            {memory.description ? (
              <Text style={styles.cardDesc} numberOfLines={3}>
                {memory.description}
              </Text>
            ) : null}
          </>
        )}
      </Pressable>
    </View>
  );
}

const TimelineRow = React.memo(TimelineRowComponent);

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    list: {
      paddingVertical: Spacing.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "stretch",
      gap: Spacing.md,
    },
    rail: {
      width: 28,
      alignItems: "center",
    },
    railDot: {
      width: 28,
      height: 28,
      borderRadius: Radius.full,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      marginTop: 4,
    },
    railDotMemory: {
      backgroundColor: c.tintLight,
      borderColor: c.border,
    },
    railDotImage: {
      backgroundColor: c.surfaceSecondary,
      borderColor: c.border,
    },
    railDotNote: {
      backgroundColor: c.tintLight,
      borderColor: c.tint,
    },
    railLine: {
      width: 2,
      flex: 1,
      marginTop: 4,
      minHeight: 12,
      backgroundColor: c.border,
      borderRadius: 1,
      opacity: 0.85,
    },
    card: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.lg,
      backgroundColor: c.surfaceSecondary,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
      marginBottom: Spacing.sm,
    },
    cardMedia: {
      backgroundColor: c.surface,
    },
    cardPressed: {
      opacity: 0.92,
      transform: [{ scale: 0.995 }],
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    timeLabel: {
      ...Typography.caption1,
      color: c.textSecondary,
      fontVariant: ["tabular-nums"],
    },
    moodCaption: {
      ...Typography.caption2,
      color: c.tint,
      ...Typography.label,
      flexShrink: 1,
      textAlign: "right",
    },
    notePillLabel: {
      ...Typography.caption2,
      color: c.tint,
      marginBottom: 4,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    cardTitle: {
      ...Typography.bodyMedium,
      color: c.text,
    },
    cardDesc: {
      ...Typography.callout,
      color: c.textSecondary,
      marginTop: 4,
    },
    mediaRow: {
      flexDirection: "row",
      gap: Spacing.md,
      alignItems: "flex-start",
    },
    thumb: {
      width: 72,
      height: 72,
      borderRadius: Radius.md,
      backgroundColor: c.surfaceSecondary,
    },
    mediaTextCol: {
      flex: 1,
      gap: 2,
    },
  });
}
