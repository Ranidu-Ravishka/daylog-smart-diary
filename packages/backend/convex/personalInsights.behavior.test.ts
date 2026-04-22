import { describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
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

type DayFixture = {
  rating?: number;
  manualNotes?: string[];
  peopleTags?: string[];
};

type MemoryFixture = { _id: string };

type SummaryFixture = { highlights?: string[] };

type IntegrationFixture = {
  provider: string;
  metrics?: {
    steps?: number;
    sleepMinutes?: number;
    screenTimeMinutes?: number;
    spendingTotal?: number;
  };
  context?: {
    calendar?: { meetingsCount?: number; busyMinutes?: number };
    activitySummary?: { callsCount?: number; callDurationMinutes?: number };
  };
};

type Fixtures = {
  identity?: { userId: string };
  preferences?: { focusAreas?: number[] } | null;
  recentDays?: Array<{ dayKey?: string }>;
  days?: Record<string, DayFixture | null>;
  memories?: Record<string, MemoryFixture[]>;
  summaries?: Record<string, SummaryFixture | null>;
  integrations?: Record<string, IntegrationFixture[]>;
  existingVectors?: Array<{ dayKey: string; features: unknown }>;
};

function refName(ref: unknown): string {
  try {
    return getFunctionName(ref as never);
  } catch {
    return "";
  }
}

/**
 * Build a `runQuery` mock that dispatches on Convex function reference name
 * (e.g. "days:getDay"). Order-independent so it tolerates internal batching
 * and parallelism changes.
 */
function buildRunQuery(fixtures: Fixtures) {
  return vi.fn(async (ref: unknown, args: Record<string, unknown> = {}) => {
    const name = refName(ref);
    const dayKey = typeof args.dayKey === "string" ? args.dayKey : undefined;

    if (name.endsWith(":getDay")) {
      return dayKey ? (fixtures.days?.[dayKey] ?? null) : null;
    }
    if (name.endsWith(":listRecentDays")) {
      return fixtures.recentDays ?? [];
    }
    if (name.endsWith(":getSummaryByDay")) {
      return dayKey ? (fixtures.summaries?.[dayKey] ?? null) : null;
    }
    if (name.endsWith(":listMyDailyFeatureVectorsByDayKeys")) {
      return fixtures.existingVectors ?? [];
    }
    if (name.endsWith(":listMemoriesByDayForSummaryGeneration")) {
      return dayKey ? (fixtures.memories?.[dayKey] ?? []) : [];
    }
    if (
      name.endsWith(":listMyIntegrationDailyDataForSummaryGeneration") ||
      name.endsWith(":listMyIntegrationDailyDataForDayForSummaryGeneration")
    ) {
      return dayKey ? (fixtures.integrations?.[dayKey] ?? []) : [];
    }
    if (name.endsWith(":getSummaryGenerationIdentity")) {
      return fixtures.identity ?? { userId: "user_001" };
    }
    if (name.endsWith(":getMyUserPreferences")) {
      return fixtures.preferences ?? null;
    }
    return null;
  });
}

describe("personal insights behavior", () => {
  it("builds and persists daily feature vectors", async () => {
    const runQuery = buildRunQuery({
      identity: { userId: "user_001" },
      recentDays: [{ dayKey: "2026-04-21" }, { dayKey: "2026-04-20" }],
      existingVectors: [],
      days: {
        "2026-04-21": {
          rating: 4,
          manualNotes: ["note 1", "note 2"],
          peopleTags: ["a", "b"],
        },
        "2026-04-20": { rating: 3, manualNotes: ["n"], peopleTags: [] },
      },
      memories: {
        "2026-04-21": [{ _id: "m1" }, { _id: "m2" }],
        "2026-04-20": [{ _id: "m3" }],
      },
      summaries: {
        "2026-04-21": { highlights: ["h1"] },
        "2026-04-20": { highlights: [] },
      },
      integrations: {
        "2026-04-21": [
          {
            provider: "google_fit",
            metrics: {
              steps: 7000,
              sleepMinutes: 420,
              screenTimeMinutes: 140,
              spendingTotal: 12.5,
            },
            context: {
              calendar: { meetingsCount: 2, busyMinutes: 120 },
              activitySummary: { callsCount: 1, callDurationMinutes: 18 },
            },
          },
        ],
        "2026-04-20": [
          {
            provider: "google_fit",
            metrics: {
              steps: 5000,
              sleepMinutes: 390,
              screenTimeMinutes: 160,
            },
          },
        ],
      },
    });

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
    const days: Record<string, DayFixture> = {
      "2026-04-21": { rating: 3, manualNotes: ["n1"], peopleTags: [] },
      "2026-04-20": { rating: 4, manualNotes: ["n1"], peopleTags: [] },
      "2026-04-19": { rating: 4, manualNotes: ["n1", "n2"], peopleTags: [] },
      "2026-04-18": { rating: 5, manualNotes: ["n1", "n2"], peopleTags: [] },
    };
    const memories: Record<string, MemoryFixture[]> = {
      "2026-04-21": [{ _id: "m1" }],
      "2026-04-20": [{ _id: "m2" }, { _id: "m3" }],
      "2026-04-19": [{ _id: "m4" }, { _id: "m5" }, { _id: "m6" }],
      "2026-04-18": [{ _id: "m7" }, { _id: "m8" }, { _id: "m9" }],
    };
    const summaries: Record<string, SummaryFixture> = {
      "2026-04-21": { highlights: [] },
      "2026-04-20": { highlights: [] },
      "2026-04-19": { highlights: ["h"] },
      "2026-04-18": { highlights: ["h1", "h2"] },
    };
    const integrations: Record<string, IntegrationFixture[]> = {
      "2026-04-21": [
        { provider: "google_fit", metrics: { steps: 3000, sleepMinutes: 350 } },
      ],
      "2026-04-20": [
        { provider: "google_fit", metrics: { steps: 4500, sleepMinutes: 390 } },
      ],
      "2026-04-19": [
        { provider: "google_fit", metrics: { steps: 6000, sleepMinutes: 410 } },
      ],
      "2026-04-18": [
        { provider: "google_fit", metrics: { steps: 7500, sleepMinutes: 430 } },
      ],
    };

    const runQuery = buildRunQuery({
      identity: { userId: "user_001" },
      preferences: { focusAreas: [0, 2] },
      recentDays: [
        { dayKey: "2026-04-21" },
        { dayKey: "2026-04-20" },
        { dayKey: "2026-04-19" },
        { dayKey: "2026-04-18" },
      ],
      existingVectors: [],
      days,
      memories,
      summaries,
      integrations,
    });

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
    const runQuery = buildRunQuery({
      identity: { userId: "user_001" },
      preferences: { focusAreas: [0] },
      recentDays: [{}],
      existingVectors: [],
      days: {},
      memories: {},
      summaries: {},
      integrations: {},
    });

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
