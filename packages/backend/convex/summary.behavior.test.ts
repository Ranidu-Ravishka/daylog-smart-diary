import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import {
  reserveSummaryGenerationSlotForUser,
  upsertSummaryForUserDay,
} from "./summaries";
import { createInMemoryDb } from "../test-utils/inMemoryConvex";
import {
  readSummarySensitiveFields,
  type SummarySensitiveRecord,
} from "./sensitiveDataFields";

const USER_ID = "user_001" as Id<"user">;

let generateSummaryWithOpenAi: (
  dayKey: string,
  memoriesJson: string,
) => Promise<{
  story: string;
  highlights: string[];
  sourcesUsed: string[];
}>;

beforeAll(async () => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.daylog.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_valid_key_1234567890";
  process.env.OPENAI_API_KEY ??= "sk-test-valid-key-1234567890";

  ({ generateSummaryWithOpenAi } = await import("./summaryGeneration"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("summary flow behavior", () => {
  it("enforces daily quota exactly and blocks overflow", async () => {
    const db = createInMemoryDb();
    const now = Date.parse("2026-03-30T12:00:00.000Z");

    const first = await reserveSummaryGenerationSlotForUser(
      db as never,
      USER_ID,
      now,
      2,
    );
    expect(first.used).toBe(1);
    expect(first.remaining).toBe(1);

    const second = await reserveSummaryGenerationSlotForUser(
      db as never,
      USER_ID,
      now,
      2,
    );
    expect(second.used).toBe(2);
    expect(second.remaining).toBe(0);

    await expect(
      reserveSummaryGenerationSlotForUser(db as never, USER_ID, now, 2),
    ).rejects.toThrow("Daily summary limit reached (2/day)");

    const quotaRows = db.getTable("summaryGenerationQuotas");
    expect(quotaRows).toHaveLength(1);
    expect(quotaRows[0]?.used).toBe(2);
  });

  it("rolls quota over on UTC day boundary", async () => {
    const db = createInMemoryDb();

    const dayOne = Date.parse("2026-03-30T23:59:59.000Z");
    const dayTwo = Date.parse("2026-03-31T00:00:01.000Z");

    const first = await reserveSummaryGenerationSlotForUser(
      db as never,
      USER_ID,
      dayOne,
      1,
    );
    expect(first.used).toBe(1);
    expect(first.quotaDayKey).toBe("2026-03-30");

    const second = await reserveSummaryGenerationSlotForUser(
      db as never,
      USER_ID,
      dayTwo,
      1,
    );
    expect(second.used).toBe(1);
    expect(second.quotaDayKey).toBe("2026-03-31");

    const quotaRows = db.getTable("summaryGenerationQuotas");
    expect(quotaRows).toHaveLength(2);
  });

  it("upserts by user/day and never creates duplicates for retries", async () => {
    const db = createInMemoryDb();

    const first = await upsertSummaryForUserDay(
      db as never,
      USER_ID,
      {
        dayKey: "2026-03-30",
        story: "First summary",
        highlights: ["a"],
        sourcesUsed: ["memories"],
      },
      100,
    );

    const second = await upsertSummaryForUserDay(
      db as never,
      USER_ID,
      {
        dayKey: "2026-03-30",
        story: "Updated summary after retry",
        highlights: ["b"],
        sourcesUsed: ["memories"],
      },
      200,
    );

    expect(second?._id).toBe(first?._id);

    const summaries = db.getTable("daySummaries");
    expect(summaries).toHaveLength(1);
    const summarySensitive = await readSummarySensitiveFields(
      summaries[0] as unknown as SummarySensitiveRecord,
    );
    expect(summarySensitive.story).toBe("Updated summary after retry");
    expect(summaries[0]?.generatedAt).toBe(200);
  });

  it("retries transient OpenAI failures and succeeds deterministically", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("upstream unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    story: "A stable day summary",
                    highlights: ["Completed focused work"],
                    sourcesUsed: ["memories"],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Math, "random").mockReturnValue(0);

    const pending = generateSummaryWithOpenAi("2026-03-30", "[]");
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.story).toBe("A stable day summary");
    expect(result.highlights).toEqual(["Completed focused work"]);
  });

  it("fails fast on non-retryable OpenAI errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("bad request", {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateSummaryWithOpenAi("2026-03-30", "[]")).rejects.toThrow(
      "OpenAI request failed (400)",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sanitizes OpenAI authentication failures without leaking key details", async () => {
    const leakedKey = "sk-test-leaked-key-1234567890";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: `Incorrect API key provided: ${leakedKey}`,
          },
        }),
        {
          status: 401,
          statusText: "Unauthorized",
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await generateSummaryWithOpenAi("2026-03-30", "[]");
      throw new Error("Expected generateSummaryWithOpenAi to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toBe("OpenAI authentication failed (401)");
      expect(message).not.toContain(leakedKey);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails deterministically when model returns malformed JSON content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "{not-valid-json" } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateSummaryWithOpenAi("2026-03-30", "[]")).rejects.toThrow(
      "OpenAI summary output was not valid JSON.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
