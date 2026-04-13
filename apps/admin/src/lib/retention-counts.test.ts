import { describe, expect, it } from "vitest";

import {
  buildRetentionCleanupStatusMessage,
  formatRetentionDeletedCounts,
  normalizeRetentionDeletedCounts,
  sumRetentionDeletedCounts,
} from "./retention-counts";

describe("retention UI logic", () => {
  it("normalizes invalid retention counters to zero", () => {
    const normalized = normalizeRetentionDeletedCounts({
      memories: 3.9,
      daySummaries: -2,
      integrationDailyData: Number.NaN,
      locationSignals: undefined,
      summaryGenerationEvents: 0,
      infoEvents: 2,
      exportJobs: 1,
    });

    expect(normalized).toEqual({
      memories: 3,
      daySummaries: 0,
      integrationDailyData: 0,
      locationSignals: 0,
      summaryGenerationEvents: 0,
      infoEvents: 2,
      exportJobs: 1,
    });
  });

  it("computes total deletes and formats details", () => {
    const counts = {
      memories: 1,
      daySummaries: 2,
      integrationDailyData: 3,
      locationSignals: 4,
      summaryGenerationEvents: 5,
      infoEvents: 6,
      exportJobs: 7,
    };

    expect(sumRetentionDeletedCounts(counts)).toBe(28);
    expect(formatRetentionDeletedCounts(counts)).toBe(
      "memories=1, summaries=2, integration=3, location=4, summaryEvents=5, infoEvents=6, exportJobs=7",
    );
  });

  it("builds dry-run and live cleanup status messages", () => {
    const counts = {
      memories: 4,
      daySummaries: 0,
      integrationDailyData: 1,
      locationSignals: 0,
      summaryGenerationEvents: 0,
      infoEvents: 0,
      exportJobs: 0,
    };

    expect(buildRetentionCleanupStatusMessage(counts, true)).toBe(
      "Dry run complete. 5 rows would be deleted.",
    );
    expect(buildRetentionCleanupStatusMessage(counts, false)).toBe(
      "Cleanup complete. Deleted 5 rows.",
    );
  });
});
