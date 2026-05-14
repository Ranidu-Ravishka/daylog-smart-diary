import {
  getDayKeyForTimestamp,
  getResolvedTimeZone,
} from "@repo/ui/lib/day-window";

/**
 * Canonical "today" day key used across the mobile app.
 *
 * Always derives the key from the user's resolved IANA time zone so that the
 * Add-Memory flow and the Memory/Home tabs always agree on which date the
 * current moment belongs to. Previously some screens computed this from the
 * raw `Date` object (device-local fields), which could land newly-created
 * memories on a different `dayKey` than the one the Memory tab was reading
 * — making them appear missing.
 */
export function getTodayDayKey(): string {
  return getDayKeyForTimestamp(Date.now(), getResolvedTimeZone());
}

/**
 * Shift a `dayKey` (`YYYY-MM-DD`) by `deltaDays` calendar days, preserving the
 * `YYYY-MM-DD` shape. Operates on the calendar date — independent of timezone.
 */
export function shiftDayKey(dayKey: string, deltaDays: number): string {
  const parts = dayKey.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  const date = new Date(
    Date.UTC(year, Math.max(0, (month ?? 1) - 1), day ?? 1),
  );
  date.setUTCDate(date.getUTCDate() + deltaDays);

  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}
