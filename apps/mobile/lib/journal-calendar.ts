import { shiftDayKey } from "@/lib/day-key";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Seven calendar day keys centered on `centerDayKey` (index 0 = three days before center). */
export function getWeekDayKeysCentered(centerDayKey: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDayKey(centerDayKey, i - 3));
}

export function formatMonthYearHeading(dayKey: string): string {
  const parts = dayKey.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return "";
  const name = MONTH_NAMES[Math.max(0, Math.min(11, m - 1))] ?? "";
  return `${name} ${y}`;
}

export function formatWeekdayLetter(dayKey: string): string {
  const parts = dayKey.split("-");
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d))
    return "?";
  const date = new Date(Date.UTC(y, mo - 1, d));
  const letters = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  return letters[date.getUTCDay()] ?? "?";
}

export function formatDayOfMonth(dayKey: string): string {
  const parts = dayKey.split("-");
  const d = Number(parts[2]);
  if (!Number.isFinite(d)) return "—";
  return String(d);
}
