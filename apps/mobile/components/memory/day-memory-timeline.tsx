import React, { useCallback, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
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
import {
  SwipeableManualNoteRow,
  type ManualNoteEditorBindings,
} from "@/components/memory/swipeable-manual-note-row";

export type { ManualNoteEditorBindings } from "@/components/memory/swipeable-manual-note-row";

const IMAGE_TRANSITION_MS = 200;

type DayMemoryTimelineProps = {
  entries: DayTimelineEntry[];
  colors: ThemeColors;
  onOpenMemory: (memory: MemoryItem) => void;
  /** Used when {@link manualNoteEditor} is not provided (legacy tap → sheet). */
  onPressNote?: (index: number) => void;
  /** When set, manual notes use swipe / inline edit instead of {@link onPressNote}. */
  manualNoteEditor?: ManualNoteEditorBindings;
};

function DayMemoryTimelineComponent({
  entries,
  colors,
  onOpenMemory,
  onPressNote,
  manualNoteEditor,
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
            manualNoteEditor={manualNoteEditor}
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
  onPressNote?: (index: number) => void;
  manualNoteEditor?: ManualNoteEditorBindings;
};

function TimelineRowComponent({
  entry,
  isLast,
  styles,
  colors,
  onOpenMemory,
  onPressNote,
  manualNoteEditor,
}: TimelineRowProps) {
  const handleMemoryPress = useCallback(() => {
    if (entry.kind === "memory") {
      onOpenMemory(entry.memory);
    }
  }, [entry, onOpenMemory]);

  const handleNotePress = useCallback(() => {
    if (entry.kind === "note" && onPressNote) {
      onPressNote(entry.index);
    }
  }, [entry, onPressNote]);

  if (entry.kind === "note") {
    const useSwipe = Boolean(manualNoteEditor);

    return (
      <View style={styles.row}>
        <View style={styles.rail}>
          <View style={[styles.railDot, styles.railDotNote]}>
            <Ionicons name="create-outline" size={12} color={colors.tint} />
          </View>
          {!isLast ? <View style={styles.railLine} /> : null}
        </View>
        {useSwipe && manualNoteEditor ? (
          <SwipeableManualNoteRow
            noteIndex={entry.index}
            noteText={entry.text}
            colors={colors}
            variant="timeline"
            isEditing={manualNoteEditor.editingIndex === entry.index}
            draft={manualNoteEditor.draft}
            onDraftChange={manualNoteEditor.onDraftChange}
            onBeginEdit={() => {
              manualNoteEditor.onBeginEdit(entry.index);
            }}
            onSave={manualNoteEditor.onSave}
            onCancel={manualNoteEditor.onCancel}
            onDelete={() => {
              manualNoteEditor.onDelete(entry.index);
            }}
            saveDisabled={manualNoteEditor.saveDisabled}
            saveLoading={manualNoteEditor.saveLoading}
          />
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.card,
              pressed && styles.cardPressed,
            ]}
            onPress={handleNotePress}
            accessibilityRole="button"
            accessibilityLabel={`Manual note: ${entry.text}. Opens edit or delete options.`}
          >
            <Text style={styles.cardTitle} numberOfLines={4}>
              {entry.text}
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  const { memory, timeLabel } = entry;
  const hasImage = Boolean(memory.thumbnailUrl);
  const moodLabel = memory.mood
    ? (MOOD_LABELS[memory.mood] ?? memory.mood)
    : null;

  const imageLabel =
    `Photo thumbnail${memory.title ? ` for ${memory.title}` : ""}`.trim();

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
              source={{ uri: memory.thumbnailUrl ?? "" }}
              style={styles.thumb}
              contentFit="cover"
              transition={IMAGE_TRANSITION_MS}
              cachePolicy="memory-disk"
              accessibilityLabel={imageLabel}
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
