import { clampLimit } from "../../validators";

const DEFAULT_SUMMARY_GENERATION_INTEGRATION_LIMIT = 32;
const MAX_SUMMARY_GENERATION_INTEGRATION_LIMIT = 128;
const DEFAULT_LIST_MY_INTEGRATIONS_LIMIT = 50;
const MAX_LIST_MY_INTEGRATIONS_LIMIT = 100;
const DEFAULT_LIST_MY_SYNC_RUNS_FOR_DAY_LIMIT = 50;
const MAX_LIST_MY_SYNC_RUNS_FOR_DAY_LIMIT = 100;
const DEFAULT_LIST_MY_DAILY_DATA_FOR_DAY_LIMIT = 50;
const MAX_LIST_MY_DAILY_DATA_FOR_DAY_LIMIT = 100;
const DEFAULT_CONTEXT_AGGREGATE_SYNC_RUNS_LIMIT = 50;
const MAX_CONTEXT_AGGREGATE_SYNC_RUNS_LIMIT = 100;

export function clampSummaryGenerationIntegrationLimit(
  value: number | undefined,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SUMMARY_GENERATION_INTEGRATION_LIMIT;
  }

  const normalized = Math.floor(value);

  if (normalized < 1) {
    return 1;
  }

  if (normalized > MAX_SUMMARY_GENERATION_INTEGRATION_LIMIT) {
    return MAX_SUMMARY_GENERATION_INTEGRATION_LIMIT;
  }

  return normalized;
}

export function clampListMyIntegrationsLimit(
  value: number | undefined,
): number {
  return clampLimit(
    value ?? DEFAULT_LIST_MY_INTEGRATIONS_LIMIT,
    MAX_LIST_MY_INTEGRATIONS_LIMIT,
  );
}

export function clampListMySyncRunsForDayLimit(
  value: number | undefined,
): number {
  return clampLimit(
    value ?? DEFAULT_LIST_MY_SYNC_RUNS_FOR_DAY_LIMIT,
    MAX_LIST_MY_SYNC_RUNS_FOR_DAY_LIMIT,
  );
}

export function clampListMyDailyDataForDayLimit(
  value: number | undefined,
): number {
  return clampLimit(
    value ?? DEFAULT_LIST_MY_DAILY_DATA_FOR_DAY_LIMIT,
    MAX_LIST_MY_DAILY_DATA_FOR_DAY_LIMIT,
  );
}

export function clampContextAggregateSyncRunsLimit(
  value: number | undefined,
): number {
  return clampLimit(
    value ?? DEFAULT_CONTEXT_AGGREGATE_SYNC_RUNS_LIMIT,
    MAX_CONTEXT_AGGREGATE_SYNC_RUNS_LIMIT,
  );
}
