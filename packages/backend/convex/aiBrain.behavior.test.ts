import { beforeAll, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const callOpenAiChatJsonWithUsage = vi.fn();

vi.mock("./providerAdapters", () => ({
  callOpenAiChatJsonWithUsage,
}));

type ActionHandler = {
  _handler: (
    ctx: {
      runMutation: ReturnType<typeof vi.fn>;
      runQuery: ReturnType<typeof vi.fn>;
    },
    args: { question: string },
  ) => Promise<unknown>;
};

let askYourDay: ActionHandler["_handler"];

function functionName(ref: unknown): string {
  return getFunctionName(ref as never);
}

beforeAll(async () => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.daylog.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_valid_key_1234567890";
  process.env.OPENAI_API_KEY ??= "sk-test-valid-key-1234567890";
  askYourDay = (
    (await import("./aiBrain")).askYourDay as unknown as ActionHandler
  )._handler;
});

describe("aiBrain.askYourDay", () => {
  it("uses recent context, sanitizes model output, and records provider usage", async () => {
    callOpenAiChatJsonWithUsage.mockResolvedValueOnce({
      data: {
        answer: "  You made time for exercise.  ",
        evidence: ["  Gym at 7am ", "", 42, "A second record"],
        hasEnoughInformation: true,
      },
      usage: { promptTokens: 120, completionTokens: 18, totalTokens: 138 },
    });

    const runMutation = vi.fn().mockResolvedValue(undefined);
    const runQuery = vi.fn(async (ref: unknown) => {
      const name = functionName(ref);
      if (name.endsWith("listRecentMemories")) {
        return [{ title: "Gym", mood: "focused", happenedAt: 123 }];
      }
      if (name.endsWith("listRecentSummaries")) {
        return [{ dayKey: "2026-04-20", story: "A productive day" }];
      }
      if (name.endsWith("getSummaryGenerationIdentity")) {
        return { userId: "user_1" };
      }
      throw new Error(`Unexpected query: ${name}`);
    });

    const result = await askYourDay(
      { runMutation, runQuery },
      { question: " What helped me focus? " },
    );

    expect(result).toEqual({
      answer: "You made time for exercise.",
      evidence: ["Gym at 7am", "A second record"],
      hasEnoughInformation: true,
    });
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      userId: "user_1",
      operation: "ask_your_day",
      usageSource: "provider",
      totalTokens: 138,
    });
    expect(callOpenAiChatJsonWithUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "ask_your_day",
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining("Question: What helped me focus?"),
          }),
        ]),
      }),
    );
  });

  it("uses safe answer and token estimates when the provider omits data", async () => {
    callOpenAiChatJsonWithUsage.mockResolvedValueOnce({ data: {} });
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const runQuery = vi.fn(async (ref: unknown) => {
      const name = functionName(ref);
      if (name.endsWith("getSummaryGenerationIdentity")) return { userId: "user_2" };
      return [];
    });

    const result = await askYourDay(
      { runMutation, runQuery },
      { question: "What do I remember?" },
    );

    expect(result).toEqual({
      answer: "I don't have enough information in your DayLog to answer that yet.",
      evidence: [],
      hasEnoughInformation: false,
    });
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      usageSource: "estimated",
      promptTokens: expect.any(Number),
      completionTokens: expect.any(Number),
    });
  });

  it("rejects blank and oversized questions before reserving quota", async () => {
    callOpenAiChatJsonWithUsage.mockClear();
    const runMutation = vi.fn();
    const runQuery = vi.fn();

    await expect(
      askYourDay({ runMutation, runQuery }, { question: "   " }),
    ).rejects.toThrow("requires a question");
    await expect(
      askYourDay({ runMutation, runQuery }, { question: "x".repeat(501) }),
    ).rejects.toThrow("500 characters or fewer");
    expect(runMutation).not.toHaveBeenCalled();
    expect(callOpenAiChatJsonWithUsage).not.toHaveBeenCalled();
  });
});
