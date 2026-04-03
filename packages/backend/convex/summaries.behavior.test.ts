import { afterEach, describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as summariesModule from "./summaries";

const originalSummaryDailyLimit = process.env.SUMMARY_DAILY_GENERATION_LIMIT;

afterEach(() => {
  if (originalSummaryDailyLimit === undefined) {
    delete process.env.SUMMARY_DAILY_GENERATION_LIMIT;
  } else {
    process.env.SUMMARY_DAILY_GENERATION_LIMIT = originalSummaryDailyLimit;
  }
});

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const USER_ID = "user_member_001" as Id<"user">;
const OTHER_USER_ID = "user_other_001" as Id<"user">;

function seededDb() {
  return createInMemoryDb({
    user: [
      {
        _id: USER_ID,
        _creationTime: 1,
        clerkUserId: "clerk_member_001",
        email: "member@example.com",
        isAdmin: false,
      },
      {
        _id: OTHER_USER_ID,
        _creationTime: 2,
        clerkUserId: "clerk_other_001",
        email: "other@example.com",
        isAdmin: false,
      },
    ],
  });
}

describe("summaries behavior", () => {
  it("supports get/upsert/list/delete flows with ownership checks", async () => {
    const db = seededDb();

    const upsertSummary = handler<
      {
        dayKey: string;
        story: string;
        highlights: string[];
        metrics?: {
          steps?: number;
        };
        sourcesUsed: string[];
      },
      { _id: Id<"daySummaries">; story: string; generatedAt: number } | null
    >(summariesModule.upsertSummary);
    const getSummaryByDay = handler<
      { dayKey: string },
      { _id: Id<"daySummaries"> } | null
    >(summariesModule.getSummaryByDay);
    const getSummaryById = handler<
      { summaryId: Id<"daySummaries"> },
      { _id: Id<"daySummaries">; story: string }
    >(summariesModule.getSummaryById);
    const listRecentSummaries = handler<
      { limit?: number },
      Array<{ _id: Id<"daySummaries">; dayKey: string }>
    >(summariesModule.listRecentSummaries);
    const deleteSummary = handler<
      { summaryId: Id<"daySummaries"> },
      { success: boolean }
    >(summariesModule.deleteSummary);

    const ctx = createAuthCtx(db, "clerk_member_001");

    const created = await upsertSummary(ctx, {
      dayKey: "2026-04-02",
      story: "A productive day",
      highlights: ["finished tasks"],
      metrics: { steps: 4000 },
      sourcesUsed: ["Memories"],
    });

    const summaryId = created?._id as Id<"daySummaries">;
    expect(created?.story).toBe("A productive day");

    const byDay = await getSummaryByDay(ctx, { dayKey: "2026-04-02" });
    expect(byDay?._id).toBe(summaryId);

    const byId = await getSummaryById(ctx, { summaryId });
    expect(byId.story).toBe("A productive day");

    const listed = await listRecentSummaries(ctx, { limit: 10 });
    expect(listed).toHaveLength(1);

    await expect(
      getSummaryById(createAuthCtx(db, "clerk_other_001"), { summaryId }),
    ).rejects.toThrow("Forbidden");

    const deleted = await deleteSummary(ctx, { summaryId });
    expect(deleted.success).toBe(true);
    expect(db.getTable("daySummaries")).toHaveLength(0);
  });

  it("reserves and reports daily quota usage", async () => {
    const db = seededDb();

    process.env.SUMMARY_DAILY_GENERATION_LIMIT = "2";

    const reserveSummaryGenerationSlot = handler<
      Record<string, never>,
      { used: number; limit: number; remaining: number }
    >(summariesModule.reserveSummaryGenerationSlot);
    const getSummaryQuotaForDay = handler<
      Record<string, never>,
      { used: number; limit: number; remaining: number }
    >(summariesModule.getSummaryQuotaForDay);
    const getSummaryGenerationIdentity = handler<
      Record<string, never>,
      { userId: string; clerkUserId: string }
    >(summariesModule.getSummaryGenerationIdentity);

    const ctx = createAuthCtx(db, "clerk_member_001");

    const first = await reserveSummaryGenerationSlot(ctx, {});
    expect(first.used).toBe(1);
    expect(first.remaining).toBe(1);

    const quota = await getSummaryQuotaForDay(ctx, {});
    expect(quota.used).toBe(1);
    expect(quota.limit).toBe(2);

    const identity = await getSummaryGenerationIdentity(ctx, {});
    expect(identity.userId).toBe(USER_ID);
    expect(identity.clerkUserId).toBe("clerk_member_001");
  });

  it("exports diary data and optionally redacts location signals", async () => {
    const db = seededDb();

    await db.insert("daySummaries", {
      userId: USER_ID,
      dayKey: "2026-04-02",
      story: "Story",
      highlights: ["h1"],
      sourcesUsed: ["Memories"],
      generatedAt: 100,
    });

    await db.insert("memories", {
      userId: USER_ID,
      dayKey: "2026-04-02",
      title: "Memory",
      description: "Desc",
      mood: "happy",
      happenedAt: 100,
    });

    await db.insert("days", {
      userId: USER_ID,
      dayKey: "2026-04-02",
      rating: 4,
      manualNotes: ["note"],
      peopleTags: ["Alex"],
    });

    await db.insert("integrationDailyData", {
      userId: USER_ID,
      provider: "location",
      dayKey: "2026-04-02",
      syncedAt: 100,
      signals: ["home", "gym"],
    });

    await db.insert("integrationDailyData", {
      userId: USER_ID,
      provider: "spotify",
      dayKey: "2026-04-02",
      syncedAt: 100,
      signals: ["music"],
    });

    const exportMyDiaryData = handler<
      { includeLocationSignals?: boolean },
      {
        integrationDailyData: Array<{ provider: string; signals: string[] }>;
        summaries: unknown[];
        memories: unknown[];
        days: unknown[];
      }
    >(summariesModule.exportMyDiaryData);

    const ctx = createAuthCtx(db, "clerk_member_001");

    const redacted = await exportMyDiaryData(ctx, {
      includeLocationSignals: false,
    });

    const redactedLocation = redacted.integrationDailyData.find(
      (row) => row.provider === "location",
    );
    expect(redactedLocation).toBeUndefined();

    const full = await exportMyDiaryData(ctx, {
      includeLocationSignals: true,
    });
    const fullLocation = full.integrationDailyData.find(
      (row) => row.provider === "location",
    );

    expect(fullLocation?.signals).toEqual(["home", "gym"]);
    expect(full.summaries).toHaveLength(1);
    expect(full.memories).toHaveLength(1);
    expect(full.days).toHaveLength(1);
  });
});
