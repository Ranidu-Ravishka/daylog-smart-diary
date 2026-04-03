import { afterEach, describe, expect, it } from "vitest";

import {
  getRetentionDeleteBatchSize,
  getRetentionPolicyDefaults,
  getSummaryDailyGenerationLimit,
  getSummaryLowQualityThreshold,
} from "./runtimeConfig";

const runtimeEnvKeys = [
  "SUMMARY_DAILY_GENERATION_LIMIT",
  "RETENTION_MEMORIES_DAYS",
  "RETENTION_DAY_SUMMARIES_DAYS",
  "RETENTION_INTEGRATION_DATA_DAYS",
  "RETENTION_LOCATION_SIGNALS_DAYS",
  "RETENTION_SUMMARY_EVENTS_DAYS",
  "RETENTION_DELETE_BATCH_SIZE",
  "SUMMARY_LOW_QUALITY_THRESHOLD",
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
    process.env.RETENTION_DAY_SUMMARIES_DAYS = "invalid";
    process.env.RETENTION_INTEGRATION_DATA_DAYS = "120";
    process.env.RETENTION_LOCATION_SIGNALS_DAYS = "-1";
    process.env.RETENTION_SUMMARY_EVENTS_DAYS = "30";

    const defaults = getRetentionPolicyDefaults();

    expect(defaults.memories.retentionDays).toBe(365);
    expect(defaults.daySummaries.retentionDays).toBe(90);
    expect(defaults.integrationDailyData.retentionDays).toBe(120);
    expect(defaults.locationSignals.retentionDays).toBe(30);
    expect(defaults.summaryGenerationEvents.retentionDays).toBe(30);
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
});
