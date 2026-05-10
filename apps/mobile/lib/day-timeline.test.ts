import { describe, expect, it } from "vitest";
import type { GenericId } from "convex/values";

import type { MemoryItem } from "@/components/memory/types";
import { buildDayTimelineEntries } from "@/lib/day-timeline";

function mem(overrides: {
  _id: string;
  title: string;
  happenedAt?: number;
}): MemoryItem {
  const { _id, ...rest } = overrides;
  return {
    ...rest,
    _id: _id as GenericId<"memories">,
  } as MemoryItem;
}

describe("buildDayTimelineEntries", () => {
  it("orders by happenedAt, then undated memories, then notes", () => {
    const entries = buildDayTimelineEntries(
      [
        mem({
          _id: "late",
          title: "Late",
          happenedAt: 3_600_000,
        }),
        mem({
          _id: "undated1",
          title: "Undated A",
        }),
        mem({
          _id: "early",
          title: "Early",
          happenedAt: 1_000_000,
        }),
      ],
      ["Note one", "Note two"],
    );

    expect(
      entries.map((e) => (e.kind === "memory" ? e.memory.title : e.text)),
    ).toEqual(["Early", "Late", "Undated A", "Note one", "Note two"]);
  });

  it("excludes notes when includeNotes is false", () => {
    const entries = buildDayTimelineEntries(
      [
        mem({
          _id: "a",
          title: "A",
          happenedAt: 5,
        }),
      ],
      ["Only note"],
      { includeNotes: false },
    );

    expect(entries.length).toBe(1);
    expect(entries[0]?.kind).toBe("memory");
  });
});
