export type RetentionDeletedCounts = {
  memories?: number;
  days?: number;
  daySummaries?: number;
  integrationDailyData?: number;
  integrationSyncRuns?: number;
  locationSignals?: number;
  summaryGenerationEvents?: number;
  summaryQualityEvaluations?: number;
  summaryGenerationQuotas?: number;
  infoEvents?: number;
  integrationHealthEvents?: number;
  auditLogs?: number;
  platformAuditEvents?: number;
  exportJobs?: number;
  restoreJobs?: number;
  userDeletionJobs?: number;
};

export type NormalizedRetentionDeletedCounts = {
  memories: number;
  days: number;
  daySummaries: number;
  integrationDailyData: number;
  integrationSyncRuns: number;
  locationSignals: number;
  summaryGenerationEvents: number;
  summaryQualityEvaluations: number;
  summaryGenerationQuotas: number;
  infoEvents: number;
  integrationHealthEvents: number;
  auditLogs: number;
  platformAuditEvents: number;
  exportJobs: number;
  restoreJobs: number;
  userDeletionJobs: number;
};

function toSafeCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  if (value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

export function normalizeRetentionDeletedCounts(
  counts: RetentionDeletedCounts | null | undefined,
): NormalizedRetentionDeletedCounts {
  return {
    memories: toSafeCount(counts?.memories),
    days: toSafeCount(counts?.days),
    daySummaries: toSafeCount(counts?.daySummaries),
    integrationDailyData: toSafeCount(counts?.integrationDailyData),
    integrationSyncRuns: toSafeCount(counts?.integrationSyncRuns),
    locationSignals: toSafeCount(counts?.locationSignals),
    summaryGenerationEvents: toSafeCount(counts?.summaryGenerationEvents),
    summaryQualityEvaluations: toSafeCount(counts?.summaryQualityEvaluations),
    summaryGenerationQuotas: toSafeCount(counts?.summaryGenerationQuotas),
    infoEvents: toSafeCount(counts?.infoEvents),
    integrationHealthEvents: toSafeCount(counts?.integrationHealthEvents),
    auditLogs: toSafeCount(counts?.auditLogs),
    platformAuditEvents: toSafeCount(counts?.platformAuditEvents),
    exportJobs: toSafeCount(counts?.exportJobs),
    restoreJobs: toSafeCount(counts?.restoreJobs),
    userDeletionJobs: toSafeCount(counts?.userDeletionJobs),
  };
}

export function sumRetentionDeletedCounts(
  counts: RetentionDeletedCounts | null | undefined,
): number {
  const normalized = normalizeRetentionDeletedCounts(counts);

  return (
    normalized.memories +
    normalized.days +
    normalized.daySummaries +
    normalized.integrationDailyData +
    normalized.integrationSyncRuns +
    normalized.locationSignals +
    normalized.summaryGenerationEvents +
    normalized.summaryQualityEvaluations +
    normalized.summaryGenerationQuotas +
    normalized.infoEvents +
    normalized.integrationHealthEvents +
    normalized.auditLogs +
    normalized.platformAuditEvents +
    normalized.exportJobs +
    normalized.restoreJobs +
    normalized.userDeletionJobs
  );
}

export function formatRetentionDeletedCounts(
  counts: RetentionDeletedCounts | null | undefined,
): string {
  const normalized = normalizeRetentionDeletedCounts(counts);

  return [
    `memories=${normalized.memories}`,
    `days=${normalized.days}`,
    `summaries=${normalized.daySummaries}`,
    `integration=${normalized.integrationDailyData}`,
    `syncRuns=${normalized.integrationSyncRuns}`,
    `location=${normalized.locationSignals}`,
    `summaryEvents=${normalized.summaryGenerationEvents}`,
    `summaryQuality=${normalized.summaryQualityEvaluations}`,
    `summaryQuotas=${normalized.summaryGenerationQuotas}`,
    `infoEvents=${normalized.infoEvents}`,
    `healthEvents=${normalized.integrationHealthEvents}`,
    `auditLogs=${normalized.auditLogs}`,
    `platformAudit=${normalized.platformAuditEvents}`,
    `exportJobs=${normalized.exportJobs}`,
    `restoreJobs=${normalized.restoreJobs}`,
    `userDeletionJobs=${normalized.userDeletionJobs}`,
  ].join(", ");
}

export function buildRetentionCleanupStatusMessage(
  counts: RetentionDeletedCounts | null | undefined,
  dryRun: boolean,
): string {
  const total = sumRetentionDeletedCounts(counts);

  if (dryRun) {
    return `Dry run complete. ${total} rows would be deleted.`;
  }

  return `Cleanup complete. Deleted ${total} rows.`;
}
