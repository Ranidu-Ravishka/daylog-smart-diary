export type RetentionDeletedCounts = {
  memories?: number;
  daySummaries?: number;
  integrationDailyData?: number;
  locationSignals?: number;
  summaryGenerationEvents?: number;
  infoEvents?: number;
  exportJobs?: number;
};

export type NormalizedRetentionDeletedCounts = {
  memories: number;
  daySummaries: number;
  integrationDailyData: number;
  locationSignals: number;
  summaryGenerationEvents: number;
  infoEvents: number;
  exportJobs: number;
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
    daySummaries: toSafeCount(counts?.daySummaries),
    integrationDailyData: toSafeCount(counts?.integrationDailyData),
    locationSignals: toSafeCount(counts?.locationSignals),
    summaryGenerationEvents: toSafeCount(counts?.summaryGenerationEvents),
    infoEvents: toSafeCount(counts?.infoEvents),
    exportJobs: toSafeCount(counts?.exportJobs),
  };
}

export function sumRetentionDeletedCounts(
  counts: RetentionDeletedCounts | null | undefined,
): number {
  const normalized = normalizeRetentionDeletedCounts(counts);

  return (
    normalized.memories +
    normalized.daySummaries +
    normalized.integrationDailyData +
    normalized.locationSignals +
    normalized.summaryGenerationEvents +
    normalized.infoEvents +
    normalized.exportJobs
  );
}

export function formatRetentionDeletedCounts(
  counts: RetentionDeletedCounts | null | undefined,
): string {
  const normalized = normalizeRetentionDeletedCounts(counts);

  return [
    `memories=${normalized.memories}`,
    `summaries=${normalized.daySummaries}`,
    `integration=${normalized.integrationDailyData}`,
    `location=${normalized.locationSignals}`,
    `summaryEvents=${normalized.summaryGenerationEvents}`,
    `infoEvents=${normalized.infoEvents}`,
    `exportJobs=${normalized.exportJobs}`,
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
