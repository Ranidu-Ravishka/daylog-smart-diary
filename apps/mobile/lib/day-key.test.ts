import { describe, expect, it, vi, afterEach } from "vitest";
import { getTodayDayKey, shiftDayKey } from "./day-key";

describe("shiftDayKey", () => {
  it("advances within a month", () => {
    expect(shiftDayKey("2024-03-10", 1)).toBe("2024-03-11");
    expect(shiftDayKey("2024-03-10", 5)).toBe("2024-03-15");
  });

  it("rolls forward across a month boundary", () => {
    expect(shiftDayKey("2024-03-31", 1)).toBe("2024-04-01");
  });

  it("rolls backward across a month boundary", () => {
    expect(shiftDayKey("2024-04-01", -1)).toBe("2024-03-31");
  });

  it("handles year boundary", () => {
    expect(shiftDayKey("2024-12-31", 1)).toBe("2025-01-01");
    expect(shiftDayKey("2025-01-01", -1)).toBe("2024-12-31");
  });

  it("handles leap year", () => {
    expect(shiftDayKey("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDayKey("2024-02-29", 1)).toBe("2024-03-01");
  });

  it("zero-pads month and day", () => {
    expect(shiftDayKey("2024-01-09", 0)).toBe("2024-01-09");
  });
});

describe("getTodayDayKey", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns YYYY-MM-DD for the current moment", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:34:56Z"));

    const key = getTodayDayKey();
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
