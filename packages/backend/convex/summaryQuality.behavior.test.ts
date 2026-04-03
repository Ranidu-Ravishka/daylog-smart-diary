import { describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import {
  evaluateSummaryQuality,
  recordSummaryGenerationEvaluationInternal,
  listSummaryQualityEvaluationsPaginated,
  listSummaryGenerationEventsPaginated,
  backfillSummaryQualityEvaluations,
} from "./summaryQuality";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const ADMIN_ID = "user_admin_001" as Id<"user">;
const MEMBER_ID = "user_member_001" as Id<"user">;

function seededDb() {
  return createInMemoryDb({
    user: [
      {
        _id: ADMIN_ID,
        _creationTime: 1,
        clerkUserId: "clerk_admin_001",
        email: "admin@example.com",
        isAdmin: true,
      },
      {
        _id: MEMBER_ID,
        _creationTime: 2,
        clerkUserId: "clerk_member_001",
        email: "member@example.com",
        isAdmin: false,
      },
    ],
  });
}

describe("summary quality behavior", () => {
  it("evaluates quality scores and flags", () => {
    const low = evaluateSummaryQuality({
      story: "Meaningful day. Meaningful day.",
      highlights: ["same", "same"],
      sourcesUsed: ["Memories"],
      failureReason: "model failed",
    });

    expect(low.lowQuality).toBe(true);
    expect(low.flags).toEqual(
      expect.arrayContaining(["too_short", "failure_risk"]),
    );

    const strong = evaluateSummaryQuality({
      story:
        "Today started with focused planning, followed by two deep work blocks and a long walk in the evening. I wrapped up by journaling key lessons and setting tomorrow priorities.",
      highlights: ["Finished sprint tasks", "Walked 6km", "Planned tomorrow"],
      sourcesUsed: ["Memories", "Integrations"],
    });

    expect(strong.scores.overall).toBeGreaterThan(0.55);
    expect(strong.lowQuality).toBe(false);
  });

  it("records generation events for failure and success paths", async () => {
    const db = seededDb();

    const recordInternal = handler<
      {
        userId: Id<"user">;
        dayKey: string;
        modelProvider: string;
        modelName: string;
        modelInput: string;
        success: boolean;
        generatedStory?: string;
        generatedHighlights?: string[];
        sourcesUsed?: string[];
        failureReason?: string;
        summaryId?: Id<"daySummaries">;
      },
      {
        generationEventId: string;
        evaluated: boolean;
        evaluationId?: string;
        lowQuality?: boolean;
      }
    >(recordSummaryGenerationEvaluationInternal);

    const failed = await recordInternal({ db } as never, {
      userId: MEMBER_ID,
      dayKey: "2026-04-03",
      modelProvider: "openai",
      modelName: "gpt-4o",
      modelInput: "{}",
      success: false,
      failureReason: "temporary upstream failure",
    });

    expect(failed.evaluated).toBe(false);

    const successful = await recordInternal({ db } as never, {
      userId: MEMBER_ID,
      dayKey: "2026-04-03",
      modelProvider: "openai",
      modelName: "gpt-4o",
      modelInput: "{}",
      success: true,
      generatedStory:
        "Completed focused work, exercised, and reflected on progress with specific next steps for tomorrow.",
      generatedHighlights: ["Focused work", "Exercise", "Reflection"],
      sourcesUsed: ["Memories"],
    });

    expect(successful.evaluated).toBe(true);
    expect(db.getTable("summaryGenerationEvents")).toHaveLength(2);
    expect(db.getTable("summaryQualityEvaluations")).toHaveLength(1);
    expect(db.getTable("platformAuditEvents").length).toBeGreaterThanOrEqual(1);
  });

  it("lists quality evaluations and generation events with admin gating", async () => {
    const db = seededDb();

    await db.insert("summaryQualityEvaluations", {
      userId: MEMBER_ID,
      dayKey: "2026-04-01",
      generationEventId: "event_001",
      scores: {
        overall: 0.2,
        length: 0.1,
        coherence: 0.3,
        duplication: 0.2,
        failure: 1,
      },
      wordCount: 12,
      duplicateLineRatio: 0.5,
      flags: ["low_quality"],
      lowQuality: true,
      evaluatedAt: 1,
    });

    await db.insert("summaryQualityEvaluations", {
      userId: MEMBER_ID,
      dayKey: "2026-04-02",
      generationEventId: "event_002",
      scores: {
        overall: 0.9,
        length: 1,
        coherence: 0.9,
        duplication: 0.9,
        failure: 0,
      },
      wordCount: 80,
      duplicateLineRatio: 0.1,
      flags: [],
      lowQuality: false,
      evaluatedAt: 2,
    });

    await db.insert("summaryGenerationEvents", {
      userId: MEMBER_ID,
      dayKey: "2026-04-01",
      modelProvider: "openai",
      modelName: "gpt-4o",
      modelInput: "{}",
      success: false,
      failureReason: "error",
      createdAt: 1,
    });

    await db.insert("summaryGenerationEvents", {
      userId: MEMBER_ID,
      dayKey: "2026-04-02",
      modelProvider: "openai",
      modelName: "gpt-4o",
      modelInput: "{}",
      success: true,
      generatedStory: "good",
      generatedHighlights: ["h"],
      sourcesUsed: ["Memories"],
      createdAt: 2,
    });

    const listEvaluations = handler<
      {
        paginationOpts: { numItems: number; cursor: string | null };
        onlyLowQuality?: boolean;
      },
      { page: Array<{ lowQuality: boolean }> }
    >(listSummaryQualityEvaluationsPaginated);

    await expect(
      listEvaluations(createAuthCtx(db, "clerk_member_001"), {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("Forbidden");

    const lowOnly = await listEvaluations(
      createAuthCtx(db, "clerk_admin_001"),
      {
        paginationOpts: { numItems: 10, cursor: null },
        onlyLowQuality: true,
      },
    );
    expect(lowOnly.page).toHaveLength(1);
    expect(lowOnly.page[0]?.lowQuality).toBe(true);

    const listEvents = handler<
      {
        paginationOpts: { numItems: number; cursor: string | null };
        onlyFailures?: boolean;
      },
      { page: Array<{ success: boolean }> }
    >(listSummaryGenerationEventsPaginated);

    const failures = await listEvents(createAuthCtx(db, "clerk_admin_001"), {
      paginationOpts: { numItems: 10, cursor: null },
      onlyFailures: true,
    });
    expect(failures.page).toHaveLength(1);
    expect(failures.page[0]?.success).toBe(false);
  });

  it("backfills missing summary evaluations", async () => {
    const db = seededDb();

    const generatedEventId = (await db.insert("summaryGenerationEvents", {
      userId: MEMBER_ID,
      dayKey: "2026-04-01",
      modelProvider: "openai",
      modelName: "gpt-4o",
      modelInput: "{}",
      success: true,
      generatedStory:
        "Completed focused tasks and maintained good pacing throughout the day with clear priorities.",
      generatedHighlights: ["focused tasks", "clear priorities"],
      sourcesUsed: ["Memories"],
      createdAt: 1,
    })) as Id<"summaryGenerationEvents">;

    await db.insert("summaryGenerationEvents", {
      userId: MEMBER_ID,
      dayKey: "2026-04-02",
      modelProvider: "openai",
      modelName: "gpt-4o",
      modelInput: "{}",
      success: false,
      failureReason: "error",
      createdAt: 2,
    });

    await db.insert("summaryQualityEvaluations", {
      userId: MEMBER_ID,
      dayKey: "2026-04-01",
      generationEventId: generatedEventId,
      scores: {
        overall: 0.8,
        length: 0.8,
        coherence: 0.8,
        duplication: 0.8,
        failure: 0,
      },
      wordCount: 50,
      duplicateLineRatio: 0.1,
      flags: [],
      lowQuality: false,
      evaluatedAt: 3,
    });

    const result = await handler<
      { maxItems?: number },
      { evaluatedCount: number; skippedCount: number; scanned: number }
    >(backfillSummaryQualityEvaluations)(createAuthCtx(db, "clerk_admin_001"), {
      maxItems: 10,
    });

    expect(result.scanned).toBeGreaterThanOrEqual(2);
    expect(result.skippedCount).toBeGreaterThanOrEqual(2);
    expect(result.evaluatedCount).toBe(0);
  });
});
