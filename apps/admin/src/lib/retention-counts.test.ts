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
      days: Number.NaN,
      daySummaries: -2,
      integrationDailyData: Number.NaN,
      integrationSyncRuns: 4.7,
      locationSignals: undefined,
      summaryGenerationEvents: 0,
      summaryQualityEvaluations: 1,
      summaryGenerationQuotas: -1,
      infoEvents: 2,
      integrationHealthEvents: 3,
      auditLogs: 2,
      platformAuditEvents: 1,
      exportJobs: 1,
      restoreJobs: 5,
      userDeletionJobs: Number.NaN,
    });

    expect(normalized).toEqual({
      memories: 3,
      days: 0,
      daySummaries: 0,
      integrationDailyData: 0,
      integrationSyncRuns: 4,
      locationSignals: 0,
      summaryGenerationEvents: 0,
      summaryQualityEvaluations: 1,
      summaryGenerationQuotas: 0,
      infoEvents: 2,
      integrationHealthEvents: 3,
      auditLogs: 2,
      platformAuditEvents: 1,
      exportJobs: 1,
      restoreJobs: 5,
      userDeletionJobs: 0,
    });
  });

  it("computes total deletes and formats details", () => {
    const counts = {
      memories: 1,
      days: 2,
      daySummaries: 3,
      integrationDailyData: 4,
      integrationSyncRuns: 5,
      locationSignals: 6,
      summaryGenerationEvents: 7,
      summaryQualityEvaluations: 8,
      summaryGenerationQuotas: 9,
      infoEvents: 10,
      integrationHealthEvents: 11,
      auditLogs: 12,
      platformAuditEvents: 13,
      exportJobs: 14,
      restoreJobs: 15,
      userDeletionJobs: 16,
    };

    expect(sumRetentionDeletedCounts(counts)).toBe(136);
    expect(formatRetentionDeletedCounts(counts)).toBe(
      "memories=1, days=2, summaries=3, integration=4, syncRuns=5, location=6, summaryEvents=7, summaryQuality=8, summaryQuotas=9, infoEvents=10, healthEvents=11, auditLogs=12, platformAudit=13, exportJobs=14, restoreJobs=15, userDeletionJobs=16",
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
