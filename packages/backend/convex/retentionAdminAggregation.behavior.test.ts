import { describe, expect, it } from "vitest";

import {
  formatRetentionDeletedCounts,
  normalizeRetentionDeletedCounts,
  sumRetentionDeletedCounts,
} from "../../../apps/admin/src/lib/retention-counts";

describe("retention admin aggregation behavior", () => {
  it("includes exportJobs and infoEvents in normalized totals", () => {
    const normalized = normalizeRetentionDeletedCounts({
      memories: 3,
      daySummaries: 2,
      integrationDailyData: 5,
      locationSignals: 1,
      summaryGenerationEvents: 4,
      infoEvents: 6,
      exportJobs: 7,
    });

    expect(normalized).toEqual({
      memories: 3,
      daySummaries: 2,
      integrationDailyData: 5,
      locationSignals: 1,
      summaryGenerationEvents: 4,
      infoEvents: 6,
      exportJobs: 7,
    });

    expect(sumRetentionDeletedCounts(normalized)).toBe(28);
  });

  it("handles null, missing, and invalid count values safely", () => {
    expect(sumRetentionDeletedCounts(undefined)).toBe(0);
    expect(sumRetentionDeletedCounts(null)).toBe(0);

    const weirdValues = {
      memories: Number.NaN,
      daySummaries: -1,
      integrationDailyData: 2.9,
      locationSignals: 0,
      summaryGenerationEvents: Number.POSITIVE_INFINITY,
      infoEvents: 1,
      exportJobs: undefined,
    };

    expect(normalizeRetentionDeletedCounts(weirdValues)).toEqual({
      memories: 0,
      daySummaries: 0,
      integrationDailyData: 2,
      locationSignals: 0,
      summaryGenerationEvents: 0,
      infoEvents: 1,
      exportJobs: 0,
    });

    expect(formatRetentionDeletedCounts(weirdValues)).toBe(
      "memories=0, summaries=0, integration=2, location=0, summaryEvents=0, infoEvents=1, exportJobs=0",
    );
  });
});
