import { describe, expect, it } from "vitest";

import {
  formatRetentionDeletedCounts,
  normalizeRetentionDeletedCounts,
  sumRetentionDeletedCounts,
} from "../../../apps/admin/src/lib/retention-counts";

describe("retention admin aggregation behavior", () => {
  it("includes all retention counters in normalized totals", () => {
    const normalized = normalizeRetentionDeletedCounts({
      memories: 3,
      days: 4,
      daySummaries: 2,
      integrationDailyData: 5,
      integrationSyncRuns: 4,
      locationSignals: 1,
      summaryGenerationEvents: 6,
      summaryQualityEvaluations: 2,
      summaryGenerationQuotas: 3,
      infoEvents: 7,
      integrationHealthEvents: 8,
      auditLogs: 9,
      platformAuditEvents: 10,
      exportJobs: 11,
      restoreJobs: 12,
      userDeletionJobs: 13,
    });

    expect(normalized).toEqual({
      memories: 3,
      days: 4,
      daySummaries: 2,
      integrationDailyData: 5,
      integrationSyncRuns: 4,
      locationSignals: 1,
      summaryGenerationEvents: 6,
      summaryQualityEvaluations: 2,
      summaryGenerationQuotas: 3,
      infoEvents: 7,
      integrationHealthEvents: 8,
      auditLogs: 9,
      platformAuditEvents: 10,
      exportJobs: 11,
      restoreJobs: 12,
      userDeletionJobs: 13,
    });

    expect(sumRetentionDeletedCounts(normalized)).toBe(100);
  });

  it("handles null, missing, and invalid count values safely", () => {
    expect(sumRetentionDeletedCounts(undefined)).toBe(0);
    expect(sumRetentionDeletedCounts(null)).toBe(0);

    const weirdValues = {
      memories: Number.NaN,
      days: -1,
      daySummaries: -1,
      integrationDailyData: 2.9,
      integrationSyncRuns: 4.3,
      locationSignals: 0,
      summaryGenerationEvents: Number.POSITIVE_INFINITY,
      summaryQualityEvaluations: 5,
      summaryGenerationQuotas: -7,
      infoEvents: 1,
      integrationHealthEvents: undefined,
      auditLogs: 0,
      platformAuditEvents: 2,
      exportJobs: undefined,
      restoreJobs: 3,
      userDeletionJobs: Number.NaN,
    };

    expect(normalizeRetentionDeletedCounts(weirdValues)).toEqual({
      memories: 0,
      days: 0,
      daySummaries: 0,
      integrationDailyData: 2,
      integrationSyncRuns: 4,
      locationSignals: 0,
      summaryGenerationEvents: 0,
      summaryQualityEvaluations: 5,
      summaryGenerationQuotas: 0,
      infoEvents: 1,
      integrationHealthEvents: 0,
      auditLogs: 0,
      platformAuditEvents: 2,
      exportJobs: 0,
      restoreJobs: 3,
      userDeletionJobs: 0,
    });

    expect(formatRetentionDeletedCounts(weirdValues)).toBe(
      "memories=0, days=0, summaries=0, integration=2, syncRuns=4, location=0, summaryEvents=0, summaryQuality=5, summaryQuotas=0, infoEvents=1, healthEvents=0, auditLogs=0, platformAudit=2, exportJobs=0, restoreJobs=3, userDeletionJobs=0",
    );
  });
});
