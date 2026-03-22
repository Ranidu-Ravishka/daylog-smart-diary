import { describe, expect, it } from "vitest";
import { DAILY_SUMMARY_GENERATION_LIMIT, getUtcDayKey } from "./summaries";

describe("summaries quota helpers", () => {
  it("exposes expected daily summary generation limit", () => {
    expect(DAILY_SUMMARY_GENERATION_LIMIT).toBe(5);
  });

  it("derives UTC day key from timestamp", () => {
    const ts = Date.UTC(2026, 2, 22, 15, 30, 0);
    expect(getUtcDayKey(ts)).toBe("2026-03-22");
  });

  it("uses UTC day boundaries", () => {
    const justBeforeMidnightUtc = Date.UTC(2026, 2, 22, 23, 59, 59, 999);
    const justAfterMidnightUtc = Date.UTC(2026, 2, 23, 0, 0, 0, 0);

    expect(getUtcDayKey(justBeforeMidnightUtc)).toBe("2026-03-22");
    expect(getUtcDayKey(justAfterMidnightUtc)).toBe("2026-03-23");
  });
});
