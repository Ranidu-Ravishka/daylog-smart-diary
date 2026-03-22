import { describe, expect, it } from "vitest";
import { clampLimit, validateDayKey, validateRating } from "./validators";

describe("validateDayKey", () => {
  it("accepts a valid ISO day key", () => {
    expect(() => validateDayKey("2026-03-22")).not.toThrow();
  });

  it("rejects malformed day keys", () => {
    expect(() => validateDayKey("2026/03/22")).toThrow(
      /must be in YYYY-MM-DD format/,
    );
    expect(() => validateDayKey("2026-3-2")).toThrow(
      /must be in YYYY-MM-DD format/,
    );
  });

  it("rejects overflow calendar dates", () => {
    expect(() => validateDayKey("2024-02-31")).toThrow(
      /not a valid calendar date/,
    );
    expect(() => validateDayKey("2026-13-01")).toThrow(
      /not a valid calendar date/,
    );
    expect(() => validateDayKey("2026-00-10")).toThrow(
      /not a valid calendar date/,
    );
  });

  it("accepts leap day for leap years", () => {
    expect(() => validateDayKey("2024-02-29")).not.toThrow();
  });

  it("rejects leap day for non-leap years", () => {
    expect(() => validateDayKey("2025-02-29")).toThrow(
      /not a valid calendar date/,
    );
  });
});

describe("validateRating", () => {
  it("accepts ratings 1 through 5", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(() => validateRating(rating)).not.toThrow();
    }
  });

  it("rejects ratings outside the allowed range", () => {
    expect(() => validateRating(0)).toThrow(/between 1 and 5/);
    expect(() => validateRating(6)).toThrow(/between 1 and 5/);
  });

  it("rejects non-finite ratings", () => {
    expect(() => validateRating(Number.NaN)).toThrow(/between 1 and 5/);
    expect(() => validateRating(Number.POSITIVE_INFINITY)).toThrow(
      /between 1 and 5/,
    );
  });
});

describe("clampLimit", () => {
  it("returns 1 for invalid or too-small values", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-10)).toBe(1);
    expect(clampLimit(Number.NaN)).toBe(1);
  });

  it("caps values at default max when needed", () => {
    expect(clampLimit(1000)).toBe(500);
  });

  it("respects custom max", () => {
    expect(clampLimit(200, 100)).toBe(100);
    expect(clampLimit(50, 100)).toBe(50);
  });
});
