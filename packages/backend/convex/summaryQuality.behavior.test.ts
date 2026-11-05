import { describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import {
  evaluateSummaryQuality,
  recordSummaryGenerationEvaluationInternal,
  listSummaryAttemptsByChainForAdmin,
  listSummaryQualityEvaluationsPaginated,
  listSummaryGenerationEventsPaginated,
  backfillSummaryQualityEvaluations,
  redactLegacySummaryGenerationEventContentInternal,
  recordSummaryAttemptInternal,
  removeLegacyAiSummaryAttemptInputHashesInternal,
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
    for (const event of db.getTable("summaryGenerationEvents")) {
      expect(event).toHaveProperty("modelInputBytes", 2);
      expect(event).not.toHaveProperty("modelInput");
      expect(event).not.toHaveProperty("generatedStory");
      expect(event).not.toHaveProperty("generatedHighlights");
      expect(event).not.toHaveProperty("sourcesUsed");
    }
    expect(
      db.getTable("summaryGenerationEvents").find((event) => !event.success)
        ?.failureReason,
    ).toBe("generation_failed");
    expect(db.getTable("summaryQualityEvaluations")).toHaveLength(1);
    expect(db.getTable("platformAuditEvents").length).toBeGreaterThanOrEqual(1);
  });

  it("redacts legacy prompt, output, and provider error content in batches", async () => {
    const db = seededDb();
    const id = await db.insert("summaryGenerationEvents", {
      userId: MEMBER_ID,
      dayKey: "2026-04-03",
      modelProvider: "openai",
      modelName: "gpt-4o",
      modelInput: "private diary prompt",
      generatedStory: "private generated response",
      generatedHighlights: ["private highlight"],
      sourcesUsed: ["Memories"],
      success: false,
      failureReason: "provider echoed sensitive request body",
      createdAt: 1,
    });
    const secondId = await db.insert("summaryGenerationEvents", {
      userId: MEMBER_ID,
      dayKey: "2026-04-04",
      modelProvider: "openai",
      modelName: "gpt-4o",
      modelInput: "another private prompt",
      generatedStory: "another private response",
      generatedHighlights: ["another private highlight"],
      sourcesUsed: ["Memories"],
      success: true,
      createdAt: 2,
    });
    const schedulerRunAfter = vi.fn(
      async (_delay: number, _reference: unknown, _args: unknown) =>
        undefined,
    );
    const redact = handler<
      { cursor?: string; batchSize?: number },
      { redacted: number; scanned: number; done: boolean }
    >(redactLegacySummaryGenerationEventContentInternal);

    const result = await redact(
      { ...createAuthCtx(db, null), scheduler: { runAfter: schedulerRunAfter } },
      { batchSize: 1 },
    );

    expect(result).toEqual({ redacted: 1, scanned: 1, done: false });
    expect(await db.get(id)).toMatchObject({
      success: false,
      failureReason: "generation_failed",
      privacyRedactedAt: expect.any(Number),
    });
    const redacted = await db.get(id);
    expect(redacted?.modelInput).toBeUndefined();
    expect(redacted?.generatedStory).toBeUndefined();
    expect(redacted?.generatedHighlights).toBeUndefined();
    expect(redacted?.sourcesUsed).toBeUndefined();
    expect(redacted?.failureReason).toBe("generation_failed");
    expect(schedulerRunAfter).toHaveBeenCalledTimes(1);

    const continuation = schedulerRunAfter.mock.calls[0]?.[2] as
      | { cursor?: string; batchSize?: number }
      | undefined;
    expect(continuation?.cursor).toBeTruthy();
    const finalPage = await redact(
      { ...createAuthCtx(db, null), scheduler: { runAfter: schedulerRunAfter } },
      continuation ?? {},
    );
    expect(finalPage).toEqual({ redacted: 1, scanned: 1, done: true });
    const secondRedacted = await db.get(secondId);
    expect(secondRedacted?.modelInput).toBeUndefined();
    expect(secondRedacted?.generatedStory).toBeUndefined();
    expect(secondRedacted?.generatedHighlights).toBeUndefined();
    expect(secondRedacted?.sourcesUsed).toBeUndefined();

    const alreadyComplete = await redact(
      { ...createAuthCtx(db, null), scheduler: { runAfter: schedulerRunAfter } },
      { batchSize: 1 },
    );
    expect(alreadyComplete).toEqual({ redacted: 0, scanned: 0, done: true });
    expect(
      db
        .getTable("platformAuditEvents")
        .filter(
          (event) =>
            event.action === "legacy_event_content_redaction_completed",
        ),
    ).toHaveLength(1);
    expect(schedulerRunAfter).toHaveBeenCalledTimes(1);
  });

  it("removes obsolete input hashes in resumable batches without deleting attempts", async () => {
    const db = seededDb();
    const firstId = await db.insert("aiSummaryAttempts", {
      userId: MEMBER_ID,
      dayKey: "2026-04-03",
      attemptChainId: "chain_001",
      generationEventId: "event_001",
      attemptNumber: 1,
      strategy: "default",
      inputHash: "fnv1a:12345678",
      evaluationFlags: [],
      createdAt: 1,
    });
    const secondId = await db.insert("aiSummaryAttempts", {
      userId: MEMBER_ID,
      dayKey: "2026-04-04",
      attemptChainId: "chain_002",
      generationEventId: "event_002",
      attemptNumber: 1,
      strategy: "concise",
      inputHash: "fnv1a:87654321",
      evaluationFlags: ["low_quality"],
      createdAt: 2,
    });
    const schedulerRunAfter = vi.fn(
      async (_delay: number, _reference: unknown, _args: unknown) =>
        undefined,
    );
    const removeHashes = handler<
      { cursor?: string; batchSize?: number },
      { removed: number; scanned: number; done: boolean }
    >(removeLegacyAiSummaryAttemptInputHashesInternal);

    const firstPage = await removeHashes(
      { ...createAuthCtx(db, null), scheduler: { runAfter: schedulerRunAfter } },
      { batchSize: 1 },
    );

    expect(firstPage).toEqual({ removed: 1, scanned: 1, done: false });
    expect(db.getTable("aiSummaryAttempts")).toHaveLength(2);
    expect(await db.get(firstId)).toMatchObject({
      attemptChainId: "chain_001",
      attemptNumber: 1,
      evaluationFlags: [],
    });
    expect((await db.get(firstId))?.inputHash).toBeUndefined();
    expect(schedulerRunAfter).toHaveBeenCalledTimes(1);

    const continuation = schedulerRunAfter.mock.calls[0]?.[2] as
      | { cursor?: string; batchSize?: number }
      | undefined;
    expect(continuation?.cursor).toBeTruthy();
    const finalPage = await removeHashes(
      { ...createAuthCtx(db, null), scheduler: { runAfter: schedulerRunAfter } },
      continuation ?? {},
    );

    expect(finalPage).toEqual({ removed: 1, scanned: 1, done: true });
    expect((await db.get(secondId))?.inputHash).toBeUndefined();
    expect(db.getTable("aiSummaryAttempts")).toHaveLength(2);
    expect(
      db
        .getTable("platformAuditEvents")
        .filter(
          (event) =>
            event.action ===
            "legacy_ai_attempt_input_hash_cleanup_completed",
        ),
    ).toHaveLength(1);

    const alreadyComplete = await removeHashes(
      { ...createAuthCtx(db, null), scheduler: { runAfter: schedulerRunAfter } },
      { batchSize: 1 },
    );
    expect(alreadyComplete).toEqual({ removed: 0, scanned: 0, done: true });
    expect(db.getTable("aiSummaryAttempts")).toHaveLength(2);
  });

  it("writes new AI attempts without persisting an input hash", async () => {
    const db = seededDb();
    const record = handler<
      {
        userId: Id<"user">;
        dayKey: string;
        attemptChainId: string;
        generationEventId: Id<"summaryGenerationEvents">;
        attemptNumber: number;
        strategy:
          | "default"
          | "concise"
          | "factual_bias"
          | "source_grounded"
          | "structured_output";
        outputSummary?: string;
        qualityScore?: number;
        evaluationFlags: string[];
        failureReason?: string;
      },
      string
    >(recordSummaryAttemptInternal);

    const id = await record(createAuthCtx(db, null), {
      userId: MEMBER_ID,
      dayKey: "2026-04-03",
      attemptChainId: "chain_new",
      generationEventId: "event_new" as Id<"summaryGenerationEvents">,
      attemptNumber: 1,
      strategy: "default",
      outputSummary: "Private summary text is not retained here",
      qualityScore: 0.8,
      evaluationFlags: [],
    });

    const attempt = await db.get(id);
    expect(attempt?.inputHash).toBeUndefined();
    expect(attempt?.outputSummary).toBeUndefined();
    expect(attempt).toMatchObject({
      userId: MEMBER_ID,
      attemptChainId: "chain_new",
      generationEventId: "event_new",
      attemptNumber: 1,
      strategy: "default",
      qualityScore: 0.8,
    });
    expect(db.getTable("aiSummaryAttempts")).toHaveLength(1);
  });

  it("does not return legacy input hashes from the admin attempts query", async () => {
    const db = seededDb();
    await db.insert("aiSummaryAttempts", {
      userId: MEMBER_ID,
      dayKey: "2026-04-03",
      attemptChainId: "chain_legacy",
      generationEventId: "event_legacy",
      attemptNumber: 1,
      strategy: "default",
      inputHash: "fnv1a:12345678",
      outputSummary: "legacy text",
      evaluationFlags: [],
      createdAt: 1,
    });
    const listAttempts = handler<
      { attemptChainId: string },
      Array<Record<string, unknown>>
    >(listSummaryAttemptsByChainForAdmin);

    const result = await listAttempts(
      createAuthCtx(db, "clerk_admin_001"),
      { attemptChainId: "chain_legacy" },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.inputHash).toBeUndefined();
    expect(result[0]?.outputSummary).toBeUndefined();
    expect(db.getTable("aiSummaryAttempts")).toHaveLength(1);
    expect(db.getTable("aiSummaryAttempts")[0]?.inputHash).toBe(
      "fnv1a:12345678",
    );
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
