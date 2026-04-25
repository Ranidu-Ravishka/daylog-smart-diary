import { beforeEach, describe, expect, it, vi } from "vitest";

const { asyncStorageState, mockExpoCalendar } = vi.hoisted(() => ({
  asyncStorageState: new Map<string, string>(),
  mockExpoCalendar: {
    events: [] as unknown[],
    entityTypes: { EVENT: "event" },
    availability: { BUSY: "busy", FREE: "free" },
  },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorageState.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncStorageState.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      asyncStorageState.delete(key);
    }),
  },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("expo-calendar", () => ({
  requestCalendarPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  getCalendarsAsync: vi.fn(async () => [{ id: "cal-1" }]),
  getEventsAsync: vi.fn(async () => mockExpoCalendar.events),
  EntityTypes: mockExpoCalendar.entityTypes,
  Availability: mockExpoCalendar.availability,
}));

vi.mock("@repo/ui/lib/day-window", () => ({
  getDayWindow: () => ({
    startMs: Date.UTC(2026, 3, 24, 0, 0, 0),
    endMs: Date.UTC(2026, 3, 25, 0, 0, 0),
  }),
  getResolvedTimeZone: () => "UTC",
}));

type Mod = typeof import("./apple-calendar-sync");

async function loadModule(): Promise<Mod> {
  return await import("./apple-calendar-sync");
}

function buildEvent(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "evt-1",
    title: "Standup",
    startDate: new Date(Date.UTC(2026, 3, 24, 9, 0, 0)).toISOString(),
    endDate: new Date(Date.UTC(2026, 3, 24, 9, 30, 0)).toISOString(),
    availability: "busy",
    status: "confirmed",
    allDay: false,
    ...overrides,
  };
}

describe("apple-calendar-sync delta", () => {
  beforeEach(() => {
    vi.resetModules();
    asyncStorageState.clear();
    mockExpoCalendar.events = [];
  });

  it("treats the first sync as changed", async () => {
    mockExpoCalendar.events = [buildEvent()];
    const mod = await loadModule();

    const delta = await mod.computeAppleCalendarDeltaForDay("2026-04-24");
    expect(delta.changed).toBe(true);
    expect(delta.reason === "first_sync").toBe(true);
    expect(delta.contentHash.length).toBeGreaterThan(0);
  });

  it("returns unchanged when the event set and timezone are identical across syncs", async () => {
    mockExpoCalendar.events = [buildEvent()];
    const mod = await loadModule();

    const first = await mod.computeAppleCalendarDeltaForDay("2026-04-24");
    expect(first.changed).toBe(true);

    await mod.recordAppleCalendarSyncCommitted(
      "2026-04-24",
      "UTC",
      first.contentHash,
      1,
    );

    const second = await mod.computeAppleCalendarDeltaForDay("2026-04-24");
    expect(second.changed).toBe(false);
    if (!second.changed) {
      expect(second.reason).toBe("unchanged");
    }
  });

  it("detects deletions when an event disappears from the set", async () => {
    const mod = await loadModule();

    mockExpoCalendar.events = [
      buildEvent({ id: "a" }),
      buildEvent({ id: "b" }),
    ];
    const first = await mod.computeAppleCalendarDeltaForDay("2026-04-24");
    await mod.recordAppleCalendarSyncCommitted(
      "2026-04-24",
      "UTC",
      first.contentHash,
      2,
    );

    mockExpoCalendar.events = [buildEvent({ id: "a" })];
    const second = await mod.computeAppleCalendarDeltaForDay("2026-04-24");

    expect(second.changed).toBe(true);
    if (second.changed) {
      expect(second.reason).toBe("deletion_detected");
    }
  });

  it("detects content changes when an event title is renamed", async () => {
    const mod = await loadModule();

    mockExpoCalendar.events = [buildEvent({ id: "a", title: "Original" })];
    const first = await mod.computeAppleCalendarDeltaForDay("2026-04-24");
    await mod.recordAppleCalendarSyncCommitted(
      "2026-04-24",
      "UTC",
      first.contentHash,
      1,
    );

    mockExpoCalendar.events = [buildEvent({ id: "a", title: "Renamed" })];
    const second = await mod.computeAppleCalendarDeltaForDay("2026-04-24");
    expect(second.changed).toBe(true);
    if (second.changed) {
      expect(second.reason).toBe("content_changed");
    }
  });

  it("treats timezone switch as changed even if events are identical", async () => {
    const mod = await loadModule();

    mockExpoCalendar.events = [buildEvent()];
    const first = await mod.computeAppleCalendarDeltaForDay(
      "2026-04-24",
      "UTC",
    );
    await mod.recordAppleCalendarSyncCommitted(
      "2026-04-24",
      "UTC",
      first.contentHash,
      1,
    );

    const second = await mod.computeAppleCalendarDeltaForDay(
      "2026-04-24",
      "America/New_York",
    );
    expect(second.changed).toBe(true);
    if (second.changed) {
      expect(second.reason).toBe("timezone_changed");
    }
  });
});
