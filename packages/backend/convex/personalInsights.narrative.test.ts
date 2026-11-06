import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const callOpenAiChatJsonWithUsage = vi.fn();

vi.mock("./providerAdapters", () => ({
  callOpenAiChatJsonWithUsage,
}));

type Handler = (
  ctx: {
    runQuery: ReturnType<typeof vi.fn>;
    runMutation: ReturnType<typeof vi.fn>;
  },
  args: { windowDays?: number },
) => Promise<{
  narrative: string;
  highlights: string[];
  anomalies: string[];
  recommendedFocus: string[];
  sourceDays: number;
}>;

let generateInsightNarrative: Handler;

function name(ref: unknown): string {
  return getFunctionName(ref as never);
}

beforeAll(async () => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.daylog.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_valid_key_1234567890";
  process.env.OPENAI_API_KEY ??= "sk-test-valid-key-1234567890";
  generateInsightNarrative = (
    (await import("./personalInsights")).generateInsightNarrative as unknown as {
      _handler: Handler;
    }
  )._handler;
});

beforeEach(() => {
  callOpenAiChatJsonWithUsage.mockReset();
});

function buildContext(recentDays: Array<{ dayKey: string }>) {
  const vectors = recentDays.map((day, index) => ({
    dayKey: day.dayKey,
    features: {
      rating: 3 + index,
      memoryCount: 2 + index,
      noteCount: 1,
      peopleTagCount: 1,
      highlightCount: 2,
      steps: 5000 + index * 100,
      sleepMinutes: 420,
      integrationProviderCount: 1,
    },
  }));
  const runQuery = vi.fn(async (ref: unknown) => {
    const refName = name(ref);
    if (refName.endsWith("getSummaryGenerationIdentity")) {
      return { userId: "user_narrative" };
    }
    if (refName.endsWith("listRecentDays")) return recentDays;
    if (refName.endsWith("listMyDailyFeatureVectorsByDayKeys")) return vectors;
    throw new Error(`Unexpected query: ${refName}`);
  });
  return { runQuery, runMutation: vi.fn().mockResolvedValue(undefined) };
}

describe("personal insight narrative", () => {
  it("generates a bounded narrative, filters model arrays, and records usage", async () => {
    callOpenAiChatJsonWithUsage.mockResolvedValueOnce({
      data: {
        narrative: "  Your activity is trending upward. ",
        highlights: ["  More steps ", "", 12, "Better sleep"],
        anomalies: ["late night"],
        recommendedFocus: ["Keep walking"],
      },
      usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
    });
    const context = buildContext([{ dayKey: "2026-04-20" }, { dayKey: "2026-04-19" }]);

    const result = await generateInsightNarrative(context, { windowDays: 2 });

    expect(result).toMatchObject({
      narrative: "Your activity is trending upward.",
      highlights: ["More steps", "Better sleep"],
      anomalies: ["late night"],
      recommendedFocus: ["Keep walking"],
      sourceDays: 2,
    });
    expect(context.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: "personal_insight",
        usageSource: "provider",
        totalTokens: 100,
      }),
    );
    expect(callOpenAiChatJsonWithUsage).toHaveBeenCalledTimes(1);
  });

  it("returns the cached narrative without another model call", async () => {
    callOpenAiChatJsonWithUsage.mockResolvedValueOnce({
      data: { narrative: "Cached insight", highlights: [], anomalies: [], recommendedFocus: [] },
    });
    const firstContext = buildContext([{ dayKey: "2026-04-21" }]);
    await generateInsightNarrative(firstContext, { windowDays: 1 });

    const secondContext = buildContext([{ dayKey: "2026-04-21" }]);
    await expect(
      generateInsightNarrative(secondContext, { windowDays: 1 }),
    ).resolves.toMatchObject({ narrative: "Cached insight" });
    expect(callOpenAiChatJsonWithUsage).toHaveBeenCalledTimes(1);
    expect(secondContext.runMutation).not.toHaveBeenCalled();
  });

  it("rejects when there are no days or no vectors", async () => {
    await expect(
      generateInsightNarrative(buildContext([]), { windowDays: 7 }),
    ).rejects.toThrow("No recent day data");

  });
});
