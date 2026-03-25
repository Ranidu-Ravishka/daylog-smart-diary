const SUMMARY_DAILY_GENERATION_LIMIT_ENV = "SUMMARY_DAILY_GENERATION_LIMIT";

export function getSummaryDailyGenerationLimit(): number {
  const raw = process.env[SUMMARY_DAILY_GENERATION_LIMIT_ENV]?.trim();

  if (!raw) {
    throw new Error(
      `[config] Missing ${SUMMARY_DAILY_GENERATION_LIMIT_ENV}. Set it in Convex environment variables.`,
    );
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error(
      `[config] Invalid ${SUMMARY_DAILY_GENERATION_LIMIT_ENV}='${raw}'. Use an integer between 1 and 1000.`,
    );
  }

  return parsed;
}
