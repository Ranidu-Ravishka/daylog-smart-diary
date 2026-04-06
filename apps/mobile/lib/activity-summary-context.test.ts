import { describe, expect, it } from "vitest";

import { buildActivitySummaryContext } from "./activity-summary-context";

describe("activity summary context", () => {
  it("keeps mood empty when mood assistance is disabled", () => {
    const result = buildActivitySummaryContext({
      nowMs: Date.UTC(2026, 3, 6, 9, 0, 0),
      steps: 4200,
      activeMinutes: 25,
      callsCount: 2,
      callDurationMinutes: 12,
      moodAssistanceEnabled: false,
    });

    expect(result.context.activitySummary.activityLevel).toBe("mixed");
    expect(result.context.activitySummary.mood).toBeUndefined();
    expect(result.context.activitySummary.moodConfidence).toBeUndefined();
    expect(result.signals).toContain("Mood inference disabled");
  });

  it("infers social mood when call volume is high", () => {
    const result = buildActivitySummaryContext({
      nowMs: Date.UTC(2026, 3, 6, 13, 0, 0),
      steps: 1800,
      activeMinutes: 20,
      callsCount: 5,
      callDurationMinutes: 30,
      moodAssistanceEnabled: true,
    });

    expect(result.context.activitySummary.activityLevel).toBe("mixed");
    expect(result.context.activitySummary.mood).toBe("social");
    expect(result.context.activitySummary.moodConfidence).toBe(0.33);
    expect(result.summary).toContain("Inferred mood hint: social");
  });

  it("marks high movement days as active", () => {
    const result = buildActivitySummaryContext({
      nowMs: Date.UTC(2026, 3, 6, 10, 0, 0),
      steps: 8000,
      activeMinutes: 50,
      moodAssistanceEnabled: true,
    });

    expect(result.context.activitySummary.activityLevel).toBe("active");
    expect(result.signals[0]).toBe("Activity level active");
  });
});
