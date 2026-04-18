import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let summaryGenerationModule: typeof import("./summaryGeneration");

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

beforeAll(() => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.daylog.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_valid_key_1234567890";
  process.env.OPENAI_API_KEY ??= "sk-test-valid-key-1234567890";
});

beforeAll(async () => {
  summaryGenerationModule = await import("./summaryGeneration");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("summary generation behavior", () => {
  it("normalizes model output and retry helpers", () => {
    expect(summaryGenerationModule.isRetryableOpenAiStatus(429)).toBe(true);
    expect(summaryGenerationModule.isRetryableOpenAiStatus(503)).toBe(true);
    expect(summaryGenerationModule.isRetryableOpenAiStatus(400)).toBe(false);

    expect(
      summaryGenerationModule.isRetryableOpenAiError(
        new summaryGenerationModule.OpenAiRequestError(503, "retry", true),
      ),
    ).toBe(true);
    expect(
      summaryGenerationModule.isRetryableOpenAiError(new TypeError("network")),
    ).toBe(true);
    expect(
      summaryGenerationModule.isRetryableOpenAiError(new Error("other")),
    ).toBe(false);

    const normalized = summaryGenerationModule.normalizeModelOutput({
      story: "  Great day  ",
      highlights: [" one ", "", 123, "two"],
      metrics: {
        steps: 5000,
        sleepMinutes: 420,
        screenTimeMinutes: 120,
        spendingTotal: 12.5,
      },
      sourcesUsed: [" Memories ", "", 1, "Spotify"],
    });

    expect(normalized.story).toBe("Great day");
    expect(normalized.highlights).toEqual(["one", "two"]);
    expect(normalized.metrics).toEqual({
      steps: 5000,
      sleepMinutes: 420,
      screenTimeMinutes: 120,
      spendingTotal: 12.5,
    });
    expect(normalized.sourcesUsed).toEqual(["Memories", "Spotify"]);

    const defaults = summaryGenerationModule.normalizeModelOutput({});
    expect(defaults.story).toContain("meaningful day");
    expect(defaults.sourcesUsed).toEqual([
      "Memories",
      "Day metadata",
      "OpenAI GPT-4o",
    ]);
  });

  it("supports direct model generation through OpenAI adapter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  story: "Generated story",
                  highlights: ["h1"],
                  sourcesUsed: ["Memories"],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const generated = await summaryGenerationModule.generateSummaryWithOpenAi(
      "2026-04-02",
      "[]",
    );
    expect(generated.story).toBe("Generated story");
    expect(generated.highlights).toEqual(["h1"]);
  });

  it("runs full generateSummaryForDay action and merges integration context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  story: "Model summary",
                  highlights: ["kept momentum"],
                  metrics: {
                    steps: 8000,
                  },
                  sourcesUsed: ["Memories"],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        flags: {
          aiSummaryEnabled: true,
        },
      })
      .mockResolvedValueOnce([
        {
          title: "Memory one",
          description: "desc",
          mood: "happy",
          happenedAt: 1,
        },
      ])
      .mockResolvedValueOnce({
        rating: 4,
        manualNotes: ["focus"],
        peopleTags: ["Alex"],
      })
      .mockResolvedValueOnce([
        {
          provider: "spotify",
          metrics: { steps: 9000, spendingTotal: 10.25 },
          summary: "music",
          signals: ["morning run", "morning run"],
          syncedAt: 1,
        },
      ])
      .mockResolvedValueOnce({ userId: "user_001" });

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ _id: "summary_001", generatedAt: 123 })
      .mockResolvedValueOnce({ success: true });

    const generateSummaryForDay = handler<
      { dayKey: string },
      { success: boolean; summaryId?: string; generatedAt?: number }
    >(summaryGenerationModule.generateSummaryForDay);

    const result = await generateSummaryForDay(
      {
        runQuery,
        runMutation,
      },
      { dayKey: "2026-04-02" },
    );

    expect(result).toEqual({
      success: true,
      summaryId: "summary_001",
      generatedAt: 123,
    });

    expect(runQuery.mock.calls[1]?.[1]).toEqual({
      dayKey: "2026-04-02",
      limit: 50,
    });
    expect(runQuery.mock.calls[3]?.[1]).toEqual({
      dayKey: "2026-04-02",
      limit: 32,
    });

    expect(runMutation).toHaveBeenCalledTimes(3);

    const upsertCallArgs = runMutation.mock.calls[1]?.[1] as {
      metrics?: {
        steps?: number;
        spendingTotal?: number;
      };
      sourcesUsed?: string[];
    };
    expect(upsertCallArgs.metrics?.steps).toBe(8000);
    expect(upsertCallArgs.metrics?.spendingTotal).toBe(10.25);
    expect(upsertCallArgs.sourcesUsed).toEqual(
      expect.arrayContaining(["Memories", "Integrations", "Spotify"]),
    );
  });

  it("generates a summary from integration-only context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  story: "Integration only summary",
                  highlights: ["stayed active"],
                  sourcesUsed: ["Model"],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        flags: {
          aiSummaryEnabled: true,
        },
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([
        {
          provider: "google_fit",
          metrics: {
            steps: 11234,
            sleepMinutes: 415,
          },
          summary: "Long walk with steady activity",
          signals: ["morning walk", "morning walk"],
          context: {
            fitness: {
              distanceMeters: 3200,
              activeMinutes: 52,
            },
          },
          syncedAt: 1,
        },
      ])
      .mockResolvedValueOnce({ userId: "user_001" });

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ _id: "summary_002", generatedAt: 456 })
      .mockResolvedValueOnce({ success: true });

    const generateSummaryForDay = handler<
      { dayKey: string },
      { success: boolean; summaryId?: string; generatedAt?: number }
    >(summaryGenerationModule.generateSummaryForDay);

    const result = await generateSummaryForDay(
      {
        runQuery,
        runMutation,
      },
      { dayKey: "2026-04-03" },
    );

    expect(result).toEqual({
      success: true,
      summaryId: "summary_002",
      generatedAt: 456,
    });

    const upsertCallArgs = runMutation.mock.calls[1]?.[1] as {
      metrics?: {
        steps?: number;
        sleepMinutes?: number;
      };
      sourcesUsed?: string[];
    };

    expect(upsertCallArgs.metrics).toMatchObject({
      steps: 11234,
      sleepMinutes: 415,
    });
    expect(upsertCallArgs.sourcesUsed).toEqual(
      expect.arrayContaining(["Model", "Integrations", "Google Fit"]),
    );
  });

  it("caps summary memory payload size before model generation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  story: "Trimmed memory input",
                  highlights: ["kept latest context"],
                  sourcesUsed: ["Memories"],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const largeDescription = "x".repeat(30_000);
    const oversizedMemories = Array.from({ length: 10 }, (_, index) => ({
      title: `Memory ${String(index + 1)}`,
      description: largeDescription,
      mood: "focused",
      happenedAt: 1_000 - index,
    }));

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        flags: {
          aiSummaryEnabled: true,
        },
      })
      .mockResolvedValueOnce(oversizedMemories)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ userId: "user_001" });

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ _id: "summary_003", generatedAt: 789 })
      .mockResolvedValueOnce({ success: true });

    const generateSummaryForDay = handler<
      { dayKey: string },
      { success: boolean; summaryId?: string; generatedAt?: number }
    >(summaryGenerationModule.generateSummaryForDay);

    const result = await generateSummaryForDay(
      {
        runQuery,
        runMutation,
      },
      { dayKey: "2026-04-04" },
    );

    expect(result).toEqual({
      success: true,
      summaryId: "summary_003",
      generatedAt: 789,
    });

    expect(runQuery.mock.calls[1]?.[1]).toEqual({
      dayKey: "2026-04-04",
      limit: 50,
    });
    expect(runQuery.mock.calls[3]?.[1]).toEqual({
      dayKey: "2026-04-04",
      limit: 32,
    });

    const qualityArgs = runMutation.mock.calls[2]?.[1] as {
      modelInput: string;
    };
    const modelInputBytes = new TextEncoder().encode(
      qualityArgs.modelInput,
    ).length;
    const parsedModelInput = JSON.parse(qualityArgs.modelInput) as {
      memories: Array<{ title: string }>;
    };

    expect(modelInputBytes).toBeLessThanOrEqual(100_000);
    expect(parsedModelInput.memories.length).toBeGreaterThan(0);
    expect(parsedModelInput.memories.length).toBeLessThan(
      oversizedMemories.length,
    );
  });

  it("rejects generation when no data is available and logs model failures", async () => {
    const generateSummaryForDay = handler<
      { dayKey: string },
      {
        success: boolean;
        summaryId?: string;
        generatedAt?: number;
        errorCode?: string;
        message?: string;
      }
    >(summaryGenerationModule.generateSummaryForDay);

    const noDataRunQuery = vi
      .fn()
      .mockResolvedValueOnce({
        flags: {
          aiSummaryEnabled: true,
        },
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([]);

    await expect(
      generateSummaryForDay(
        {
          runQuery: noDataRunQuery,
          runMutation: vi.fn(),
        },
        { dayKey: "2026-04-02" },
      ),
    ).resolves.toEqual({
      success: false,
      errorCode: "no_input_data",
      message:
        "Add at least one memory, day note/rating/tag, or synced integration data before generating a summary.",
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("bad request", {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const failingRunQuery = vi
      .fn()
      .mockResolvedValueOnce({
        flags: {
          aiSummaryEnabled: true,
        },
      })
      .mockResolvedValueOnce([{ title: "Memory", happenedAt: 1 }])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ userId: "user_001" });

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });

    await expect(
      generateSummaryForDay(
        {
          runQuery: failingRunQuery,
          runMutation,
        },
        { dayKey: "2026-04-02" },
      ),
    ).resolves.toEqual({
      success: false,
      errorCode: "model_generation_failed",
      message: "OpenAI request failed (400)",
    });

    expect(runMutation).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable when ai summary feature flag is disabled", async () => {
    const generateSummaryForDay = handler<
      { dayKey: string },
      {
        success: boolean;
        summaryId?: string;
        generatedAt?: number;
        errorCode?: string;
        message?: string;
      }
    >(summaryGenerationModule.generateSummaryForDay);

    const runQuery = vi.fn().mockResolvedValueOnce({
      flags: {
        aiSummaryEnabled: false,
      },
    });
    const runMutation = vi.fn();

    await expect(
      generateSummaryForDay(
        {
          runQuery,
          runMutation,
        },
        { dayKey: "2026-04-02" },
      ),
    ).resolves.toEqual({
      success: false,
      errorCode: "model_generation_failed",
      message:
        "AI summaries are temporarily unavailable. Please try again later.",
    });

    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runMutation).not.toHaveBeenCalled();
  });
});
