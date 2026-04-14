import { afterEach, describe, expect, it } from "vitest";

import {
  getBackgroundLocationBatchFlushIntervalMinutes,
  getBackgroundLocationBatchMaxPoints,
  getBackgroundLocationMaxBatteryDrainPercentPerHour,
  getBackgroundLocationMaxUpdatesPerHour,
  getEnableBackgroundLocationTracking,
  getExportJobRetentionDays,
  getRestoreJobRetentionDays,
  getRetentionDeleteBatchSize,
  getRetentionPolicyDefaults,
  getSummaryDailyGenerationLimit,
  getSummaryLowQualityThreshold,
} from "./runtimeConfig";

const runtimeEnvKeys = [
  "SUMMARY_DAILY_GENERATION_LIMIT",
  "RETENTION_MEMORIES_DAYS",
  "RETENTION_DAYS_RECORDS_DAYS",
  "RETENTION_DAY_SUMMARIES_DAYS",
  "RETENTION_INTEGRATION_DATA_DAYS",
  "RETENTION_LOCATION_SIGNALS_DAYS",
  "RETENTION_SUMMARY_EVENTS_DAYS",
  "RETENTION_INFO_EVENTS_DAYS",
  "RETENTION_EXPORT_JOBS_DAYS",
  "RETENTION_RESTORE_JOBS_DAYS",
  "RETENTION_SYNC_RUNS_DAYS",
  "RETENTION_SUMMARY_QUOTAS_DAYS",
  "RETENTION_SUMMARY_QUALITY_DAYS",
  "RETENTION_HEALTH_EVENTS_DAYS",
  "RETENTION_AUDIT_LOGS_DAYS",
  "RETENTION_PLATFORM_AUDIT_DAYS",
  "RETENTION_USER_DELETION_JOBS_DAYS",
  "RETENTION_DELETE_BATCH_SIZE",
  "SUMMARY_LOW_QUALITY_THRESHOLD",
  "ENABLE_BACKGROUND_LOCATION_TRACKING",
  "BACKGROUND_LOCATION_BATCH_MAX_POINTS",
  "BG_LOC_MAX_UPDATES_PER_HOUR",
  "BG_LOC_BATCH_FLUSH_INTERVAL_MIN",
  "BG_LOC_MAX_BATTERY_DRAIN_PCT_PER_HR",
] as const;

const baselineEnv = Object.fromEntries(
  runtimeEnvKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof runtimeEnvKeys)[number], string | undefined>;

afterEach(() => {
  for (const key of runtimeEnvKeys) {
    const value = baselineEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("runtime config behavior", () => {
  it("handles summary daily generation limit defaults and validation", () => {
    delete process.env.SUMMARY_DAILY_GENERATION_LIMIT;
    expect(getSummaryDailyGenerationLimit()).toBe(5);

    process.env.SUMMARY_DAILY_GENERATION_LIMIT = "0";
    expect(getSummaryDailyGenerationLimit()).toBe(5);

    process.env.SUMMARY_DAILY_GENERATION_LIMIT = "12";
    expect(getSummaryDailyGenerationLimit()).toBe(12);
  });

  it("parses retention defaults with bounds and fallbacks", () => {
    process.env.RETENTION_MEMORIES_DAYS = "365";
    process.env.RETENTION_DAYS_RECORDS_DAYS = "150";
    process.env.RETENTION_DAY_SUMMARIES_DAYS = "invalid";
    process.env.RETENTION_INTEGRATION_DATA_DAYS = "120";
    process.env.RETENTION_LOCATION_SIGNALS_DAYS = "-1";
    process.env.RETENTION_SUMMARY_EVENTS_DAYS = "30";
    process.env.RETENTION_INFO_EVENTS_DAYS = "45";
    process.env.RETENTION_EXPORT_JOBS_DAYS = "21";
    process.env.RETENTION_RESTORE_JOBS_DAYS = "35";
    process.env.RETENTION_SYNC_RUNS_DAYS = "75";
    process.env.RETENTION_SUMMARY_QUOTAS_DAYS = "120";
    process.env.RETENTION_SUMMARY_QUALITY_DAYS = "50";
    process.env.RETENTION_HEALTH_EVENTS_DAYS = "70";
    process.env.RETENTION_AUDIT_LOGS_DAYS = "400";
    process.env.RETENTION_PLATFORM_AUDIT_DAYS = "95";
    process.env.RETENTION_USER_DELETION_JOBS_DAYS = "140";

    const defaults = getRetentionPolicyDefaults();

    expect(defaults.memories.retentionDays).toBe(365);
    expect(defaults.days.retentionDays).toBe(150);
    expect(defaults.daySummaries.retentionDays).toBe(90);
    expect(defaults.integrationDailyData.retentionDays).toBe(120);
    expect(defaults.locationSignals.retentionDays).toBe(30);
    expect(defaults.summaryGenerationEvents.retentionDays).toBe(30);
    expect(defaults.summaryQualityEvaluations.retentionDays).toBe(50);
    expect(defaults.summaryGenerationQuotas.retentionDays).toBe(120);
    expect(defaults.infoEvents.retentionDays).toBe(45);
    expect(defaults.integrationSyncRuns.retentionDays).toBe(75);
    expect(defaults.integrationHealthEvents.retentionDays).toBe(70);
    expect(defaults.auditLogs.retentionDays).toBe(400);
    expect(defaults.platformAuditEvents.retentionDays).toBe(95);
    expect(defaults.userDeletionJobs.retentionDays).toBe(140);
    expect(defaults.exportJobs.retentionDays).toBe(21);
    expect(defaults.restoreJobs.retentionDays).toBe(35);
    expect(getExportJobRetentionDays()).toBe(21);
    expect(getRestoreJobRetentionDays()).toBe(35);
  });

  it("enforces numeric bounds for batch size and quality threshold", () => {
    process.env.RETENTION_DELETE_BATCH_SIZE = "9999";
    expect(getRetentionDeleteBatchSize()).toBe(200);

    process.env.RETENTION_DELETE_BATCH_SIZE = "500";
    expect(getRetentionDeleteBatchSize()).toBe(500);

    process.env.SUMMARY_LOW_QUALITY_THRESHOLD = "2";
    expect(getSummaryLowQualityThreshold()).toBe(0.55);

    process.env.SUMMARY_LOW_QUALITY_THRESHOLD = "0.7";
    expect(getSummaryLowQualityThreshold()).toBe(0.7);
  });

  it("parses background tracking feature flag and bounds", () => {
    delete process.env.ENABLE_BACKGROUND_LOCATION_TRACKING;
    expect(getEnableBackgroundLocationTracking()).toBe(false);

    process.env.ENABLE_BACKGROUND_LOCATION_TRACKING = "true";
    expect(getEnableBackgroundLocationTracking()).toBe(true);

    process.env.ENABLE_BACKGROUND_LOCATION_TRACKING = "invalid";
    expect(getEnableBackgroundLocationTracking()).toBe(false);

    process.env.BACKGROUND_LOCATION_BATCH_MAX_POINTS = "1000";
    expect(getBackgroundLocationBatchMaxPoints()).toBe(32);

    process.env.BACKGROUND_LOCATION_BATCH_MAX_POINTS = "64";
    expect(getBackgroundLocationBatchMaxPoints()).toBe(64);

    process.env.BG_LOC_MAX_UPDATES_PER_HOUR = "10";
    expect(getBackgroundLocationMaxUpdatesPerHour()).toBe(120);

    process.env.BG_LOC_MAX_UPDATES_PER_HOUR = "360";
    expect(getBackgroundLocationMaxUpdatesPerHour()).toBe(360);

    process.env.BG_LOC_BATCH_FLUSH_INTERVAL_MIN = "1";
    expect(getBackgroundLocationBatchFlushIntervalMinutes()).toBe(15);

    process.env.BG_LOC_BATCH_FLUSH_INTERVAL_MIN = "30";
    expect(getBackgroundLocationBatchFlushIntervalMinutes()).toBe(30);

    process.env.BG_LOC_MAX_BATTERY_DRAIN_PCT_PER_HR = "100";
    expect(getBackgroundLocationMaxBatteryDrainPercentPerHour()).toBe(12);

    process.env.BG_LOC_MAX_BATTERY_DRAIN_PCT_PER_HR = "8";
    expect(getBackgroundLocationMaxBatteryDrainPercentPerHour()).toBe(8);
  });
});
