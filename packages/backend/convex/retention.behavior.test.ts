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
      { limit?: number; cursor?: string },
      {
        items: Array<{ key: string; source: string; retentionDays: number }>;
        nextCursor: string | null;
      }
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
    const memories = effective.items.find(
      (policy) => policy.key === "memories",
    );

    expect(memories?.source).toBe("db");
    expect(memories?.retentionDays).toBe(30);
    expect(effective.nextCursor).toBeNull();
  });

  it("executes cleanup across all policy buckets and writes run/audit rows", async () => {
    const now = Date.parse("2026-04-03T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);

    const stale = now - 400 * 24 * 60 * 60 * 1000;
    const fresh = now - 2 * 24 * 60 * 60 * 1000;
    const staleQuotaDayKey = new Date(stale).toISOString().slice(0, 10);
    const freshQuotaDayKey = new Date(fresh).toISOString().slice(0, 10);

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
      days: [
        {
          _id: "day_stale_001",
          _creationTime: 6,
          userId: MEMBER_ID,
          dayKey: "2025-11-01",
        },
        {
          _id: "day_fresh_001",
          _creationTime: 7,
          userId: MEMBER_ID,
          dayKey: "2026-04-01",
        },
      ],
      integrationDailyData: [
        {
          _id: "daily_location_stale_001",
          _creationTime: 8,
          userId: MEMBER_ID,
          provider: "location",
          dayKey: "2025-11-01",
          syncedAt: stale,
        },
        {
          _id: "daily_spotify_stale_001",
          _creationTime: 9,
          userId: MEMBER_ID,
          provider: "spotify",
          dayKey: "2025-11-01",
          syncedAt: stale,
        },
        {
          _id: "daily_spotify_fresh_001",
          _creationTime: 10,
          userId: MEMBER_ID,
          provider: "spotify",
          dayKey: "2026-04-01",
          syncedAt: fresh,
        },
      ],
      integrationSyncRuns: [
        {
          _id: "sync_stale_001",
          _creationTime: 11,
          userId: MEMBER_ID,
          provider: "spotify",
          dayKey: "2025-11-01",
          status: "success",
          startedAt: stale,
          updatedAt: stale,
        },
        {
          _id: "sync_fresh_001",
          _creationTime: 12,
          userId: MEMBER_ID,
          provider: "spotify",
          dayKey: "2026-04-01",
          status: "success",
          startedAt: fresh,
          updatedAt: fresh,
        },
      ],
      observabilityInfoEvents: [
        {
          _id: "info_event_stale_001",
          _creationTime: 10,
          app: "daylog",
          surface: "mobile",
          level: "info",
          event: "mobile_offline_outbox_flush_result",
          timestamp: new Date(stale).toISOString(),
          emittedAt: stale,
          receivedAt: stale,
          sampleRate: 0.1,
        },
        {
          _id: "info_event_fresh_001",
          _creationTime: 11,
          app: "daylog",
          surface: "web",
          level: "info",
          event: "oauth_start_request_received",
          timestamp: new Date(fresh).toISOString(),
          emittedAt: fresh,
          receivedAt: fresh,
          sampleRate: 0.1,
        },
      ],
      summaryGenerationEvents: [
        {
          _id: staleEventId,
          _creationTime: 12,
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
          _creationTime: 13,
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
      aiSummaryAttempts: [
        {
          _id: "ai_attempt_stale_001",
          _creationTime: 30,
          userId: MEMBER_ID,
          dayKey: "2025-11-01",
          attemptChainId: "attempt_chain_stale_001",
          generationEventId: staleEventId,
          attemptNumber: 1,
          strategy: "default",
          evaluationFlags: [],
          createdAt: stale,
        },
        {
          _id: "ai_attempt_fresh_001",
          _creationTime: 31,
          userId: MEMBER_ID,
          dayKey: "2026-04-01",
          attemptChainId: "attempt_chain_fresh_001",
          generationEventId: staleEventId,
          attemptNumber: 1,
          strategy: "default",
          evaluationFlags: [],
          createdAt: fresh,
        },
      ],
      dailyFeatureVectors: [
        {
          _id: "feature_vector_stale_001",
          _creationTime: 32,
          userId: MEMBER_ID,
          dayKey: "2025-11-01",
          vectorVersion: 1,
          features: {
            memoryCount: 1,
            noteCount: 0,
            peopleTagCount: 0,
            highlightCount: 0,
            integrationProviderCount: 0,
          },
          sourceDays: 1,
          generatedAt: stale,
          updatedAt: stale,
        },
        {
          _id: "feature_vector_fresh_001",
          _creationTime: 33,
          userId: MEMBER_ID,
          dayKey: "2026-04-01",
          vectorVersion: 1,
          features: {
            memoryCount: 1,
            noteCount: 0,
            peopleTagCount: 0,
            highlightCount: 0,
            integrationProviderCount: 0,
          },
          sourceDays: 1,
          generatedAt: fresh,
          updatedAt: fresh,
        },
      ],
      nextBestDayRecommendations: [
        {
          _id: "recommendation_stale_001",
          _creationTime: 34,
          userId: MEMBER_ID,
          targetDayKey: "2025-11-02",
          generatedAt: stale,
          basedOnDays: 1,
          confidence: 0.5,
          recommendationType: "stabilize",
          recommendations: [],
          rationale: [],
          trend: {
            ratingTrend: "flat",
            memoryTrend: "flat",
            stepsTrend: "flat",
            sleepTrend: "flat",
            screenTimeTrend: "flat",
            spendingTrend: "flat",
            socialTrend: "flat",
          },
        },
        {
          _id: "recommendation_fresh_001",
          _creationTime: 35,
          userId: MEMBER_ID,
          targetDayKey: "2026-04-02",
          generatedAt: fresh,
          basedOnDays: 1,
          confidence: 0.5,
          recommendationType: "stabilize",
          recommendations: [],
          rationale: [],
          trend: {
            ratingTrend: "flat",
            memoryTrend: "flat",
            stepsTrend: "flat",
            sleepTrend: "flat",
            screenTimeTrend: "flat",
            spendingTrend: "flat",
            socialTrend: "flat",
          },
        },
      ],
      summaryQualityEvaluations: [
        {
          _id: "quality_stale_001",
          _creationTime: 14,
          generationEventId: staleEventId,
          evaluatedAt: stale,
          score: 0.2,
        },
      ],
      summaryGenerationQuotas: [
        {
          _id: "quota_stale_001",
          _creationTime: 15,
          userId: MEMBER_ID,
          quotaDayKey: staleQuotaDayKey,
          used: 2,
          updatedAt: stale,
        },
        {
          _id: "quota_fresh_001",
          _creationTime: 16,
          userId: MEMBER_ID,
          quotaDayKey: freshQuotaDayKey,
          used: 1,
          updatedAt: fresh,
        },
      ],
      integrationHealthEvents: [
        {
          _id: "health_event_stale_001",
          _creationTime: 17,
          provider: "spotify",
          userId: MEMBER_ID,
          outcome: "error",
          status: "degraded",
          tokenValidityStatus: "unknown",
          at: stale,
        },
        {
          _id: "health_event_fresh_001",
          _creationTime: 18,
          provider: "spotify",
          userId: MEMBER_ID,
          outcome: "success",
          status: "connected",
          tokenValidityStatus: "valid",
          at: fresh,
        },
      ],
      auditLogs: [
        {
          _id: "audit_log_stale_001",
          _creationTime: 19,
          actorUserId: ADMIN_ID,
          action: "retention_test_old",
          at: stale,
        },
        {
          _id: "audit_log_fresh_001",
          _creationTime: 20,
          actorUserId: ADMIN_ID,
          action: "retention_test_new",
          at: fresh,
        },
      ],
      platformAuditEvents: [
        {
          _id: "platform_audit_stale_001",
          _creationTime: 21,
          category: "retention",
          action: "old",
          actorType: "system",
          at: stale,
        },
        {
          _id: "platform_audit_fresh_001",
          _creationTime: 22,
          category: "retention",
          action: "new",
          actorType: "system",
          at: fresh,
        },
      ],
      exportJobs: [
        {
          _id: "export_job_stale_001",
          _creationTime: 23,
          userId: MEMBER_ID,
          status: "ready",
          format: "json",
          includeLocationSignals: false,
          requestedAt: stale,
          updatedAt: stale,
          expiresAt: stale,
          artifactStorageId: "storage_export_stale_001",
        },
        {
          _id: "export_job_fresh_001",
          _creationTime: 24,
          userId: MEMBER_ID,
          status: "ready",
          format: "json",
          includeLocationSignals: false,
          requestedAt: fresh,
          updatedAt: fresh,
          expiresAt: fresh,
        },
      ],
      restoreJobs: [
        {
          _id: "restore_job_stale_001",
          _creationTime: 25,
          userId: MEMBER_ID,
          status: "failed",
          requestedAt: stale,
          updatedAt: stale,
          conflictMode: "skip",
          allowPartial: false,
          selectedDatasets: ["memories"],
        },
        {
          _id: "restore_job_fresh_001",
          _creationTime: 26,
          userId: MEMBER_ID,
          status: "succeeded",
          requestedAt: fresh,
          updatedAt: fresh,
          conflictMode: "skip",
          allowPartial: false,
          selectedDatasets: ["memories"],
        },
      ],
      userDeletionJobs: [
        {
          _id: "user_deletion_job_stale_completed_001",
          _creationTime: 27,
          userId: MEMBER_ID,
          clerkUserId: "clerk_member_001",
          status: "completed",
          stage: "summaryGenerationQuotas",
          progress: {},
          processedBatches: 1,
          checkpoints: 1,
          startedAt: stale,
          updatedAt: stale,
        },
        {
          _id: "user_deletion_job_stale_processing_001",
          _creationTime: 28,
          userId: MEMBER_ID,
          clerkUserId: "clerk_member_001",
          status: "processing",
          stage: "summaryGenerationQuotas",
          progress: {},
          processedBatches: 1,
          checkpoints: 1,
          startedAt: stale,
          updatedAt: stale,
        },
        {
          _id: "user_deletion_job_fresh_failed_001",
          _creationTime: 29,
          userId: MEMBER_ID,
          clerkUserId: "clerk_member_001",
          status: "failed",
          stage: "summaryGenerationQuotas",
          progress: {},
          processedBatches: 1,
          checkpoints: 1,
          startedAt: fresh,
          updatedAt: fresh,
        },
      ],
    });

    const runRetentionCleanupNow = handler<
      { dryRun?: boolean; maxDeletesPerPolicy?: number },
      {
        deletedCounts: {
          memories: number;
          days: number;
          daySummaries: number;
          integrationDailyData: number;
          integrationSyncRuns: number;
          locationSignals: number;
          summaryGenerationEvents: number;
          aiSummaryAttempts: number;
          summaryQualityEvaluations: number;
          dailyFeatureVectors: number;
          nextBestDayRecommendations: number;
          summaryGenerationQuotas: number;
          infoEvents: number;
          integrationHealthEvents: number;
          auditLogs: number;
          platformAuditEvents: number;
          exportJobs: number;
          restoreJobs: number;
          userDeletionJobs: number;
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
      days: 1,
      daySummaries: 1,
      integrationDailyData: 1,
      integrationSyncRuns: 1,
      locationSignals: 1,
      summaryGenerationEvents: 1,
      aiSummaryAttempts: 1,
      summaryQualityEvaluations: 1,
      dailyFeatureVectors: 1,
      nextBestDayRecommendations: 1,
      summaryGenerationQuotas: 1,
      infoEvents: 1,
      integrationHealthEvents: 1,
      auditLogs: 1,
      platformAuditEvents: 1,
      exportJobs: 1,
      exportArtifactFailures: 0,
      restoreJobs: 1,
      userDeletionJobs: 1,
    });

    expect(db.getTable("memories").map((row) => row._id)).toEqual([
      "memory_fresh_001",
    ]);
    expect(db.getTable("daySummaries").map((row) => row._id)).toEqual([
      "summary_fresh_001",
    ]);
    expect(db.getTable("days").map((row) => row._id)).toEqual([
      "day_fresh_001",
    ]);
    expect(db.getTable("integrationDailyData").map((row) => row._id)).toEqual([
      "daily_spotify_fresh_001",
    ]);
    expect(
      db.getTable("summaryGenerationEvents").map((row) => row._id),
    ).toEqual(["summary_event_fresh_001"]);
    expect(db.getTable("aiSummaryAttempts").map((row) => row._id)).toEqual([
      "ai_attempt_fresh_001",
    ]);
    expect(db.getTable("dailyFeatureVectors").map((row) => row._id)).toEqual([
      "feature_vector_fresh_001",
    ]);
    expect(
      db.getTable("nextBestDayRecommendations").map((row) => row._id),
    ).toEqual(["recommendation_fresh_001"]);
    expect(
      db.getTable("observabilityInfoEvents").map((row) => row._id),
    ).toEqual(["info_event_fresh_001"]);
    expect(db.getTable("integrationSyncRuns").map((row) => row._id)).toEqual([
      "sync_fresh_001",
    ]);
    expect(
      db.getTable("summaryGenerationQuotas").map((row) => row._id),
    ).toEqual(["quota_fresh_001"]);
    expect(
      db.getTable("integrationHealthEvents").map((row) => row._id),
    ).toEqual(["health_event_fresh_001"]);
    expect(db.getTable("auditLogs").map((row) => row._id)).toEqual([
      "audit_log_fresh_001",
    ]);
    expect(db.getTable("exportJobs").map((row) => row._id)).toEqual([
      "export_job_fresh_001",
    ]);
    expect(db.getTable("restoreJobs").map((row) => row._id)).toEqual([
      "restore_job_fresh_001",
    ]);
    expect(db.getTable("userDeletionJobs").map((row) => row._id)).toEqual([
      "user_deletion_job_stale_processing_001",
      "user_deletion_job_fresh_failed_001",
    ]);
    expect(db.getTable("summaryQualityEvaluations")).toHaveLength(0);

    expect(db.getTable("dataRetentionRuns")).toHaveLength(1);
    expect(db.getTable("platformAuditEvents")).toHaveLength(2);
  });

  it("retains failed export cleanup references and retries after the backoff", async () => {
    process.env.RETENTION_EXPORT_JOBS_DAYS = "14";
    const now = Date.parse("2026-04-10T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);

    const db = seededDb();
    await db.insert("exportJobs", {
      userId: MEMBER_ID,
      status: "ready",
      format: "json",
      includeLocationSignals: false,
      requestedAt: now - 30 * 24 * 60 * 60 * 1000,
      updatedAt: now - 30 * 24 * 60 * 60 * 1000,
      artifactStorageId: "storage_export_retry_001",
    });

    const storageDelete = vi
      .fn()
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValue(undefined);
    const ctx = {
      ...retentionCtx(db, "clerk_admin_001"),
      storage: { delete: storageDelete },
    };
    const runRetentionCleanupNow = handler<
      { dryRun?: boolean; maxDeletesPerPolicy?: number },
      { deletedCounts: Record<string, number> }
    >(retentionModule.runRetentionCleanupNow);

    const first = await runRetentionCleanupNow(ctx, {
      dryRun: false,
      maxDeletesPerPolicy: 100,
    });
    expect(first.deletedCounts.exportArtifactFailures).toBe(1);
    expect(first.deletedCounts.exportJobs).toBe(0);
    expect(db.getTable("exportJobs")).toHaveLength(1);
    expect(db.getTable("exportJobs")[0]).toMatchObject({
      artifactStorageId: "storage_export_retry_001",
      artifactCleanupAttempts: 1,
      artifactCleanupErrorCode: "storage_delete_failed",
    });

    const tooEarly = await runRetentionCleanupNow(ctx, {
      dryRun: false,
      maxDeletesPerPolicy: 100,
    });
    expect(tooEarly.deletedCounts.exportJobs).toBe(0);
    expect(storageDelete).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, "now").mockReturnValue(now + 6 * 60 * 60 * 1000);
    const retried = await runRetentionCleanupNow(ctx, {
      dryRun: false,
      maxDeletesPerPolicy: 100,
    });
    expect(retried.deletedCounts.exportJobs).toBe(1);
    expect(retried.deletedCounts.exportArtifactFailures).toBe(0);
    expect(storageDelete).toHaveBeenCalledTimes(2);
    expect(db.getTable("exportJobs")).toHaveLength(0);
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
