import { describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createInMemoryDb } from "../test-utils/inMemoryConvex";
import {
  deleteDayCascadeData,
  deleteMemoryMediaByMemoryId,
  deleteUserCascadeData,
} from "./cascadeCleanup";

const USER_ID = "user_001" as Id<"user">;
const OTHER_USER_ID = "user_002" as Id<"user">;

describe("cascade cleanup behavior", () => {
  it("retains memory media when storage deletion fails and retries cleanup", async () => {
    const memoryId = "memory_001" as Id<"memories">;

    const db = createInMemoryDb({
      memoryMedia: [
        {
          _id: "media_001",
          _creationTime: 1,
          memoryId,
          userId: USER_ID,
          storageId: "storage_missing",
          type: "image",
        },
        {
          _id: "media_002",
          _creationTime: 2,
          memoryId: "memory_other",
          userId: USER_ID,
          storageId: "storage_other",
          type: "image",
        },
      ],
    });

    const storageDelete = vi
      .fn()
      .mockRejectedValueOnce(new Error("already removed"))
      .mockResolvedValue(undefined);

    const ctx = {
      db,
      storage: {
        delete: storageDelete,
      },
    } as never;

    await expect(deleteMemoryMediaByMemoryId(ctx, memoryId)).rejects.toThrow(
      "already removed",
    );
    expect(db.getTable("memoryMedia").map((row) => row._id)).toEqual([
      "media_001",
      "media_002",
    ]);

    const deletedCount = await deleteMemoryMediaByMemoryId(ctx, memoryId);

    expect(deletedCount).toBe(1);
    expect(storageDelete).toHaveBeenCalledTimes(2);
    expect(storageDelete).toHaveBeenCalledWith("storage_missing");
    expect(db.getTable("memoryMedia").map((row) => row._id)).toEqual([
      "media_002",
    ]);
  });

  it("deletes day summaries and memories scoped to one day", async () => {
    const dayKey = "2026-04-01";
    const targetMemoryId = "memory_010" as Id<"memories">;

    const db = createInMemoryDb({
      daySummaries: [
        {
          _id: "summary_001",
          _creationTime: 1,
          userId: USER_ID,
          dayKey,
          story: "target",
          highlights: [],
          sourcesUsed: [],
          generatedAt: 1,
        },
        {
          _id: "summary_002",
          _creationTime: 2,
          userId: USER_ID,
          dayKey: "2026-04-02",
          story: "keep",
          highlights: [],
          sourcesUsed: [],
          generatedAt: 1,
        },
      ],
      memories: [
        {
          _id: targetMemoryId,
          _creationTime: 3,
          userId: USER_ID,
          title: "target",
          happenedAt: 1,
          dayKey,
        },
        {
          _id: "memory_011",
          _creationTime: 4,
          userId: USER_ID,
          title: "keep",
          happenedAt: 2,
          dayKey: "2026-04-02",
        },
      ],
      memoryMedia: [
        {
          _id: "media_010",
          _creationTime: 5,
          memoryId: targetMemoryId,
          userId: USER_ID,
          storageId: "storage_010",
          type: "image",
        },
      ],
    });

    const storageDelete = vi.fn(async () => undefined);

    const deleted = await deleteDayCascadeData(
      {
        db,
        storage: {
          delete: storageDelete,
        },
      } as never,
      {
        userId: USER_ID,
        dayKey,
      },
    );

    expect(deleted).toEqual({
      deletedMemories: 1,
      deletedSummaries: 1,
      deletedIntegrationDailyData: 0,
    });
    expect(storageDelete).toHaveBeenCalledWith("storage_010");
    expect(db.getTable("daySummaries").map((row) => row._id)).toEqual([
      "summary_002",
    ]);
    expect(db.getTable("memories").map((row) => row._id)).toEqual([
      "memory_011",
    ]);
  });

  it("deletes user-scoped records across all dependent tables", async () => {
    const targetMemoryId = "memory_user_001" as Id<"memories">;

    const db = createInMemoryDb({
      memories: [
        {
          _id: targetMemoryId,
          _creationTime: 1,
          userId: USER_ID,
          title: "target",
          happenedAt: 1,
          dayKey: "2026-04-01",
        },
        {
          _id: "memory_other_001",
          _creationTime: 2,
          userId: OTHER_USER_ID,
          title: "other",
          happenedAt: 1,
          dayKey: "2026-04-01",
        },
      ],
      memoryMedia: [
        {
          _id: "media_user_001",
          _creationTime: 3,
          memoryId: targetMemoryId,
          userId: USER_ID,
          storageId: "storage_user_001",
          type: "image",
        },
      ],
      daySummaries: [
        {
          _id: "summary_user_001",
          _creationTime: 4,
          userId: USER_ID,
          dayKey: "2026-04-01",
          story: "target",
          highlights: [],
          sourcesUsed: [],
          generatedAt: 1,
        },
      ],
      days: [
        {
          _id: "day_user_001",
          _creationTime: 5,
          userId: USER_ID,
          dayKey: "2026-04-01",
          rating: 4,
        },
      ],
      integrations: [
        {
          _id: "integration_user_001",
          _creationTime: 6,
          userId: USER_ID,
          provider: "spotify",
          status: "connected",
        },
      ],
      integrationDailyData: [
        {
          _id: "daily_user_001",
          _creationTime: 7,
          userId: USER_ID,
          provider: "spotify",
          dayKey: "2026-04-01",
          syncedAt: 1,
        },
      ],
      integrationSecrets: [
        {
          _id: "secret_user_001",
          _creationTime: 8,
          userId: USER_ID,
          provider: "spotify",
          tokenRef: "tokref_user_001",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      integrationSyncRuns: [
        {
          _id: "sync_user_001",
          _creationTime: 9,
          userId: USER_ID,
          provider: "spotify",
          dayKey: "2026-04-01",
          status: "success",
          startedAt: 1,
          updatedAt: 1,
        },
      ],
      userPreferences: [
        {
          _id: "pref_user_001",
          _creationTime: 10,
          clerkUserId: "clerk_target_001",
          focusAreas: [0],
          reminderType: "daily",
          dailyTime: "09:00",
          weeklyDay: "monday",
          formattedTime: "9:00 AM",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      auditLogs: [
        {
          _id: "audit_user_001",
          _creationTime: 11,
          actorUserId: USER_ID,
          action: "test",
          at: 1,
        },
      ],
      summaryGenerationQuotas: [
        {
          _id: "quota_user_001",
          _creationTime: 12,
          userId: USER_ID,
          quotaDayKey: "2026-04-01",
          used: 1,
          updatedAt: 1,
        },
      ],
      aiSummaryAttempts: [
        {
          _id: "attempt_user_001",
          _creationTime: 13,
          userId: USER_ID,
          dayKey: "2026-04-01",
          attemptChainId: "chain_user_001",
          generationEventId: "event_user_001",
          attemptNumber: 1,
          strategy: "default",
          evaluationFlags: [],
          createdAt: 1,
        },
        {
          _id: "attempt_other_001",
          _creationTime: 14,
          userId: OTHER_USER_ID,
          dayKey: "2026-04-01",
          attemptChainId: "chain_other_001",
          generationEventId: "event_other_001",
          attemptNumber: 1,
          strategy: "default",
          evaluationFlags: [],
          createdAt: 1,
        },
      ],
      dailyFeatureVectors: [
        {
          _id: "feature_user_001",
          _creationTime: 15,
          userId: USER_ID,
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
          generatedAt: 1,
          updatedAt: 1,
        },
        {
          _id: "feature_other_001",
          _creationTime: 16,
          userId: OTHER_USER_ID,
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
          generatedAt: 1,
          updatedAt: 1,
        },
      ],
      nextBestDayRecommendations: [
        {
          _id: "recommendation_user_001",
          _creationTime: 17,
          userId: USER_ID,
          targetDayKey: "2026-04-02",
          generatedAt: 1,
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
          _id: "recommendation_other_001",
          _creationTime: 18,
          userId: OTHER_USER_ID,
          targetDayKey: "2026-04-02",
          generatedAt: 1,
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
    });

    const storageDelete = vi.fn(async () => undefined);

    const deleted = await deleteUserCascadeData(
      {
        db,
        storage: {
          delete: storageDelete,
        },
      } as never,
      {
        userId: USER_ID,
        clerkUserId: "clerk_target_001",
      },
    );

    expect(deleted).toEqual({
      deletedMemories: 1,
      deletedSummaries: 1,
      deletedDays: 1,
      deletedIntegrations: 1,
      deletedPreferences: 1,
      deletedAuditLogs: 1,
      deletedPlatformAuditEvents: 0,
      deletedMemoryMedia: 1,
      deletedIntegrationDailyData: 1,
      deletedIntegrationSecrets: 1,
      deletedIntegrationSyncRuns: 1,
      deletedIntegrationHealthEvents: 0,
      deletedExportJobs: 0,
      deletedRestoreJobs: 0,
      deletedSummaryGenerationEvents: 0,
      deletedSummaryQualityEvaluations: 0,
      deletedSummaryGenerationQuotas: 1,
      deletedSummaryGenerationQuotaReservations: 0,
      deletedOAuthMobileHandoffs: 0,
      deletedAiSummaryAttempts: 1,
      deletedDailyFeatureVectors: 1,
      deletedNextBestDayRecommendations: 1,
    });

    expect(storageDelete).toHaveBeenCalledWith("storage_user_001");
    expect(db.getTable("summaryGenerationQuotas")).toHaveLength(0);
    expect(db.getTable("memories").map((row) => row._id)).toEqual([
      "memory_other_001",
    ]);
    expect(db.getTable("aiSummaryAttempts").map((row) => row._id)).toEqual([
      "attempt_other_001",
    ]);
    expect(db.getTable("dailyFeatureVectors").map((row) => row._id)).toEqual([
      "feature_other_001",
    ]);
    expect(
      db.getTable("nextBestDayRecommendations").map((row) => row._id),
    ).toEqual(["recommendation_other_001"]);
  });

  it("keeps an export artifact referenced when account cleanup fails and retries", async () => {
    const now = Date.parse("2026-04-10T12:00:00.000Z");
    const db = createInMemoryDb({
      exportJobs: [
        {
          _id: "export_001",
          _creationTime: 1,
          userId: USER_ID,
          status: "ready",
          format: "json",
          includeLocationSignals: false,
          requestedAt: now,
          updatedAt: now,
          artifactStorageId: "storage_export_001",
        },
      ],
    });
    const storageDelete = vi
      .fn()
      .mockRejectedValueOnce(new Error("storage temporarily unavailable"))
      .mockResolvedValue(undefined);
    const ctx = {
      db,
      storage: {
        delete: storageDelete,
      },
    } as never;
    const input = {
      userId: USER_ID,
      clerkUserId: "clerk_target_001",
    };

    await expect(deleteUserCascadeData(ctx, input)).rejects.toThrow(
      "storage temporarily unavailable",
    );
    expect(db.getTable("exportJobs")).toHaveLength(1);
    expect(db.getTable("exportJobs")[0]?.artifactStorageId).toBe(
      "storage_export_001",
    );

    const deleted = await deleteUserCascadeData(ctx, input);

    expect(deleted.deletedExportJobs).toBe(1);
    expect(db.getTable("exportJobs")).toHaveLength(0);
    expect(storageDelete).toHaveBeenCalledTimes(2);
  });
});
