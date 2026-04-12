import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as retentionModule from "./retention";

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

function retentionCtx(
  db: ReturnType<typeof createInMemoryDb>,
  subject: string | null,
) {
  return {
    ...createAuthCtx(db, subject),
    storage: {
      delete: vi.fn(async () => undefined),
    },
  };
}

beforeAll(() => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.daylog.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_valid_key_1234567890";
  process.env.OPENAI_API_KEY ??= "sk-test-valid-key-1234567890";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("retention behavior", () => {
  it("upserts policies and resolves effective policy list", async () => {
    const db = seededDb();

    const upsertRetentionPolicy = handler<
      {
        key: string;
        retentionDays: number;
        sensitive?: boolean;
        enabled?: boolean;
      },
      { success: boolean; key: string; retentionDays: number; source?: string }
    >(retentionModule.upsertRetentionPolicy);
    const listEffectiveRetentionPolicies = handler<
      Record<string, never>,
      Array<{ key: string; source: string; retentionDays: number }>
    >(retentionModule.listEffectiveRetentionPolicies);

    await expect(
      upsertRetentionPolicy(retentionCtx(db, "clerk_member_001"), {
        key: "memories",
        retentionDays: 30,
      }),
    ).rejects.toThrow("Forbidden");

    await expect(
      upsertRetentionPolicy(retentionCtx(db, "clerk_admin_001"), {
        key: "unsupported",
        retentionDays: 30,
      }),
    ).rejects.toThrow("Unsupported retention policy key");

    const upserted = await upsertRetentionPolicy(
      retentionCtx(db, "clerk_admin_001"),
      {
        key: "memories",
        retentionDays: 30,
        sensitive: true,
        enabled: false,
      },
    );

    expect(upserted.success).toBe(true);
    expect(upserted.key).toBe("memories");
    expect(upserted.retentionDays).toBe(30);

    const effective = await listEffectiveRetentionPolicies(
      retentionCtx(db, "clerk_admin_001"),
      {},
    );
    const memories = effective.find((policy) => policy.key === "memories");

    expect(memories?.source).toBe("db");
    expect(memories?.retentionDays).toBe(30);
  });

  it("executes cleanup across all policy buckets and writes run/audit rows", async () => {
    const now = Date.parse("2026-04-03T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);

    const stale = now - 120 * 24 * 60 * 60 * 1000;
    const fresh = now - 2 * 24 * 60 * 60 * 1000;

    const staleMemoryId = "memory_stale_001" as Id<"memories">;
    const staleEventId =
      "summary_event_stale_001" as Id<"summaryGenerationEvents">;

    const db = createInMemoryDb({
      ...(seededDb().getTable("user").length
        ? {
            user: seededDb().getTable("user"),
          }
        : {}),
      memories: [
        {
          _id: staleMemoryId,
          _creationTime: 1,
          userId: MEMBER_ID,
          title: "stale",
          happenedAt: stale,
          dayKey: "2025-11-01",
        },
        {
          _id: "memory_fresh_001",
          _creationTime: 2,
          userId: MEMBER_ID,
          title: "fresh",
          happenedAt: fresh,
          dayKey: "2026-04-01",
        },
      ],
      memoryMedia: [
        {
          _id: "media_stale_001",
          _creationTime: 3,
          memoryId: staleMemoryId,
          userId: MEMBER_ID,
          storageId: "storage_stale_001",
          type: "image",
        },
      ],
      daySummaries: [
        {
          _id: "summary_stale_001",
          _creationTime: 4,
          userId: MEMBER_ID,
          dayKey: "2025-11-01",
          story: "old",
          highlights: [],
          sourcesUsed: [],
          generatedAt: stale,
        },
        {
          _id: "summary_fresh_001",
          _creationTime: 5,
          userId: MEMBER_ID,
          dayKey: "2026-04-01",
          story: "new",
          highlights: [],
          sourcesUsed: [],
          generatedAt: fresh,
        },
      ],
      integrationDailyData: [
        {
          _id: "daily_location_stale_001",
          _creationTime: 6,
          userId: MEMBER_ID,
          provider: "location",
          dayKey: "2025-11-01",
          syncedAt: stale,
        },
        {
          _id: "daily_spotify_stale_001",
          _creationTime: 7,
          userId: MEMBER_ID,
          provider: "spotify",
          dayKey: "2025-11-01",
          syncedAt: stale,
        },
        {
          _id: "daily_spotify_fresh_001",
          _creationTime: 8,
          userId: MEMBER_ID,
          provider: "spotify",
          dayKey: "2026-04-01",
          syncedAt: fresh,
        },
      ],
      summaryGenerationEvents: [
        {
          _id: staleEventId,
          _creationTime: 9,
          userId: MEMBER_ID,
          dayKey: "2025-11-01",
          createdAt: stale,
          latencyMs: 100,
          promptVersion: "v1",
          model: "gpt",
          sourceCount: 1,
          outputLength: 50,
          status: "success",
        },
        {
          _id: "summary_event_fresh_001",
          _creationTime: 10,
          userId: MEMBER_ID,
          dayKey: "2026-04-01",
          createdAt: fresh,
          latencyMs: 100,
          promptVersion: "v1",
          model: "gpt",
          sourceCount: 1,
          outputLength: 50,
          status: "success",
        },
      ],
      summaryQualityEvaluations: [
        {
          _id: "quality_stale_001",
          _creationTime: 11,
          generationEventId: staleEventId,
          evaluatedAt: stale,
          score: 0.2,
        },
      ],
    });

    const runRetentionCleanupNow = handler<
      { dryRun?: boolean; maxDeletesPerPolicy?: number },
      {
        deletedCounts: {
          memories: number;
          daySummaries: number;
          integrationDailyData: number;
          locationSignals: number;
          summaryGenerationEvents: number;
          exportJobs: number;
        };
      }
    >(retentionModule.runRetentionCleanupNow);

    const result = await runRetentionCleanupNow(
      retentionCtx(db, "clerk_admin_001"),
      {
        dryRun: false,
        maxDeletesPerPolicy: 100,
      },
    );

    expect(result.deletedCounts).toEqual({
      memories: 1,
      daySummaries: 1,
      integrationDailyData: 1,
      locationSignals: 1,
      summaryGenerationEvents: 1,
      exportJobs: 0,
    });

    expect(db.getTable("memories").map((row) => row._id)).toEqual([
      "memory_fresh_001",
    ]);
    expect(db.getTable("daySummaries").map((row) => row._id)).toEqual([
      "summary_fresh_001",
    ]);
    expect(db.getTable("integrationDailyData").map((row) => row._id)).toEqual([
      "daily_spotify_fresh_001",
    ]);
    expect(
      db.getTable("summaryGenerationEvents").map((row) => row._id),
    ).toEqual(["summary_event_fresh_001"]);
    expect(db.getTable("summaryQualityEvaluations")).toHaveLength(0);

    expect(db.getTable("dataRetentionRuns")).toHaveLength(1);
    expect(db.getTable("platformAuditEvents")).toHaveLength(1);
  });

  it("supports dry-run scheduled cleanup without deleting rows", async () => {
    const now = Date.parse("2026-04-03T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);

    const stale = now - 120 * 24 * 60 * 60 * 1000;

    const db = seededDb();
    await db.insert("memories", {
      userId: MEMBER_ID,
      title: "stale",
      happenedAt: stale,
      dayKey: "2025-11-01",
    });

    const runScheduledRetentionCleanupInternal = handler<
      { dryRun?: boolean; maxDeletesPerPolicy?: number },
      { dryRun: boolean; deletedCounts: { memories: number } }
    >(retentionModule.runScheduledRetentionCleanupInternal);

    const result = await runScheduledRetentionCleanupInternal(
      retentionCtx(db, "clerk_admin_001"),
      {
        dryRun: true,
        maxDeletesPerPolicy: 50,
      },
    );

    expect(result.dryRun).toBe(true);
    expect(result.deletedCounts.memories).toBe(1);
    expect(db.getTable("memories")).toHaveLength(1);
  });
});
