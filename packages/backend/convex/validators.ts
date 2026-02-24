// ────────────────────────────────────────────────────────────
// Shared input validation helpers.
// These throw descriptive errors for invalid inputs that
// would otherwise silently corrupt data or break ordering.
// ────────────────────────────────────────────────────────────

const DAY_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates that a dayKey is in YYYY-MM-DD format and
 * represents a real calendar date.
 */
export function validateDayKey(dayKey: string): void {
  if (!DAY_KEY_REGEX.test(dayKey)) {
    throw new Error(`Invalid dayKey "${dayKey}": must be in YYYY-MM-DD format`);
  }
  // Verify it's a real date (e.g. reject "2024-02-31")
  const parsed = new Date(dayKey + "T00:00:00Z");
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid dayKey "${dayKey}": not a valid calendar date`);
  }
}

/**
 * Validates that a rating is between 1 and 5 (inclusive).
 */
export function validateRating(rating: number): void {
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new Error(
      `Invalid rating ${rating}: must be a number between 1 and 5`,
    );
  }
}

/**
 * Clamps a query limit to a safe upper bound.
 * Returns the clamped value (does not throw).
 */
export function clampLimit(limit: number, max: number = 500): number {
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(limit, max);
}
