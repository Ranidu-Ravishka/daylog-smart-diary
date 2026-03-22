import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let OpenAiRequestError: typeof import("./summaryGeneration").OpenAiRequestError;
let isRetryableOpenAiError: typeof import("./summaryGeneration").isRetryableOpenAiError;
let isRetryableOpenAiStatus: typeof import("./summaryGeneration").isRetryableOpenAiStatus;
let normalizeModelOutput: typeof import("./summaryGeneration").normalizeModelOutput;
let generateSummaryForDay: typeof import("./summaryGeneration").generateSummaryForDay;

function getHandler<TArgs extends Record<string, unknown>, TResult>(
  fn: unknown,
): (ctx: Record<string, unknown>, args: TArgs) => Promise<TResult> {
  const handler = (fn as { _handler?: unknown })._handler;
  if (typeof handler !== "function") {
    throw new Error("Convex function handler not found");
  }
  return handler as (
    ctx: Record<string, unknown>,
    args: TArgs,
  ) => Promise<TResult>;
}

beforeAll(async () => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.accounts.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_secret";
  process.env.OPENAI_API_KEY ??= "sk-test-key";

  const mod = await import("./summaryGeneration");
  OpenAiRequestError = mod.OpenAiRequestError;
  isRetryableOpenAiError = mod.isRetryableOpenAiError;
  isRetryableOpenAiStatus = mod.isRetryableOpenAiStatus;
  normalizeModelOutput = mod.normalizeModelOutput;
  generateSummaryForDay = mod.generateSummaryForDay;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("summary generation retry behavior", () => {
  it("marks 429 and 5xx statuses as retryable", () => {
    expect(isRetryableOpenAiStatus(429)).toBe(true);
    expect(isRetryableOpenAiStatus(500)).toBe(true);
    expect(isRetryableOpenAiStatus(503)).toBe(true);
  });

  it("marks other 4xx statuses as non-retryable", () => {
    expect(isRetryableOpenAiStatus(400)).toBe(false);
    expect(isRetryableOpenAiStatus(401)).toBe(false);
    expect(isRetryableOpenAiStatus(404)).toBe(false);
  });

  it("treats retryable error types correctly", () => {
    expect(
      isRetryableOpenAiError(new OpenAiRequestError(429, "rate limit", true)),
    ).toBe(true);
    expect(
      isRetryableOpenAiError(new OpenAiRequestError(400, "bad request", false)),
    ).toBe(false);
    expect(isRetryableOpenAiError(new TypeError("network error"))).toBe(true);
    expect(isRetryableOpenAiError(new Error("other error"))).toBe(false);
  });
});

describe("summary generation output normalization", () => {
  it("falls back to safe defaults when payload shape is invalid", () => {
    const output = normalizeModelOutput({
      story: "",
      highlights: ["ok", 1, "  ", "great day"],
      sourcesUsed: ["", "Memories"],
      metrics: {
        steps: Number.NaN,
        sleepMinutes: 450,
        spendingTotal: Infinity,
      },
    });

    expect(output.story).toContain("meaningful day");
    expect(output.highlights).toEqual(["ok", "great day"]);
    expect(output.sourcesUsed).toEqual(["Memories"]);
    expect(output.metrics).toEqual({
      steps: undefined,
      sleepMinutes: 450,
      screenTimeMinutes: undefined,
      spendingTotal: undefined,
    });
  });

  it("supplies default sources when none are provided", () => {
    const output = normalizeModelOutput({
      story: "A short story",
      highlights: [],
      sourcesUsed: [],
    });

    expect(output.sourcesUsed).toEqual([
      "Memories",
      "Day metadata",
      "OpenAI GPT-4o",
    ]);
  });
});

describe("summary generation with integration data", () => {
  it("throws when memories, day metadata, and integrations are all empty", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([]);
    const runMutation = vi.fn();

    const handler = getHandler<
      { dayKey: string },
      { success: boolean; summaryId?: string; generatedAt?: number }
    >(generateSummaryForDay);

    await expect(
      handler(
        {
          runQuery,
          runMutation,
        },
        { dayKey: "2025-03-11" },
      ),
    ).rejects.toThrow(
      "No memories, day metadata, or integration sync data found for this date. Add data before generating a summary.",
    );

    expect(runMutation).not.toHaveBeenCalled();
  });

  it("generates summary when only integration sync data exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  story: "Integration-only day summary",
                  highlights: ["Pulled from integrations"],
                  metrics: {},
                  sourcesUsed: ["OpenAI GPT-4o"],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([
        {
          provider: "google_fit",
          metrics: { steps: 6342, sleepMinutes: 420 },
          summary: "Good activity",
          signals: ["6,342 steps", "420 sleep minutes"],
          syncedAt: Date.now(),
        },
      ]);
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ _id: "daySummaries:1", generatedAt: 123 });

    const handler = getHandler<
      { dayKey: string },
      { success: boolean; summaryId?: string; generatedAt?: number }
    >(generateSummaryForDay);
    const result = await handler(
      {
        runQuery,
        runMutation,
      },
      { dayKey: "2025-03-12" },
    );

    expect(result).toMatchObject({
      success: true,
      summaryId: "daySummaries:1",
      generatedAt: 123,
    });

    const upsertArgs = runMutation.mock.calls[1]?.[1];
    expect(upsertArgs.metrics).toMatchObject({
      steps: 6342,
      sleepMinutes: 420,
    });
    expect(upsertArgs.sourcesUsed).toEqual(
      expect.arrayContaining(["Integrations", "Google Fit"]),
    );
  });

  it("merges partial provider metrics with model output safely", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  story: "Mixed-source summary",
                  highlights: ["Model had partial metrics"],
                  metrics: { steps: 4200 },
                  sourcesUsed: ["Memories"],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([{ title: "Walk", happenedAt: 1739922000000 }])
      .mockResolvedValueOnce({ rating: 4, manualNotes: [], peopleTags: [] })
      .mockResolvedValueOnce([
        {
          provider: "spotify",
          summary: "Music activity only",
          signals: ["12 tracks played"],
          syncedAt: Date.now(),
        },
        {
          provider: "apple_health",
          metrics: { spendingTotal: 12.345, screenTimeMinutes: 95 },
          summary: "Apple Health upload",
          signals: ["95 screen minutes"],
          syncedAt: Date.now(),
        },
      ]);

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ _id: "daySummaries:2", generatedAt: 456 });

    const handler = getHandler<
      { dayKey: string },
      { success: boolean; summaryId?: string; generatedAt?: number }
    >(generateSummaryForDay);
    await handler(
      {
        runQuery,
        runMutation,
      },
      { dayKey: "2025-03-13" },
    );

    const upsertArgs = runMutation.mock.calls[1]?.[1];
    expect(upsertArgs.metrics).toMatchObject({
      steps: 4200,
      screenTimeMinutes: 95,
      spendingTotal: 12.35,
    });
    expect(upsertArgs.sourcesUsed).toEqual(
      expect.arrayContaining(["Integrations", "Spotify", "Apple Health"]),
    );
  });
});
