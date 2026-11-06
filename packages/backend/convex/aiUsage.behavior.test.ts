import { beforeAll, describe, expect, it } from "vitest";
import { createInMemoryDb } from "../test-utils/inMemoryConvex";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const user = {
  _id: "user_1",
  _creationTime: 1,
  clerkUserId: "clerk_1",
  accountStatus: "active",
  isAdmin: false,
};

type UsageArgs = {
  userId: string;
  operation: "summary_generation" | "personal_insight" | "ask_your_day";
  model: string;
  status: "succeeded" | "failed";
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  usageSource: "provider" | "estimated";
};

let recordAiUsageInternal: (ctx: unknown, args: UsageArgs) => Promise<string>;
let getMyAiUsage: (
  ctx: unknown,
  args: { days?: number },
) => Promise<Array<{ _id: string }>>;

beforeAll(async () => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.daylog.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_valid_key_1234567890";
  process.env.OPENAI_API_KEY ??= "sk-test-valid-key-1234567890";
  const module = await import("./aiUsage");
  recordAiUsageInternal = handler(module.recordAiUsageInternal);
  getMyAiUsage = handler(module.getMyAiUsage);
});

describe("aiUsage", () => {
  it("records finite token usage and calculates the configured cost", async () => {
    const db = createInMemoryDb({ user: [user] });
    const id = await recordAiUsageInternal(
      { db },
      {
        userId: "user_1",
        operation: "summary_generation",
        model: "gpt-4o",
        status: "succeeded",
        promptTokens: 1000,
        completionTokens: 2000,
        totalTokens: 3000,
        usageSource: "provider",
      },
    );

    const record = await db.get(id);
    expect(record).toMatchObject({
      userId: "user_1",
      totalTokens: 3000,
      estimatedCostUsd: 0.035,
      usageSource: "provider",
    });
  });

  it("normalizes non-finite token values and supports records without usage", async () => {
    const db = createInMemoryDb({ user: [user] });
    const id = await recordAiUsageInternal(
      { db },
      {
        userId: "user_1",
        operation: "ask_your_day",
        model: "gpt-4o",
        status: "failed",
        promptTokens: Number.NaN,
        completionTokens: Number.POSITIVE_INFINITY,
        usageSource: "estimated",
      },
    );

    await expect(db.get(id)).resolves.toMatchObject({
      promptTokens: undefined,
      completionTokens: undefined,
      totalTokens: undefined,
      estimatedCostUsd: undefined,
    });
  });

  it("returns only the signed-in user's recent usage with a clamped day range", async () => {
    const now = Date.now();
    const db = createInMemoryDb({
      user: [user, { ...user, _id: "user_2", clerkUserId: "clerk_2" }],
      aiUsageRecords: [
        {
          _id: "old",
          _creationTime: 1,
          userId: "user_1",
          operation: "summary_generation",
          createdAt: now - 40 * 24 * 60 * 60 * 1000,
        },
        {
          _id: "recent",
          _creationTime: 2,
          userId: "user_1",
          operation: "ask_your_day",
          createdAt: now - 2 * 60 * 60 * 1000,
        },
        {
          _id: "other-user",
          _creationTime: 3,
          userId: "user_2",
          operation: "ask_your_day",
          createdAt: now,
        },
      ],
    });

    const result = await getMyAiUsage(
      {
        db,
        auth: { getUserIdentity: async () => ({ subject: "clerk_1" }) },
      },
      { days: 0 },
    );

    expect(result.map((record: { _id: string }) => record._id)).toEqual([
      "recent",
    ]);
  });

  it("rejects usage queries without an authenticated user", async () => {
    const db = createInMemoryDb();
    await expect(
      getMyAiUsage(
        { db, auth: { getUserIdentity: async () => null } },
        { days: 30 },
      ),
    ).rejects.toThrow("Unauthorized");
  });
});
