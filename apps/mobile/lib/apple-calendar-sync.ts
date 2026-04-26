import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getDayWindow, getResolvedTimeZone } from "@repo/ui/lib/day-window";

type AppleCalendarSyncContext = {
  meetingsCount: number;
  busyMinutes: number;
  eventTitles: string[];
};

export type AppleCalendarSyncPayload = {
  summary: string;
  signals: string[];
  context: AppleCalendarSyncContext;
};

const MAX_EVENT_TITLES = 5;
const MAX_EVENT_TITLE_LENGTH = 80;
const MAX_ALL_DAY_BUSY_MINUTES = 8 * 60;

const CALENDAR_SYNC_STATE_STORAGE_PREFIX = "apple-calendar-sync-state:v1:";
const CALENDAR_TIMELINE_CACHE_STORAGE_PREFIX = "apple-calendar-timeline:v1:";
const CALENDAR_TIMELINE_CACHE_TTL_MS = 10 * 60_000;

type CalendarEventFingerprint = {
  id: string;
  start: number;
  end: number;
  title: string;
  modified: number;
  status: string;
  availability: string;
  allDay: boolean;
};

type CalendarSyncState = {
  dayKey: string;
  timeZone: string;
  lastSyncedAtMs: number;
  contentHash: string;
  eventCount: number;
};

export type AppleCalendarTimelineEvent = {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
  durationMinutes: number;
  isAllDay: boolean;
  timeLabel: string;
};

type AppleCalendarTimelineCacheState = {
  dayKey: string;
  timeZone: string;
  cachedAtMs: number;
  events: AppleCalendarTimelineEvent[];
};

type CalendarEventLike = {
  id?: string;
  title?: string;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  status?: unknown;
  availability?: unknown;
  allDay?: boolean;
  lastModifiedDate?: Date | string | null;
};

type ExpoCalendarModuleLike = {
  requestCalendarPermissionsAsync: () => Promise<{ status: string }>;
  getCalendarsAsync: (entityType: unknown) => Promise<{ id: string }[]>;
  getEventsAsync: (
    calendarIds: string[],
    start: Date,
    end: Date,
  ) => Promise<CalendarEventLike[]>;
  EntityTypes: { EVENT: unknown };
  Availability: { FREE: unknown };
};

let cachedExpoCalendarModule: ExpoCalendarModuleLike | null = null;
let testExpoCalendarModuleOverride: ExpoCalendarModuleLike | null = null;

function getExpoCalendarModule(): ExpoCalendarModuleLike | null {
  if (testExpoCalendarModuleOverride) {
    return testExpoCalendarModuleOverride;
  }
  if (cachedExpoCalendarModule) {
    return cachedExpoCalendarModule;
  }
  try {
    const dynamicRequire = Function("return require")() as (
      moduleName: string,
    ) => unknown;
    const loaded = dynamicRequire("expo-calendar") as ExpoCalendarModuleLike;
    cachedExpoCalendarModule = loaded;
    return loaded;
  } catch {
    return null;
  }
}

function parseDayRange(
  dayKey: string,
  timeZone: string,
): { start: Date; end: Date } {
  const window = getDayWindow(dayKey, timeZone);
  return {
    start: new Date(window.startMs),
    end: new Date(window.endMs),
  };
}

function toMillis(value: Date | string | undefined | null): number | null {
  if (!value) return null;
  const timestamp =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function clampTitle(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_EVENT_TITLE_LENGTH
    ? `${trimmed.slice(0, MAX_EVENT_TITLE_LENGTH - 1)}…`
    : trimmed;
}

function buildTimelineCacheStorageKey(
  dayKey: string,
  timeZone: string,
): string {
  return `${CALENDAR_TIMELINE_CACHE_STORAGE_PREFIX}${dayKey}:${timeZone}`;
}

function formatEventTimeLabel(args: {
  startAt: number;
  endAt: number;
  isAllDay: boolean;
}): string {
  if (args.isAllDay) {
    return "All day";
  }

  const startLabel = new Date(args.startAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const endLabel = new Date(args.endAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${startLabel} - ${endLabel}`;
}

export function getAppleCalendarSetupIssue(): string | null {
  if (Platform.OS !== "ios") {
    return "Apple Calendar sync is available only on iOS devices.";
  }

  const ExpoCalendar = getExpoCalendarModule();
  if (!ExpoCalendar) {
    return "Apple Calendar bridge is unavailable. Rebuild the iOS development client with expo-calendar installed.";
  }
  if (typeof ExpoCalendar.requestCalendarPermissionsAsync !== "function") {
    return "Apple Calendar bridge is unavailable. Rebuild the iOS development client with expo-calendar installed.";
  }

  return null;
}

async function ensureCalendarPermission(): Promise<void> {
  const ExpoCalendar = getExpoCalendarModule();
  if (!ExpoCalendar) {
    throw new Error(
      "Apple Calendar bridge is unavailable. Rebuild the iOS development client with expo-calendar installed.",
    );
  }
  const permission = await ExpoCalendar.requestCalendarPermissionsAsync();
  if (permission.status !== "granted") {
    throw new Error(
      "Apple Calendar permission was not granted. Enable Calendar access for DayLog in iOS Settings.",
    );
  }
}

async function listDeviceCalendarIds(): Promise<string[]> {
  const ExpoCalendar = getExpoCalendarModule();
  if (!ExpoCalendar) {
    throw new Error(
      "Apple Calendar bridge is unavailable. Rebuild the iOS development client with expo-calendar installed.",
    );
  }
  const calendars = await ExpoCalendar.getCalendarsAsync(
    ExpoCalendar.EntityTypes.EVENT,
  );
  return calendars.map((calendar) => calendar.id).filter(Boolean);
}

function summarizeEvents(
  events: readonly CalendarEventLike[],
  windowStartMs: number,
  windowEndMs: number,
): AppleCalendarSyncContext {
  const ExpoCalendar = getExpoCalendarModule();
  const freeAvailability = ExpoCalendar?.Availability?.FREE;
  let meetingsCount = 0;
  let busyMinutes = 0;
  const titles: string[] = [];

  for (const event of events) {
    const rawStart = toMillis(event.startDate);
    const rawEnd = toMillis(event.endDate);

    if (rawStart === null || rawEnd === null || rawEnd <= rawStart) {
      continue;
    }

    if (
      freeAvailability !== undefined &&
      event.availability === freeAvailability
    ) {
      continue;
    }

    meetingsCount += 1;

    const segmentStart = Math.max(rawStart, windowStartMs);
    const segmentEnd = Math.min(rawEnd, windowEndMs);
    let overlapMinutes = Math.max(
      0,
      Math.round((segmentEnd - segmentStart) / 60_000),
    );

    if (event.allDay) {
      overlapMinutes = Math.min(overlapMinutes, MAX_ALL_DAY_BUSY_MINUTES);
    }

    busyMinutes += overlapMinutes;

    if (titles.length < MAX_EVENT_TITLES) {
      const title = clampTitle(event.title);
      if (title) {
        titles.push(title);
      }
    }
  }

  return {
    meetingsCount,
    busyMinutes,
    eventTitles: titles,
  };
}

/**
 * Produces a stable, order-independent fingerprint of a calendar event. Used
 * to detect whether the remote event set has changed since the last sync —
 * this is the foundation of delta sync / duplicate prevention / deletion
 * handling. Because iOS Calendar identifiers are stable for the lifetime of
 * the event on the device, including them here means:
 *   - A moved event changes start/end -> hash changes -> sync runs.
 *   - A renamed event changes title -> hash changes -> sync runs.
 *   - A deleted event drops from the set -> hash changes -> sync runs
 *     even though the remaining events are unchanged.
 *   - A re-imported identical event set yields the same hash -> no write.
 */
function buildEventFingerprint(
  event: CalendarEventLike,
  windowStartMs: number,
  windowEndMs: number,
): CalendarEventFingerprint | null {
  const rawStart = toMillis(event.startDate);
  const rawEnd = toMillis(event.endDate);
  if (rawStart === null || rawEnd === null) return null;

  const clampedStart = Math.max(rawStart, windowStartMs);
  const clampedEnd = Math.min(rawEnd, windowEndMs);
  if (clampedEnd <= clampedStart) return null;

  return {
    id: typeof event.id === "string" ? event.id : "",
    start: clampedStart,
    end: clampedEnd,
    title: clampTitle(event.title) ?? "",
    modified: toMillis(event.lastModifiedDate) ?? 0,
    status: String(event.status ?? ""),
    availability: String(event.availability ?? ""),
    allDay: Boolean(event.allDay),
  };
}

/**
 * Stable 32-bit FNV-1a hash over a canonical representation of the event
 * set. Fast, deterministic, collision-resistant enough for "did the event
 * set change since last sync" — we are NOT using this for security, only
 * for cheap change detection.
 */
function computeEventSetContentHash(
  fingerprints: readonly CalendarEventFingerprint[],
): string {
  const sorted = fingerprints.slice().sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    if (left.end !== right.end) return left.end - right.end;
    return left.id.localeCompare(right.id);
  });

  const canonical = JSON.stringify(sorted);
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildSyncStateStorageKey(dayKey: string): string {
  return `${CALENDAR_SYNC_STATE_STORAGE_PREFIX}${dayKey}`;
}

async function readPersistedSyncState(
  dayKey: string,
): Promise<CalendarSyncState | null> {
  try {
    const raw = await AsyncStorage.getItem(buildSyncStateStorageKey(dayKey));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CalendarSyncState>;
    if (
      typeof parsed?.dayKey !== "string" ||
      typeof parsed?.contentHash !== "string" ||
      typeof parsed?.lastSyncedAtMs !== "number" ||
      typeof parsed?.eventCount !== "number" ||
      typeof parsed?.timeZone !== "string"
    ) {
      return null;
    }

    return {
      dayKey: parsed.dayKey,
      timeZone: parsed.timeZone,
      lastSyncedAtMs: parsed.lastSyncedAtMs,
      contentHash: parsed.contentHash,
      eventCount: parsed.eventCount,
    };
  } catch {
    return null;
  }
}

async function writePersistedSyncState(
  state: CalendarSyncState,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      buildSyncStateStorageKey(state.dayKey),
      JSON.stringify(state),
    );
  } catch {
    // Sync-state persistence is a best-effort optimization: if the write
    // fails we just re-sync next time, which is safe (idempotent upsert
    // on the backend).
  }
}

async function readTimelineCacheState(
  dayKey: string,
  timeZone: string,
): Promise<AppleCalendarTimelineCacheState | null> {
  try {
    const raw = await AsyncStorage.getItem(
      buildTimelineCacheStorageKey(dayKey, timeZone),
    );
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<AppleCalendarTimelineCacheState>;
    if (
      parsed?.dayKey !== dayKey ||
      parsed?.timeZone !== timeZone ||
      typeof parsed?.cachedAtMs !== "number" ||
      !Array.isArray(parsed.events)
    ) {
      return null;
    }

    const events = parsed.events
      .filter(
        (event): event is AppleCalendarTimelineEvent =>
          typeof event === "object" &&
          event !== null &&
          typeof event.id === "string" &&
          typeof event.title === "string" &&
          typeof event.startAt === "number" &&
          typeof event.endAt === "number" &&
          typeof event.durationMinutes === "number" &&
          typeof event.isAllDay === "boolean" &&
          typeof event.timeLabel === "string",
      )
      .slice(0, 64);

    return {
      dayKey,
      timeZone,
      cachedAtMs: parsed.cachedAtMs,
      events,
    };
  } catch {
    return null;
  }
}

async function writeTimelineCacheState(
  state: AppleCalendarTimelineCacheState,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      buildTimelineCacheStorageKey(state.dayKey, state.timeZone),
      JSON.stringify(state),
    );
  } catch {
    // Best effort cache only.
  }
}

function toTimelineEvents(
  events: readonly CalendarEventLike[],
  windowStartMs: number,
  windowEndMs: number,
): AppleCalendarTimelineEvent[] {
  const timelineEvents: AppleCalendarTimelineEvent[] = [];
  for (const event of events) {
    const rawStart = toMillis(event.startDate);
    const rawEnd = toMillis(event.endDate);
    if (rawStart === null || rawEnd === null || rawEnd <= rawStart) continue;

    const startAt = Math.max(rawStart, windowStartMs);
    const endAt = Math.min(rawEnd, windowEndMs);
    if (endAt <= startAt) continue;

    const title = clampTitle(event.title) ?? "Untitled event";
    const isAllDay = Boolean(event.allDay);
    const durationMinutes = Math.max(1, Math.round((endAt - startAt) / 60_000));
    timelineEvents.push({
      id:
        typeof event.id === "string" && event.id.length > 0
          ? event.id
          : `${startAt}-${title}`,
      title,
      startAt,
      endAt,
      durationMinutes,
      isAllDay,
      timeLabel: formatEventTimeLabel({ startAt, endAt, isAllDay }),
    });
  }

  return timelineEvents
    .sort((left, right) => {
      if (left.startAt !== right.startAt) return left.startAt - right.startAt;
      if (left.endAt !== right.endAt) return left.endAt - right.endAt;
      return left.title.localeCompare(right.title);
    })
    .slice(0, 64);
}

export async function collectAppleCalendarTimelineForDay(
  dayKey: string,
  timeZone: string = getResolvedTimeZone(),
  options?: { forceRefresh?: boolean },
): Promise<{
  events: AppleCalendarTimelineEvent[];
  cached: boolean;
}> {
  const nowMs = Date.now();
  if (!options?.forceRefresh) {
    const cached = await readTimelineCacheState(dayKey, timeZone);
    if (cached && nowMs - cached.cachedAtMs <= CALENDAR_TIMELINE_CACHE_TTL_MS) {
      return {
        events: cached.events,
        cached: true,
      };
    }
  }

  const setupIssue = getAppleCalendarSetupIssue();
  if (setupIssue) throw new Error(setupIssue);

  await ensureCalendarPermission();
  const ExpoCalendar = getExpoCalendarModule();
  if (!ExpoCalendar) {
    throw new Error(
      "Apple Calendar bridge is unavailable. Rebuild the iOS development client with expo-calendar installed.",
    );
  }

  const { start, end } = parseDayRange(dayKey, timeZone);
  const calendarIds = await listDeviceCalendarIds();
  const rawEvents =
    calendarIds.length === 0
      ? []
      : await ExpoCalendar.getEventsAsync(calendarIds, start, end);

  const events = toTimelineEvents(rawEvents, start.getTime(), end.getTime());
  await writeTimelineCacheState({
    dayKey,
    timeZone,
    cachedAtMs: nowMs,
    events,
  });

  return {
    events,
    cached: false,
  };
}

export type AppleCalendarDeltaSyncResult =
  | {
      changed: false;
      reason: "unchanged" | "no_prior_state";
      payload: AppleCalendarSyncPayload;
      contentHash: string;
    }
  | {
      changed: true;
      reason:
        | "first_sync"
        | "content_changed"
        | "deletion_detected"
        | "timezone_changed";
      payload: AppleCalendarSyncPayload;
      contentHash: string;
      previousContentHash: string | null;
    };

type CalendarFetchResult = {
  payload: AppleCalendarSyncPayload;
  fingerprints: CalendarEventFingerprint[];
};

async function fetchCalendarDailyData(
  dayKey: string,
  timeZone: string,
): Promise<CalendarFetchResult> {
  const setupIssue = getAppleCalendarSetupIssue();
  if (setupIssue) {
    throw new Error(setupIssue);
  }

  await ensureCalendarPermission();
  const ExpoCalendar = getExpoCalendarModule();
  if (!ExpoCalendar) {
    throw new Error(
      "Apple Calendar bridge is unavailable. Rebuild the iOS development client with expo-calendar installed.",
    );
  }

  const { start, end } = parseDayRange(dayKey, timeZone);
  const calendarIds = await listDeviceCalendarIds();

  const rawEvents: CalendarEventLike[] =
    calendarIds.length === 0
      ? []
      : await ExpoCalendar.getEventsAsync(calendarIds, start, end);

  const windowStartMs = start.getTime();
  const windowEndMs = end.getTime();

  const context = summarizeEvents(rawEvents, windowStartMs, windowEndMs);

  const fingerprints: CalendarEventFingerprint[] = [];
  for (const event of rawEvents) {
    const fingerprint = buildEventFingerprint(
      event,
      windowStartMs,
      windowEndMs,
    );
    if (fingerprint) fingerprints.push(fingerprint);
  }

  const summary =
    context.meetingsCount > 0
      ? `Apple Calendar: ${context.meetingsCount} event${context.meetingsCount === 1 ? "" : "s"}${context.busyMinutes > 0 ? `, ${context.busyMinutes} busy minutes` : ""}.`
      : "Apple Calendar: no events scheduled for this day.";

  const signals: string[] = [
    context.meetingsCount > 0
      ? `${context.meetingsCount} calendar events`
      : "No calendar events",
    context.busyMinutes > 0
      ? `${context.busyMinutes} busy minutes`
      : "No busy time tracked",
    ...context.eventTitles,
  ];

  return {
    payload: { summary, signals, context },
    fingerprints,
  };
}

export async function collectAppleCalendarDailyDataForDay(
  dayKey: string,
  timeZone: string = getResolvedTimeZone(),
): Promise<AppleCalendarSyncPayload> {
  const { payload } = await fetchCalendarDailyData(dayKey, timeZone);
  return payload;
}

/**
 * Delta-aware calendar sync. Fetches today's events, hashes them, compares
 * against the last persisted hash in AsyncStorage, and only reports
 * `changed: true` when callers need to push a new upsert to the backend.
 *
 * Why this matters at scale:
 *   - Prevents redundant backend writes on background-sync heartbeats.
 *   - Handles deletions: if a user deletes an event, the hash changes and
 *     we correctly push the shrunken set (preventing stale-event ghosts).
 *   - Handles time-zone changes mid-day (travel): treats as a fresh sync
 *     rather than silently masking with a stale hash.
 *   - Always returns the full payload, so callers can still do a one-shot
 *     `commit()` (e.g. user manually taps "Sync now") when desired.
 */
export async function computeAppleCalendarDeltaForDay(
  dayKey: string,
  timeZone: string = getResolvedTimeZone(),
): Promise<AppleCalendarDeltaSyncResult> {
  const { payload, fingerprints } = await fetchCalendarDailyData(
    dayKey,
    timeZone,
  );
  const contentHash = computeEventSetContentHash(fingerprints);
  const previous = await readPersistedSyncState(dayKey);

  if (!previous) {
    return {
      changed: true,
      reason: "first_sync",
      payload,
      contentHash,
      previousContentHash: null,
    };
  }

  if (previous.timeZone !== timeZone) {
    return {
      changed: true,
      reason: "timezone_changed",
      payload,
      contentHash,
      previousContentHash: previous.contentHash,
    };
  }

  if (previous.contentHash === contentHash) {
    return {
      changed: false,
      reason: "unchanged",
      payload,
      contentHash,
    };
  }

  const reason: "content_changed" | "deletion_detected" =
    fingerprints.length < previous.eventCount
      ? "deletion_detected"
      : "content_changed";

  return {
    changed: true,
    reason,
    payload,
    contentHash,
    previousContentHash: previous.contentHash,
  };
}

/**
 * Persist the fact that the given event-set hash has been successfully
 * pushed to the backend. Call this ONLY after a successful upsert — never
 * optimistically, otherwise a failed push would be "forgotten" and the
 * backend would never catch up.
 */
export async function recordAppleCalendarSyncCommitted(
  dayKey: string,
  timeZone: string,
  contentHash: string,
  eventCount: number,
  nowMs: number = Date.now(),
): Promise<void> {
  await writePersistedSyncState({
    dayKey,
    timeZone,
    lastSyncedAtMs: nowMs,
    contentHash,
    eventCount,
  });
}

export async function clearAppleCalendarSyncStateForTests(
  dayKey: string,
): Promise<void> {
  try {
    await AsyncStorage.removeItem(buildSyncStateStorageKey(dayKey));
  } catch {
    // ignored — test-only helper
  }
}

export const __testing = {
  summarizeEvents,
  clampTitle,
  toMillis,
  buildEventFingerprint,
  computeEventSetContentHash,
  setExpoCalendarModuleOverride(module: ExpoCalendarModuleLike | null) {
    testExpoCalendarModuleOverride = module;
  },
  resetExpoCalendarModuleCache() {
    cachedExpoCalendarModule = null;
    testExpoCalendarModuleOverride = null;
  },
  MAX_EVENT_TITLES,
  MAX_EVENT_TITLE_LENGTH,
  MAX_ALL_DAY_BUSY_MINUTES,
  CALENDAR_SYNC_STATE_STORAGE_PREFIX,
  CALENDAR_TIMELINE_CACHE_STORAGE_PREFIX,
  CALENDAR_TIMELINE_CACHE_TTL_MS,
  toTimelineEvents,
};
