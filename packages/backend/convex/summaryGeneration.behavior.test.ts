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
    expect(defaults.story).toBe("Quiet day with minimal activity to capture.");
    expect(defaults.sourcesUsed).toEqual([
      "Memories",
      "Day metadata",
      "OpenAI GPT-4o",
    ]);
  });

  it("strips internal metadata labels from model story output", () => {
    const normalized = summaryGenerationModule.normalizeModelOutput({
      story:
        "Connected data: activity_summary, calendar, location, spotify.\n\nThe afternoon felt calm and focused.",
      highlights: [],
      sourcesUsed: ["Memories"],
    });

    expect(normalized.story).toBe("The afternoon felt calm and focused.");
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
      .mockResolvedValueOnce(null) // cache miss: no existing summary
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
      .mockResolvedValueOnce({
        generationEventId: "event_001",
        evaluated: true,
        lowQuality: false,
        overallScore: 0.9,
      })
      .mockResolvedValueOnce("attempt_001")
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

    expect(runQuery.mock.calls[2]?.[1]).toEqual({
      dayKey: "2026-04-02",
      limit: 50,
    });
    expect(runQuery.mock.calls[4]?.[1]).toEqual({
      dayKey: "2026-04-02",
      limit: 32,
    });

    expect(runMutation).toHaveBeenCalledTimes(5);

    const upsertCallArgs = runMutation.mock.calls[3]?.[1] as {
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
      .mockResolvedValueOnce(null) // cache miss
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
      .mockResolvedValueOnce({
        generationEventId: "event_002",
        evaluated: true,
        lowQuality: false,
        overallScore: 0.9,
      })
      .mockResolvedValueOnce("attempt_002")
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

    const upsertCallArgs = runMutation.mock.calls[3]?.[1] as {
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
      .mockResolvedValueOnce(null) // cache miss
      .mockResolvedValueOnce(oversizedMemories)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ userId: "user_001" });

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({
        generationEventId: "event_003",
        evaluated: true,
        lowQuality: false,
        overallScore: 0.9,
      })
      .mockResolvedValueOnce("attempt_003")
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

    expect(runQuery.mock.calls[2]?.[1]).toEqual({
      dayKey: "2026-04-04",
      limit: 50,
    });
    expect(runQuery.mock.calls[4]?.[1]).toEqual({
      dayKey: "2026-04-04",
      limit: 32,
    });

    const qualityArgs = runMutation.mock.calls[1]?.[1] as {
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
      .mockResolvedValueOnce(null) // cache miss
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
      .mockResolvedValueOnce(null) // cache miss
      .mockResolvedValueOnce([{ title: "Memory", happenedAt: 1 }])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ userId: "user_001" });

    // After AI failure, the action now falls back to a deterministic
    // rule-based summary (never empty UI), persists it via upsertSummary,
    // and refunds the quota slot. We assert the resilient success shape.
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({
        generationEventId: "event_fail_001",
        evaluated: false,
      })
      .mockResolvedValueOnce("attempt_fail_001")
      .mockResolvedValueOnce({ _id: "summary_fallback", generatedAt: 999 })
      .mockResolvedValueOnce({ refunded: true });

    const fallbackResult = await generateSummaryForDay(
      {
        runQuery: failingRunQuery,
        runMutation,
      },
      { dayKey: "2026-04-02" },
    );

    expect(fallbackResult).toMatchObject({
      success: true,
      fallback: true,
      summaryId: "summary_fallback",
      generatedAt: 999,
    });

    expect(runMutation).toHaveBeenCalledTimes(5);
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

  it("retries low-quality summaries when autopilot is enabled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    story: "Too short",
                    highlights: ["short"],
                    sourcesUsed: ["Memories"],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    story:
                      "Today started with focused planning and two completed priorities, followed by a healthy walk and clear preparation for tomorrow.",
                    highlights: ["Completed priorities", "Healthy walk"],
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
          aiSummaryAutopilotEnabled: true,
        },
      })
      .mockResolvedValueOnce(null) // cache miss
      .mockResolvedValueOnce([{ title: "Memory", happenedAt: 1 }])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ userId: "user_001" });

    const runMutation = vi
      .fn()
      // attempt 1
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({
        generationEventId: "event_low",
        evaluated: true,
        lowQuality: true,
        overallScore: 0.2,
      })
      .mockResolvedValueOnce("attempt_low")
      // attempt 2
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({
        generationEventId: "event_good",
        evaluated: true,
        lowQuality: false,
        overallScore: 0.9,
      })
      .mockResolvedValueOnce("attempt_good")
      // save + mark best
      .mockResolvedValueOnce({ _id: "summary_best", generatedAt: 999 })
      .mockResolvedValueOnce({ success: true });

    const generateSummaryForDay = handler<
      { dayKey: string },
      { success: boolean; summaryId?: string }
    >(summaryGenerationModule.generateSummaryForDay);

    const result = await generateSummaryForDay(
      {
        runQuery,
        runMutation,
      },
      { dayKey: "2026-04-08" },
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runMutation).toHaveBeenCalledTimes(8);
  });
});
