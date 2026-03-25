const SUMMARY_DAILY_GENERATION_LIMIT_ENV = "SUMMARY_DAILY_GENERATION_LIMIT";
const DEFAULT_SUMMARY_DAILY_GENERATION_LIMIT = 5;

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
