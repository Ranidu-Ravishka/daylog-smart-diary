const SUMMARY_DAILY_GENERATION_LIMIT_ENV = "SUMMARY_DAILY_GENERATION_LIMIT";
const DEFAULT_SUMMARY_DAILY_GENERATION_LIMIT = 5;

const RETENTION_MEMORIES_DAYS_ENV = "RETENTION_MEMORIES_DAYS";
const RETENTION_DAY_SUMMARIES_DAYS_ENV = "RETENTION_DAY_SUMMARIES_DAYS";
const RETENTION_INTEGRATION_DATA_DAYS_ENV = "RETENTION_INTEGRATION_DATA_DAYS";
const RETENTION_LOCATION_SIGNALS_DAYS_ENV = "RETENTION_LOCATION_SIGNALS_DAYS";
const RETENTION_SUMMARY_EVENTS_DAYS_ENV = "RETENTION_SUMMARY_EVENTS_DAYS";
const RETENTION_DELETE_BATCH_SIZE_ENV = "RETENTION_DELETE_BATCH_SIZE";
const SUMMARY_LOW_QUALITY_THRESHOLD_ENV = "SUMMARY_LOW_QUALITY_THRESHOLD";

type NumericConfig = {
  envName: string;
  fallback: number;
  min: number;
  max: number;
};

function parseBoundedInt(config: NumericConfig): number {
  const raw = process.env[config.envName]?.trim();
  if (!raw) return config.fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < config.min || parsed > config.max) {
    console.warn(
      `[config] Invalid ${config.envName}='${raw}'. Falling back to ${config.fallback}.`,
    );
    return config.fallback;
  }

  return parsed;
}

function parseBoundedNumber(config: NumericConfig): number {
  const raw = process.env[config.envName]?.trim();
  if (!raw) return config.fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < config.min || parsed > config.max) {
    console.warn(
      `[config] Invalid ${config.envName}='${raw}'. Falling back to ${config.fallback}.`,
    );
    return config.fallback;
  }

  return parsed;
}

export function getSummaryDailyGenerationLimit(): number {
  const raw = process.env[SUMMARY_DAILY_GENERATION_LIMIT_ENV]?.trim();

  if (!raw) {
    console.warn(
      `[config] Missing ${SUMMARY_DAILY_GENERATION_LIMIT_ENV}. Falling back to ${DEFAULT_SUMMARY_DAILY_GENERATION_LIMIT}.`,
    );
    return DEFAULT_SUMMARY_DAILY_GENERATION_LIMIT;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
    console.warn(
      `[config] Invalid ${SUMMARY_DAILY_GENERATION_LIMIT_ENV}='${raw}'. Falling back to ${DEFAULT_SUMMARY_DAILY_GENERATION_LIMIT}.`,
    );
    return DEFAULT_SUMMARY_DAILY_GENERATION_LIMIT;
  }

  return parsed;
}

export type RetentionPolicyKey =
  | "memories"
  | "daySummaries"
  | "integrationDailyData"
  | "locationSignals"
  | "summaryGenerationEvents";

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
  };
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
