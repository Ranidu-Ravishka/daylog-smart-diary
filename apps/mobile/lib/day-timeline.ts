import { formatTimelineTime } from "@/lib/format-timeline-time";
import type { MemoryItem } from "@/components/memory/types";

/** Large sort key buckets undated memories; notes stack after undated memories. */
const UNDATED_MEMORY_BASE = 9_007_199_254_689_984; // ~2^53-safe margin
const NOTE_BASE = 9_007_199_254_740_991;

export type DayTimelineMemoryEntry = {
  kind: "memory";
  memory: MemoryItem;
  sortKey: number;
  timeLabel: string;
};

export type DayTimelineNoteEntry = {
  kind: "note";
  index: number;
  text: string;
  sortKey: number;
};

export type DayTimelineEntry = DayTimelineMemoryEntry | DayTimelineNoteEntry;

export function buildDayTimelineEntries(
  memories: MemoryItem[],
  manualNotes: string[],
  options?: {
    /** When filtering search/tags, omit notes so the feed matches filtered memories only. */
    includeNotes?: boolean;
  },
): DayTimelineEntry[] {
  const includeNotes = options?.includeNotes ?? true;

  const memoryEntries: DayTimelineMemoryEntry[] = memories.map((memory, i) => ({
    kind: "memory",
    memory,
    sortKey:
      typeof memory.happenedAt === "number"
        ? memory.happenedAt
        : UNDATED_MEMORY_BASE + i,
    timeLabel:
      typeof memory.happenedAt === "number"
        ? formatTimelineTime(memory.happenedAt)
        : "No time",
  }));

  const noteEntries: DayTimelineNoteEntry[] = includeNotes
    ? manualNotes.map((text, index) => ({
        kind: "note",
        index,
        text,
        sortKey: NOTE_BASE + index,
      }))
    : [];

  return [...memoryEntries, ...noteEntries].sort(
    (a, b) => a.sortKey - b.sortKey,
  );
}
