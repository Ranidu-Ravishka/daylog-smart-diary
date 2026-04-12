const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const DAY_PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const OFFSET_PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

type ParsedDayKey = {
  year: number;
  month: number;
  day: number;
};

export type DayWindow = {
  startMs: number;
  endMs: number;
};

function getDayPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = DAY_PARTS_FORMATTERS.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US-u-hc-h23", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  DAY_PARTS_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

function getOffsetPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = OFFSET_PARTS_FORMATTERS.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US-u-hc-h23", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  OFFSET_PARTS_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

function getPartNumber(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = parts.find((part) => part.type === type)?.value;
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw new Error(`Unable to parse time-zone part: ${type}`);
  }

  return parsed;
}

function parseDayKey(dayKey: string): ParsedDayKey {
  const match = DAY_KEY_PATTERN.exec(dayKey);
  if (!match) {
    throw new Error(`Invalid dayKey "${dayKey}". Expected YYYY-MM-DD.`);
  }

  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);

  const testDate = new Date(Date.UTC(year, month - 1, day));
  if (
    testDate.getUTCFullYear() !== year ||
    testDate.getUTCMonth() !== month - 1 ||
    testDate.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date in dayKey "${dayKey}".`);
  }

  return { year, month, day };
}

function assertValidTimeZone(timeZone: string): string {
  const trimmed = timeZone.trim();
  if (!trimmed) {
    throw new Error("Time zone must be a non-empty IANA identifier.");
  }

  // Throws a RangeError for invalid IANA time-zone identifiers.
  new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(0);
  return trimmed;
}

function getOffsetMsAtInstant(instantMs: number, timeZone: string): number {
  const formatter = getOffsetPartsFormatter(timeZone);
  const parts = formatter.formatToParts(new Date(instantMs));

  const year = getPartNumber(parts, "year");
  const month = getPartNumber(parts, "month");
  const day = getPartNumber(parts, "day");
  const hour = getPartNumber(parts, "hour");
  const minute = getPartNumber(parts, "minute");
  const second = getPartNumber(parts, "second");

  const representedUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  return representedUtcMs - instantMs;
}

function zonedPartsToInstantMs(
  parts: ParsedDayKey & {
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
  },
  timeZone: string,
): number {
  const utcGuessMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );

  const offsetGuessMs = getOffsetMsAtInstant(utcGuessMs, timeZone);
  let instantMs = utcGuessMs - offsetGuessMs;

  const offsetAtInstantMs = getOffsetMsAtInstant(instantMs, timeZone);
  if (offsetAtInstantMs !== offsetGuessMs) {
    instantMs = utcGuessMs - offsetAtInstantMs;
  }

  return instantMs;
}

export function resolveTimeZone(
  candidate: string | null | undefined,
  fallback = "UTC",
): string {
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    try {
      return assertValidTimeZone(candidate);
    } catch {
      // Fall through to fallback handling.
    }
  }

  try {
    return assertValidTimeZone(fallback);
  } catch {
    // Fall through to runtime fallback.
  }

  const runtime = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (runtime) {
    try {
      return assertValidTimeZone(runtime);
    } catch {
      // Fall through to hard fallback.
    }
  }

  return "UTC";
}

export function getResolvedTimeZone(fallback = "UTC"): string {
  const runtime = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return resolveTimeZone(runtime, fallback);
}

export function getDayWindow(dayKey: string, timeZone: string): DayWindow {
  const parsedTimeZone = assertValidTimeZone(timeZone);
  const currentDay = parseDayKey(dayKey);

  const startMs = zonedPartsToInstantMs(
    {
      ...currentDay,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    parsedTimeZone,
  );

  const nextDay = new Date(
    Date.UTC(currentDay.year, currentDay.month - 1, currentDay.day),
  );
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const nextStartMs = zonedPartsToInstantMs(
    {
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    parsedTimeZone,
  );

  return {
    startMs,
    endMs: nextStartMs - 1,
  };
}

export function getDayKeyForTimestamp(
  timestampMs: number,
  timeZone: string,
): string {
  if (!Number.isFinite(timestampMs)) {
    throw new Error(`Invalid timestamp ${String(timestampMs)}.`);
  }

  const parsedTimeZone = assertValidTimeZone(timeZone);
  const formatter = getDayPartsFormatter(parsedTimeZone);
  const parts = formatter.formatToParts(new Date(timestampMs));

  const year = getPartNumber(parts, "year");
  const month = String(getPartNumber(parts, "month")).padStart(2, "0");
  const day = String(getPartNumber(parts, "day")).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
