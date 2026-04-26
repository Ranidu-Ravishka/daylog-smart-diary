import { describe, expect, it } from "vitest";
import { buildRuleBasedSummary } from "./summaryFallback";

describe("summaryFallback.buildRuleBasedSummary", () => {
  it("never returns an empty UI even when there is no input at all", () => {
    const output = buildRuleBasedSummary({
      dayKey: "2026-04-24",
      memories: [],
      dayMetadata: {},
      integrationContext: {
        providers: [],
        keySignals: [],
        sources: [],
      },
    });

    expect(output.story.length).toBeGreaterThan(0);
    expect(output.sourcesUsed).toContain("Deterministic fallback");
    // Highlights can be empty when we truly have nothing, but the story
    // must always be a non-empty helpful line.
    expect(output.story.toLowerCase()).toMatch(
      /quiet day|minimal activity|fresh chapter/,
    );
  });

  it("summarizes memory count and integration metrics without LLM input", () => {
    const output = buildRuleBasedSummary({
      dayKey: "2026-04-24",
      memories: [
        { title: "Morning coffee", mood: "happy", happenedAt: 1 },
        { title: "Team standup", mood: "focused", happenedAt: 2 },
        { title: "Gym", mood: "happy", happenedAt: 3 },
      ],
      dayMetadata: { rating: 4.5, manualNotes: ["Great focus day"] },
      integrationContext: {
        providers: ["apple_health"],
        keySignals: ["Completed 8,500 steps"],
        mergedMetrics: { steps: 8500, sleepMinutes: 450 },
        sources: ["Apple Health"],
      },
    });

    expect(output.story).toMatch(/3 memorable moments/);
    expect(output.story).toMatch(/4\.5\/5/);
    expect(output.story.toLowerCase()).toMatch(/happy/);
    expect(output.story).not.toMatch(/connected data/i);
    expect(output.highlights.length).toBeGreaterThanOrEqual(3);
    expect(output.metrics?.steps).toBe(8500);
    expect(output.sourcesUsed).toEqual([
      "Deterministic fallback",
      "Apple Health",
    ]);
  });

  it("caps highlights at 5 and truncates very long titles", () => {
    const longTitle = "a".repeat(200);
    const output = buildRuleBasedSummary({
      dayKey: "2026-04-24",
      memories: Array.from({ length: 10 }, (_, index) => ({
        title: `${longTitle}-${index}`,
        happenedAt: index,
      })),
      dayMetadata: {},
      integrationContext: {
        providers: [],
        keySignals: [],
        sources: [],
      },
    });

    expect(output.highlights.length).toBeLessThanOrEqual(5);
    for (const highlight of output.highlights) {
      expect(highlight.length).toBeLessThanOrEqual(80);
    }
  });

  it("is deterministic for the same input", () => {
    const build = () =>
      buildRuleBasedSummary({
        dayKey: "2026-04-24",
        memories: [{ title: "A", mood: "calm", happenedAt: 1 }],
        dayMetadata: { rating: 3 },
        integrationContext: {
          providers: ["apple_health"],
          keySignals: ["signal"],
          mergedMetrics: { steps: 1000 },
          sources: ["Apple Health"],
        },
      });
    expect(build()).toEqual(build());
  });
});
