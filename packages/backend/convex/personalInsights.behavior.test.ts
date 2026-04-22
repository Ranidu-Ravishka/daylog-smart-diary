import { describe, expect, it, vi } from "vitest";
import {
  refreshMyDailyFeatureVector,
  getMyNextBestDayRecommendation,
} from "./personalInsights";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

describe("personal insights behavior", () => {
  it("builds and persists daily feature vectors", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ userId: "user_001" }) // identity
      .mockResolvedValueOnce({
        rating: 4,
        manualNotes: ["note 1", "note 2"],
        peopleTags: ["a", "b"],
      }) // day
      .mockResolvedValueOnce([{ _id: "m1" }, { _id: "m2" }]) // memories
      .mockResolvedValueOnce({ highlights: ["h1"] }) // summary
      .mockResolvedValueOnce([
        {
          provider: "google_fit",
          metrics: {
            steps: 7000,
            sleepMinutes: 420,
            screenTimeMinutes: 140,
            spendingTotal: 12.5,
          },
          context: {
            calendar: {
              meetingsCount: 2,
              busyMinutes: 120,
            },
            activitySummary: {
              callsCount: 1,
              callDurationMinutes: 18,
            },
          },
        },
      ]) // integrations
      .mockResolvedValueOnce([
        { dayKey: "2026-04-21" },
        { dayKey: "2026-04-20" },
      ]) // recent days
      .mockResolvedValueOnce({ rating: 3, manualNotes: ["n"], peopleTags: [] })
      .mockResolvedValueOnce([{ _id: "m3" }])
      .mockResolvedValueOnce({ highlights: [] })
      .mockResolvedValueOnce([
        {
          provider: "google_fit",
          metrics: { steps: 5000, sleepMinutes: 390, screenTimeMinutes: 160 },
        },
      ]);

    const runMutation = vi.fn().mockResolvedValue("vector_001");

    const run = handler<
      { dayKey: string; windowDays?: number },
      { features: { memoryCount: number; steps?: number; noteCount: number } }
    >(refreshMyDailyFeatureVector);

    const result = await run(
      {
        runQuery,
        runMutation,
      },
      {
        dayKey: "2026-04-21",
        windowDays: 7,
      },
    );

    expect(result.features.memoryCount).toBe(2);
    expect(result.features.steps).toBe(7000);
    expect(result.features.noteCount).toBe(2);
    expect(runMutation).toHaveBeenCalled();
  });

  it("generates next-best-day recommendations from trends and preferences", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ userId: "user_001" }) // identity
      .mockResolvedValueOnce({ focusAreas: [0, 2] }) // preferences
      .mockResolvedValueOnce([
        { dayKey: "2026-04-21" },
        { dayKey: "2026-04-20" },
        { dayKey: "2026-04-19" },
        { dayKey: "2026-04-18" },
      ])
      // day 1
      .mockResolvedValueOnce({ rating: 3, manualNotes: ["n1"], peopleTags: [] })
      .mockResolvedValueOnce([{ _id: "m1" }])
      .mockResolvedValueOnce({ highlights: [] })
      .mockResolvedValueOnce([
        { provider: "google_fit", metrics: { steps: 3000, sleepMinutes: 350 } },
      ])
      // day 2
      .mockResolvedValueOnce({ rating: 4, manualNotes: ["n1"], peopleTags: [] })
      .mockResolvedValueOnce([{ _id: "m2" }, { _id: "m3" }])
      .mockResolvedValueOnce({ highlights: [] })
      .mockResolvedValueOnce([
        { provider: "google_fit", metrics: { steps: 4500, sleepMinutes: 390 } },
      ])
      // day 3
      .mockResolvedValueOnce({
        rating: 4,
        manualNotes: ["n1", "n2"],
        peopleTags: [],
      })
      .mockResolvedValueOnce([{ _id: "m4" }, { _id: "m5" }, { _id: "m6" }])
      .mockResolvedValueOnce({ highlights: ["h"] })
      .mockResolvedValueOnce([
        { provider: "google_fit", metrics: { steps: 6000, sleepMinutes: 410 } },
      ])
      // day 4
      .mockResolvedValueOnce({
        rating: 5,
        manualNotes: ["n1", "n2"],
        peopleTags: [],
      })
      .mockResolvedValueOnce([{ _id: "m7" }, { _id: "m8" }, { _id: "m9" }])
      .mockResolvedValueOnce({ highlights: ["h1", "h2"] })
      .mockResolvedValueOnce([
        { provider: "google_fit", metrics: { steps: 7500, sleepMinutes: 430 } },
      ]);

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce("vector_1")
      .mockResolvedValueOnce("vector_2")
      .mockResolvedValueOnce("vector_3")
      .mockResolvedValueOnce("vector_4")
      .mockResolvedValueOnce("recommendation_1");

    const run = handler<
      { windowDays?: number },
      {
        recommendations: string[];
        recommendationType: string;
        targetDayKey: string;
      }
    >(getMyNextBestDayRecommendation);

    const result = await run(
      {
        runQuery,
        runMutation,
      },
      { windowDays: 7 },
    );

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.targetDayKey).toBe("2026-04-22");
    expect(["stabilize", "momentum", "recovery"]).toContain(
      result.recommendationType,
    );
  });

  it("fails safely when latest day key is unavailable", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ userId: "user_001" }) // identity
      .mockResolvedValueOnce({ focusAreas: [0] }) // preferences
      .mockResolvedValueOnce([{}]) // malformed recent day entry
      .mockResolvedValueOnce({ rating: 4, manualNotes: ["n1"], peopleTags: [] }) // day
      .mockResolvedValueOnce([{ _id: "m1" }]) // memories
      .mockResolvedValueOnce({ highlights: ["h1"] }) // summary
      .mockResolvedValueOnce([
        { provider: "google_fit", metrics: { steps: 6200, sleepMinutes: 420 } },
      ]); // integrations

    const runMutation = vi.fn().mockResolvedValue("vector_1");

    const run = handler<
      { windowDays?: number },
      { recommendationType: string }
    >(getMyNextBestDayRecommendation);

    await expect(
      run(
        {
          runQuery,
          runMutation,
        },
        { windowDays: 7 },
      ),
    ).rejects.toThrow(
      "No recent day data available to build a next-best-day recommendation.",
    );
  });
});
