import { logWarn } from "./observability";

const SUMMARY_DAILY_GENERATION_LIMIT_ENV = "SUMMARY_DAILY_GENERATION_LIMIT";
const DEFAULT_SUMMARY_DAILY_GENERATION_LIMIT = 5;

const RETENTION_MEMORIES_DAYS_ENV = "RETENTION_MEMORIES_DAYS";
const RETENTION_DAYS_RECORDS_DAYS_ENV = "RETENTION_DAYS_RECORDS_DAYS";
const RETENTION_DAY_SUMMARIES_DAYS_ENV = "RETENTION_DAY_SUMMARIES_DAYS";
const RETENTION_INTEGRATION_DATA_DAYS_ENV = "RETENTION_INTEGRATION_DATA_DAYS";
const RETENTION_LOCATION_SIGNALS_DAYS_ENV = "RETENTION_LOCATION_SIGNALS_DAYS";
const RETENTION_SUMMARY_EVENTS_DAYS_ENV = "RETENTION_SUMMARY_EVENTS_DAYS";
const RETENTION_AI_SUMMARY_ATTEMPTS_DAYS_ENV =
  "RETENTION_AI_SUMMARY_ATTEMPTS_DAYS";
const RETENTION_INFO_EVENTS_DAYS_ENV = "RETENTION_INFO_EVENTS_DAYS";
const RETENTION_EXPORT_JOBS_DAYS_ENV = "RETENTION_EXPORT_JOBS_DAYS";
const RETENTION_RESTORE_JOBS_DAYS_ENV = "RETENTION_RESTORE_JOBS_DAYS";
const RETENTION_SYNC_RUNS_DAYS_ENV = "RETENTION_SYNC_RUNS_DAYS";
const RETENTION_SUMMARY_QUOTAS_DAYS_ENV = "RETENTION_SUMMARY_QUOTAS_DAYS";
const RETENTION_SUMMARY_QUALITY_DAYS_ENV = "RETENTION_SUMMARY_QUALITY_DAYS";
const RETENTION_DAILY_FEATURE_VECTORS_DAYS_ENV =
  "RETENTION_DAILY_FEATURE_VECTORS_DAYS";
const RETENTION_NEXT_BEST_DAY_RECOMMENDATIONS_DAYS_ENV =
  "RETENTION_NEXT_BEST_DAY_RECOMMENDATIONS_DAYS";
const RETENTION_HEALTH_EVENTS_DAYS_ENV = "RETENTION_HEALTH_EVENTS_DAYS";
const RETENTION_AUDIT_LOGS_DAYS_ENV = "RETENTION_AUDIT_LOGS_DAYS";
const RETENTION_PLATFORM_AUDIT_DAYS_ENV = "RETENTION_PLATFORM_AUDIT_DAYS";
const RETENTION_USER_DELETION_JOBS_DAYS_ENV =
  "RETENTION_USER_DELETION_JOBS_DAYS";
const RETENTION_DELETE_BATCH_SIZE_ENV = "RETENTION_DELETE_BATCH_SIZE";
const SUMMARY_LOW_QUALITY_THRESHOLD_ENV = "SUMMARY_LOW_QUALITY_THRESHOLD";
const ENABLE_BACKGROUND_LOCATION_TRACKING_ENV =
  "ENABLE_BACKGROUND_LOCATION_TRACKING";
const BACKGROUND_LOCATION_BATCH_MAX_POINTS_ENV =
  "BACKGROUND_LOCATION_BATCH_MAX_POINTS";
const BG_LOC_MAX_UPDATES_PER_HOUR_ENV = "BG_LOC_MAX_UPDATES_PER_HOUR";
const BG_LOC_BATCH_FLUSH_INTERVAL_MIN_ENV = "BG_LOC_BATCH_FLUSH_INTERVAL_MIN";
const BG_LOC_MAX_BATTERY_DRAIN_PCT_PER_HR_ENV =
  "BG_LOC_MAX_BATTERY_DRAIN_PCT_PER_HR";

type NumericConfig = {
  envName: string;
  fallback: number;
  min: number;
  max: number;
};

type BooleanConfig = {
  envName: string;
  fallback: boolean;
};

function parseBoundedInt(config: NumericConfig): number {
  const raw = process.env[config.envName]?.trim();
  if (!raw) return config.fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < config.min || parsed > config.max) {
    logWarn("runtime_config_invalid_integer", {
      envName: config.envName,
      raw,
      fallback: config.fallback,
      min: config.min,
      max: config.max,
    });
    return config.fallback;
  }

  return parsed;
}

function parseBoundedNumber(config: NumericConfig): number {
  const raw = process.env[config.envName]?.trim();
  if (!raw) return config.fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < config.min || parsed > config.max) {
    logWarn("runtime_config_invalid_number", {
      envName: config.envName,
      raw,
      fallback: config.fallback,
      min: config.min,
      max: config.max,
    });
    return config.fallback;
  }

  return parsed;
}

function parseBoolean(config: BooleanConfig): boolean {
  const raw = process.env[config.envName]?.trim().toLowerCase();
  if (!raw) return config.fallback;

  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }

  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }

  logWarn("runtime_config_invalid_boolean", {
    envName: config.envName,
    raw,
    fallback: config.fallback,
  });
  return config.fallback;
}

export function getSummaryDailyGenerationLimit(): number {
  const raw = process.env[SUMMARY_DAILY_GENERATION_LIMIT_ENV]?.trim();

  if (!raw) {
    logWarn("runtime_config_missing_daily_generation_limit", {
      envName: SUMMARY_DAILY_GENERATION_LIMIT_ENV,
      fallback: DEFAULT_SUMMARY_DAILY_GENERATION_LIMIT,
    });
    return DEFAULT_SUMMARY_DAILY_GENERATION_LIMIT;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
    logWarn("runtime_config_invalid_daily_generation_limit", {
      envName: SUMMARY_DAILY_GENERATION_LIMIT_ENV,
      raw,
      fallback: DEFAULT_SUMMARY_DAILY_GENERATION_LIMIT,
      min: 1,
      max: 1000,
    });
    return DEFAULT_SUMMARY_DAILY_GENERATION_LIMIT;
  }

  return parsed;
}

export type RetentionPolicyKey =
  | "memories"
  | "days"
  | "daySummaries"
  | "integrationDailyData"
  | "integrationSyncRuns"
  | "locationSignals"
  | "summaryGenerationEvents"
  | "aiSummaryAttempts"
  | "summaryQualityEvaluations"
  | "dailyFeatureVectors"
  | "nextBestDayRecommendations"
  | "summaryGenerationQuotas"
  | "infoEvents"
  | "integrationHealthEvents"
  | "auditLogs"
  | "platformAuditEvents"
  | "exportJobs"
  | "restoreJobs"
  | "userDeletionJobs";

export function getRetentionPolicyDefaults(): Record<
  RetentionPolicyKey,
  {
    retentionDays: number;
    sensitive: boolean;
    enabled: boolean;
  }
> {
  return {
    memories: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_MEMORIES_DAYS_ENV,
        fallback: 90,
        min: 1,
        max: 3650,
      }),
      sensitive: false,
      enabled: true,
    },
    days: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_DAYS_RECORDS_DAYS_ENV,
        fallback: 90,
        min: 1,
        max: 3650,
      }),
      sensitive: false,
      enabled: true,
    },
    daySummaries: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_DAY_SUMMARIES_DAYS_ENV,
        fallback: 90,
        min: 1,
        max: 3650,
      }),
      sensitive: false,
      enabled: true,
    },
    integrationDailyData: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_INTEGRATION_DATA_DAYS_ENV,
        fallback: 90,
        min: 1,
        max: 3650,
      }),
      sensitive: false,
      enabled: true,
    },
    integrationSyncRuns: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_SYNC_RUNS_DAYS_ENV,
        fallback: 90,
        min: 1,
        max: 3650,
      }),
      sensitive: false,
      enabled: true,
    },
    locationSignals: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_LOCATION_SIGNALS_DAYS_ENV,
        fallback: 30,
        min: 1,
        max: 3650,
      }),
      sensitive: true,
      enabled: true,
    },
    summaryGenerationEvents: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_SUMMARY_EVENTS_DAYS_ENV,
        fallback: 60,
        min: 1,
        max: 3650,
      }),
      sensitive: false,
      enabled: true,
    },
    aiSummaryAttempts: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_AI_SUMMARY_ATTEMPTS_DAYS_ENV,
        fallback: 60,
        min: 1,
        max: 3650,
      }),
      sensitive: true,
      enabled: true,
    },
    summaryQualityEvaluations: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_SUMMARY_QUALITY_DAYS_ENV,
        fallback: 60,
        min: 1,
        max: 3650,
      }),
      sensitive: false,
      enabled: true,
    },
    dailyFeatureVectors: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_DAILY_FEATURE_VECTORS_DAYS_ENV,
        fallback: 90,
        min: 1,
        max: 3650,
      }),
      sensitive: true,
      enabled: true,
    },
    nextBestDayRecommendations: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_NEXT_BEST_DAY_RECOMMENDATIONS_DAYS_ENV,
        fallback: 90,
        min: 1,
        max: 3650,
      }),
      sensitive: true,
      enabled: true,
    },
    summaryGenerationQuotas: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_SUMMARY_QUOTAS_DAYS_ENV,
        fallback: 180,
        min: 1,
        max: 3650,
      }),
      sensitive: false,
      enabled: true,
    },
    infoEvents: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_INFO_EVENTS_DAYS_ENV,
        fallback: 90,
        min: 1,
        max: 3650,
      }),
      sensitive: false,
      enabled: true,
    },
    exportJobs: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_EXPORT_JOBS_DAYS_ENV,
        fallback: 14,
        min: 1,
        max: 3650,
      }),
      sensitive: true,
      enabled: true,
    },
    restoreJobs: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_RESTORE_JOBS_DAYS_ENV,
        fallback: 30,
        min: 1,
        max: 3650,
      }),
      sensitive: true,
      enabled: true,
    },
    integrationHealthEvents: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_HEALTH_EVENTS_DAYS_ENV,
        fallback: 90,
        min: 1,
        max: 3650,
      }),
      sensitive: false,
      enabled: true,
    },
    auditLogs: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_AUDIT_LOGS_DAYS_ENV,
        fallback: 365,
        min: 1,
        max: 3650,
      }),
      sensitive: true,
      enabled: true,
    },
    platformAuditEvents: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_PLATFORM_AUDIT_DAYS_ENV,
        fallback: 180,
        min: 1,
        max: 3650,
      }),
      sensitive: true,
      enabled: true,
    },
    userDeletionJobs: {
      retentionDays: parseBoundedInt({
        envName: RETENTION_USER_DELETION_JOBS_DAYS_ENV,
        fallback: 180,
        min: 1,
        max: 3650,
      }),
      sensitive: true,
      enabled: true,
    },
  };
}

export function getExportJobRetentionDays(): number {
  return getRetentionPolicyDefaults().exportJobs.retentionDays;
}

export function getRestoreJobRetentionDays(): number {
  return getRetentionPolicyDefaults().restoreJobs.retentionDays;
}

export function getRetentionDeleteBatchSize(): number {
  return parseBoundedInt({
    envName: RETENTION_DELETE_BATCH_SIZE_ENV,
    fallback: 200,
    min: 50,
    max: 5000,
  });
}

export function getSummaryLowQualityThreshold(): number {
  return parseBoundedNumber({
    envName: SUMMARY_LOW_QUALITY_THRESHOLD_ENV,
    fallback: 0.55,
    min: 0,
    max: 1,
  });
}

export function getEnableBackgroundLocationTracking(): boolean {
  return parseBoolean({
    envName: ENABLE_BACKGROUND_LOCATION_TRACKING_ENV,
    fallback: false,
  });
}

export function getBackgroundLocationBatchMaxPoints(): number {
  return parseBoundedInt({
    envName: BACKGROUND_LOCATION_BATCH_MAX_POINTS_ENV,
    fallback: 32,
    min: 8,
    max: 500,
  });
}

export function getBackgroundLocationMaxUpdatesPerHour(): number {
  return parseBoundedInt({
    envName: BG_LOC_MAX_UPDATES_PER_HOUR_ENV,
    fallback: 120,
    min: 20,
    max: 2000,
  });
}

export function getBackgroundLocationBatchFlushIntervalMinutes(): number {
  return parseBoundedInt({
    envName: BG_LOC_BATCH_FLUSH_INTERVAL_MIN_ENV,
    fallback: 15,
    min: 5,
    max: 240,
  });
}

export function getBackgroundLocationMaxBatteryDrainPercentPerHour(): number {
  return parseBoundedInt({
    envName: BG_LOC_MAX_BATTERY_DRAIN_PCT_PER_HR_ENV,
    fallback: 12,
    min: 1,
    max: 60,
  });
}
