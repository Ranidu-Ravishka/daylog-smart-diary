import { describe, expect, it } from "vitest";
import { clampLimit, validateDayKey, validateRating } from "./validators";

describe("validateDayKey", () => {
  it("accepts valid ISO day keys", () => {
    expect(() => validateDayKey("2026-03-28")).not.toThrow();
    expect(() => validateDayKey("2024-02-29")).not.toThrow();
  });

  it("rejects malformed day keys", () => {
    expect(() => validateDayKey("2026/03/28")).toThrow();
    expect(() => validateDayKey("28-03-2026")).toThrow();
  });

  it("rejects impossible calendar dates", () => {
    expect(() => validateDayKey("2026-02-30")).toThrow();
  });
});

describe("validateRating", () => {
  it("accepts ratings in the inclusive range", () => {
    expect(() => validateRating(1)).not.toThrow();
    expect(() => validateRating(5)).not.toThrow();
  });

  it("rejects ratings outside the inclusive range", () => {
    expect(() => validateRating(0)).toThrow();
    expect(() => validateRating(6)).toThrow();
  });
});

describe("clampLimit", () => {
  it("clamps to the configured maximum", () => {
    expect(clampLimit(1000, 200)).toBe(200);
  });

  it("normalizes non-positive and invalid values", () => {
    expect(clampLimit(0, 200)).toBe(1);
    expect(clampLimit(Number.NaN, 200)).toBe(1);
  });
});
