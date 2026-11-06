import { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type CascadeCtx = Pick<MutationCtx, "db" | "storage">;

type UserCascadeInput = {
  userId: Id<"user">;
  clerkUserId: string;
};

type DayCascadeInput = {
  userId: Id<"user">;
  dayKey: string;
};

export type UserCascadeDeleteCounts = {
  deletedMemories: number;
  deletedSummaries: number;
  deletedDays: number;
  deletedIntegrations: number;
  deletedPreferences: number;
  deletedAuditLogs: number;
  deletedPlatformAuditEvents: number;
  deletedMemoryMedia: number;
  deletedIntegrationDailyData: number;
  deletedIntegrationSecrets: number;
  deletedIntegrationRevocationJobs: number;
  deletedIntegrationSyncRuns: number;
  deletedIntegrationHealthEvents: number;
  deletedExportJobs: number;
  deletedRestoreJobs: number;
  deletedAiSummaryAttempts: number;
  deletedSummaryGenerationEvents: number;
  deletedAiUsageRecords?: number;
  deletedSummaryQualityEvaluations: number;
  deletedDailyFeatureVectors: number;
  deletedNextBestDayRecommendations: number;
  deletedSummaryGenerationQuotas: number;
  deletedSummaryGenerationQuotaReservations: number;
  deletedOAuthMobileHandoffs: number;
};

export type DayCascadeDeleteCounts = {
  deletedMemories: number;
  deletedSummaries: number;
  deletedIntegrationDailyData: number;
};

export type UserCascadeDeleteProgress = UserCascadeDeleteCounts;

export const USER_CASCADE_DELETION_STAGES = [
  "memoryMedia",
  "memories",
  "daySummaries",
  "days",
  "integrations",
  "integrationDailyData",
  "integrationSecrets",
  "integrationRevocationJobs",
  "integrationSyncRuns",
  "exportJobs",
  "restoreJobs",
  "summaryQualityEvaluations",
  "aiSummaryAttempts",
  "summaryGenerationEvents",
  "aiUsageRecords",
  "dailyFeatureVectors",
  "nextBestDayRecommendations",
  "integrationHealthEvents",
  "userPreferences",
  "auditLogs",
  "platformAuditEvents",
  "summaryGenerationQuotas",
  "summaryGenerationQuotaReservations",
  "oauthMobileHandoffs",
] as const;

export type UserCascadeDeletionStage =
  (typeof USER_CASCADE_DELETION_STAGES)[number];

const DEFAULT_USER_CASCADE_DELETE_BATCH_SIZE = 128;

type UserCascadeBatchInput = {
  userId: Id<"user">;
  clerkUserId: string;
  stage: UserCascadeDeletionStage;
  cursor: string | null;
  batchSize?: number;
};

type UserCascadeBatchResult = {
  stage: UserCascadeDeletionStage;
  nextCursor: string | null;
  isStageComplete: boolean;
  deleted: UserCascadeDeleteProgress;
};

function emptyUserCascadeDeleteProgress(): UserCascadeDeleteProgress {
  return {
    deletedMemories: 0,
    deletedSummaries: 0,
    deletedDays: 0,
    deletedIntegrations: 0,
    deletedPreferences: 0,
    deletedAuditLogs: 0,
    deletedPlatformAuditEvents: 0,
    deletedMemoryMedia: 0,
    deletedIntegrationDailyData: 0,
    deletedIntegrationSecrets: 0,
    deletedIntegrationRevocationJobs: 0,
    deletedIntegrationSyncRuns: 0,
    deletedIntegrationHealthEvents: 0,
    deletedExportJobs: 0,
    deletedRestoreJobs: 0,
    deletedAiSummaryAttempts: 0,
    deletedSummaryGenerationEvents: 0,
    deletedAiUsageRecords: 0,
    deletedSummaryQualityEvaluations: 0,
    deletedDailyFeatureVectors: 0,
    deletedNextBestDayRecommendations: 0,
    deletedSummaryGenerationQuotas: 0,
    deletedSummaryGenerationQuotaReservations: 0,
    deletedOAuthMobileHandoffs: 0,
  };
}

function mergeUserCascadeDeleteProgress(
  base: UserCascadeDeleteProgress,
  delta: UserCascadeDeleteProgress,
): UserCascadeDeleteProgress {
  return {
    deletedMemories: base.deletedMemories + delta.deletedMemories,
    deletedSummaries: base.deletedSummaries + delta.deletedSummaries,
    deletedDays: base.deletedDays + delta.deletedDays,
    deletedIntegrations: base.deletedIntegrations + delta.deletedIntegrations,
    deletedPreferences: base.deletedPreferences + delta.deletedPreferences,
    deletedAuditLogs: base.deletedAuditLogs + delta.deletedAuditLogs,
    deletedPlatformAuditEvents:
      base.deletedPlatformAuditEvents + delta.deletedPlatformAuditEvents,
    deletedMemoryMedia: base.deletedMemoryMedia + delta.deletedMemoryMedia,
    deletedIntegrationDailyData:
      base.deletedIntegrationDailyData + delta.deletedIntegrationDailyData,
    deletedIntegrationSecrets:
      base.deletedIntegrationSecrets + delta.deletedIntegrationSecrets,
    deletedIntegrationRevocationJobs:
      base.deletedIntegrationRevocationJobs +
      delta.deletedIntegrationRevocationJobs,
    deletedIntegrationSyncRuns:
      base.deletedIntegrationSyncRuns + delta.deletedIntegrationSyncRuns,
    deletedIntegrationHealthEvents:
      base.deletedIntegrationHealthEvents +
      delta.deletedIntegrationHealthEvents,
    deletedExportJobs: base.deletedExportJobs + delta.deletedExportJobs,
    deletedRestoreJobs: base.deletedRestoreJobs + delta.deletedRestoreJobs,
    deletedAiSummaryAttempts:
      base.deletedAiSummaryAttempts + delta.deletedAiSummaryAttempts,
    deletedSummaryGenerationEvents:
      base.deletedSummaryGenerationEvents +
      delta.deletedSummaryGenerationEvents,
    deletedAiUsageRecords:
      (base.deletedAiUsageRecords ?? 0) + (delta.deletedAiUsageRecords ?? 0),
    deletedSummaryQualityEvaluations:
      base.deletedSummaryQualityEvaluations +
      delta.deletedSummaryQualityEvaluations,
    deletedDailyFeatureVectors:
      base.deletedDailyFeatureVectors + delta.deletedDailyFeatureVectors,
    deletedNextBestDayRecommendations:
      base.deletedNextBestDayRecommendations +
      delta.deletedNextBestDayRecommendations,
    deletedSummaryGenerationQuotas:
      base.deletedSummaryGenerationQuotas +
      delta.deletedSummaryGenerationQuotas,
    deletedSummaryGenerationQuotaReservations:
      base.deletedSummaryGenerationQuotaReservations +
      delta.deletedSummaryGenerationQuotaReservations,
    deletedOAuthMobileHandoffs:
      base.deletedOAuthMobileHandoffs + delta.deletedOAuthMobileHandoffs,
  };
}

function toUserCascadeDeleteCounts(
  progress: UserCascadeDeleteProgress,
): UserCascadeDeleteCounts {
  return {
    deletedMemories: progress.deletedMemories,
    deletedSummaries: progress.deletedSummaries,
    deletedDays: progress.deletedDays,
    deletedIntegrations: progress.deletedIntegrations,
    deletedPreferences: progress.deletedPreferences,
    deletedAuditLogs: progress.deletedAuditLogs,
    deletedPlatformAuditEvents: progress.deletedPlatformAuditEvents,
    deletedMemoryMedia: progress.deletedMemoryMedia,
    deletedIntegrationDailyData: progress.deletedIntegrationDailyData,
    deletedIntegrationSecrets: progress.deletedIntegrationSecrets,
    deletedIntegrationRevocationJobs: progress.deletedIntegrationRevocationJobs,
    deletedIntegrationSyncRuns: progress.deletedIntegrationSyncRuns,
    deletedIntegrationHealthEvents: progress.deletedIntegrationHealthEvents,
    deletedExportJobs: progress.deletedExportJobs,
    deletedRestoreJobs: progress.deletedRestoreJobs,
    deletedAiSummaryAttempts: progress.deletedAiSummaryAttempts,
    deletedSummaryGenerationEvents: progress.deletedSummaryGenerationEvents,
    ...((progress.deletedAiUsageRecords ?? 0) > 0
      ? { deletedAiUsageRecords: progress.deletedAiUsageRecords }
      : {}),
    deletedSummaryQualityEvaluations: progress.deletedSummaryQualityEvaluations,
    deletedDailyFeatureVectors: progress.deletedDailyFeatureVectors,
    deletedNextBestDayRecommendations:
      progress.deletedNextBestDayRecommendations,
    deletedSummaryGenerationQuotas: progress.deletedSummaryGenerationQuotas,
    deletedSummaryGenerationQuotaReservations:
      progress.deletedSummaryGenerationQuotaReservations,
    deletedOAuthMobileHandoffs: progress.deletedOAuthMobileHandoffs,
  };
}

export function getNextUserCascadeDeletionStage(
  stage: UserCascadeDeletionStage,
): UserCascadeDeletionStage | null {
  const currentIndex = USER_CASCADE_DELETION_STAGES.indexOf(stage);
  const next = USER_CASCADE_DELETION_STAGES[currentIndex + 1];
  return next ?? null;
}

type BatchDeleteResult = {
  nextCursor: string | null;
  isDone: boolean;
  deleted: number;
};

function resolveBatchSize(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_USER_CASCADE_DELETE_BATCH_SIZE;
  }

  return Math.max(1, Math.min(Math.floor(value ?? 0), 512));
}

async function safeDeleteStorageBlob(
  ctx: CascadeCtx,
  storageId: string,
): Promise<void> {
  await ctx.storage.delete(storageId as Id<"_storage">);
}

export async function deleteMemoryMediaByMemoryId(
  ctx: CascadeCtx,
  memoryId: Id<"memories">,
): Promise<number> {
  const media = await ctx.db
    .query("memoryMedia")
    .withIndex("by_memory", (q) => q.eq("memoryId", memoryId))
    .collect();

  let deletedMediaCount = 0;
  for (const mediaDoc of media) {
    await safeDeleteStorageBlob(ctx, mediaDoc.storageId);
    await ctx.db.delete(mediaDoc._id);
    deletedMediaCount += 1;
  }

  return deletedMediaCount;
}

async function deleteMemoryMediaByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("memoryMedia")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const mediaDoc of page.page) {
    const memory = await ctx.db.get(mediaDoc.memoryId);
    if (
      memory?.thumbnailStorageId &&
      memory.thumbnailStorageId !== mediaDoc.storageId
    ) {
      await safeDeleteStorageBlob(ctx, memory.thumbnailStorageId);
      await ctx.db.patch(memory._id, { thumbnailStorageId: undefined });
    } else if (memory?.thumbnailStorageId === mediaDoc.storageId) {
      await ctx.db.patch(memory._id, { thumbnailStorageId: undefined });
    }

    await safeDeleteStorageBlob(ctx, mediaDoc.storageId);
    await ctx.db.delete(mediaDoc._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteMemoriesByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("memories")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const memory of page.page) {
    if (memory.thumbnailStorageId) {
      await safeDeleteStorageBlob(ctx, memory.thumbnailStorageId);
    }
    await ctx.db.delete(memory._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteSummariesByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("daySummaries")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const summary of page.page) {
    await ctx.db.delete(summary._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteDaysByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("days")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const day of page.page) {
    await ctx.db.delete(day._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteIntegrationsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("integrations")
    .withIndex("by_user_provider", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const integration of page.page) {
    await ctx.db.delete(integration._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteIntegrationDailyDataByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("integrationDailyData")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const row of page.page) {
    await ctx.db.delete(row._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteIntegrationSecretsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("integrationSecrets")
    .withIndex("by_user_provider", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const secret of page.page) {
    const activeRevocations = await ctx.db
      .query("integrationRevocationJobs")
      .withIndex("by_user_tokenRef", (q) =>
        q.eq("userId", userId).eq("tokenRef", secret.tokenRef),
      )
      .take(10);
    if (
      activeRevocations.some(
        (job) => job.status === "pending" || job.status === "processing",
      )
    ) {
      continue;
    }

    await ctx.db.delete(secret._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteIntegrationSyncRunsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("integrationSyncRuns")
    .withIndex("by_user_provider", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const row of page.page) {
    await ctx.db.delete(row._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteIntegrationRevocationJobsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("integrationRevocationJobs")
    .withIndex("by_user_tokenRef", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const job of page.page) {
    if (job.status === "pending" || job.status === "processing") {
      continue;
    }

    await ctx.db.delete(job._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteExportJobsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("exportJobs")
    .withIndex("by_user_requestedAt", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const job of page.page) {
    if (typeof job.artifactStorageId === "string" && job.artifactStorageId) {
      await safeDeleteStorageBlob(ctx, job.artifactStorageId);
    }
    await ctx.db.delete(job._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteRestoreJobsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("restoreJobs")
    .withIndex("by_user_requestedAt", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const job of page.page) {
    await ctx.db.delete(job._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteSummaryQualityEvaluationsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("summaryQualityEvaluations")
    .withIndex("by_user_day_evaluatedAt", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const evaluation of page.page) {
    await ctx.db.delete(evaluation._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteSummaryGenerationEventsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("summaryGenerationEvents")
    .withIndex("by_user_day_createdAt", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const event of page.page) {
    await ctx.db.delete(event._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteAiSummaryAttemptsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("aiSummaryAttempts")
    .withIndex("by_user_day_createdAt", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const attempt of page.page) {
    await ctx.db.delete(attempt._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteAiUsageRecordsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("aiUsageRecords")
    .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  for (const record of page.page) {
    await ctx.db.delete(record._id);
  }

  return {
    deleted: page.page.length,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteDailyFeatureVectorsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("dailyFeatureVectors")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const vector of page.page) {
    await ctx.db.delete(vector._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteNextBestDayRecommendationsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("nextBestDayRecommendations")
    .withIndex("by_user_targetDay", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const recommendation of page.page) {
    await ctx.db.delete(recommendation._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteIntegrationHealthEventsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("integrationHealthEvents")
    .withIndex("by_userId_at", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const event of page.page) {
    await ctx.db.delete(event._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deletePreferencesByClerkUserIdBatch(
  ctx: CascadeCtx,
  clerkUserId: string,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("userPreferences")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const preference of page.page) {
    await ctx.db.delete(preference._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteAuditLogsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("auditLogs")
    .withIndex("by_userId", (q) => q.eq("actorUserId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const log of page.page) {
    await ctx.db.delete(log._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deletePlatformAuditEventsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("platformAuditEvents")
    .withIndex("by_actorUserId_at", (q) => q.eq("actorUserId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const event of page.page) {
    await ctx.db.delete(event._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteSummaryQuotasByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("summaryGenerationQuotas")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const quota of page.page) {
    await ctx.db.delete(quota._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteSummaryQuotaReservationsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("summaryGenerationQuotaReservations")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const reservation of page.page) {
    await ctx.db.delete(reservation._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function deleteOAuthMobileHandoffsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await ctx.db
    .query("oauthMobileHandoffs")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const handoff of page.page) {
    await ctx.db.delete(handoff._id);
    deleted += 1;
  }

  return {
    deleted,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

export async function runUserCascadeDeletionStageBatch(
  ctx: CascadeCtx,
  input: UserCascadeBatchInput,
): Promise<UserCascadeBatchResult> {
  const batchSize = resolveBatchSize(input.batchSize);
  const deleted = emptyUserCascadeDeleteProgress();
  let result: BatchDeleteResult;

  switch (input.stage) {
    case "memoryMedia": {
      result = await deleteMemoryMediaByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedMemoryMedia = result.deleted;
      break;
    }
    case "memories": {
      result = await deleteMemoriesByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedMemories = result.deleted;
      break;
    }
    case "daySummaries": {
      result = await deleteSummariesByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedSummaries = result.deleted;
      break;
    }
    case "days": {
      result = await deleteDaysByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedDays = result.deleted;
      break;
    }
    case "integrations": {
      result = await deleteIntegrationsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedIntegrations = result.deleted;
      break;
    }
    case "integrationDailyData": {
      result = await deleteIntegrationDailyDataByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedIntegrationDailyData = result.deleted;
      break;
    }
    case "integrationSecrets": {
      result = await deleteIntegrationSecretsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedIntegrationSecrets = result.deleted;
      break;
    }
    case "integrationRevocationJobs": {
      result = await deleteIntegrationRevocationJobsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedIntegrationRevocationJobs = result.deleted;
      break;
    }
    case "integrationSyncRuns": {
      result = await deleteIntegrationSyncRunsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedIntegrationSyncRuns = result.deleted;
      break;
    }
    case "exportJobs": {
      result = await deleteExportJobsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedExportJobs = result.deleted;
      break;
    }
    case "restoreJobs": {
      result = await deleteRestoreJobsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedRestoreJobs = result.deleted;
      break;
    }
    case "summaryQualityEvaluations": {
      result = await deleteSummaryQualityEvaluationsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedSummaryQualityEvaluations = result.deleted;
      break;
    }
    case "aiSummaryAttempts": {
      result = await deleteAiSummaryAttemptsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedAiSummaryAttempts = result.deleted;
      break;
    }
    case "summaryGenerationEvents": {
      result = await deleteSummaryGenerationEventsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedSummaryGenerationEvents = result.deleted;
      break;
    }
    case "aiUsageRecords": {
      result = await deleteAiUsageRecordsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedAiUsageRecords = result.deleted;
      break;
    }
    case "dailyFeatureVectors": {
      result = await deleteDailyFeatureVectorsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedDailyFeatureVectors = result.deleted;
      break;
    }
    case "nextBestDayRecommendations": {
      result = await deleteNextBestDayRecommendationsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedNextBestDayRecommendations = result.deleted;
      break;
    }
    case "integrationHealthEvents": {
      result = await deleteIntegrationHealthEventsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedIntegrationHealthEvents = result.deleted;
      break;
    }
    case "userPreferences": {
      result = await deletePreferencesByClerkUserIdBatch(
        ctx,
        input.clerkUserId,
        input.cursor,
        batchSize,
      );
      deleted.deletedPreferences = result.deleted;
      break;
    }
    case "auditLogs": {
      result = await deleteAuditLogsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedAuditLogs = result.deleted;
      break;
    }
    case "platformAuditEvents": {
      result = await deletePlatformAuditEventsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedPlatformAuditEvents = result.deleted;
      break;
    }
    case "summaryGenerationQuotas": {
      result = await deleteSummaryQuotasByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedSummaryGenerationQuotas = result.deleted;
      break;
    }
    case "summaryGenerationQuotaReservations": {
      result = await deleteSummaryQuotaReservationsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedSummaryGenerationQuotaReservations = result.deleted;
      break;
    }
    case "oauthMobileHandoffs": {
      result = await deleteOAuthMobileHandoffsByUserBatch(
        ctx,
        input.userId,
        input.cursor,
        batchSize,
      );
      deleted.deletedOAuthMobileHandoffs = result.deleted;
      break;
    }
    default: {
      throw new Error("Unsupported user deletion stage");
    }
  }

  return {
    stage: input.stage,
    deleted,
    isStageComplete: result.isDone,
    nextCursor: result.nextCursor,
  };
}

export async function deleteUserCascadeData(
  ctx: CascadeCtx,
  input: UserCascadeInput,
): Promise<UserCascadeDeleteCounts> {
  let stage: UserCascadeDeletionStage | null = USER_CASCADE_DELETION_STAGES[0];
  let cursor: string | null = null;
  let progress = emptyUserCascadeDeleteProgress();

  while (stage) {
    const batch = await runUserCascadeDeletionStageBatch(ctx, {
      userId: input.userId,
      clerkUserId: input.clerkUserId,
      stage,
      cursor,
      batchSize: DEFAULT_USER_CASCADE_DELETE_BATCH_SIZE,
    });

    progress = mergeUserCascadeDeleteProgress(progress, batch.deleted);

    if (batch.isStageComplete) {
      stage = getNextUserCascadeDeletionStage(stage);
      cursor = null;
      continue;
    }

    cursor = batch.nextCursor;
  }

  return toUserCascadeDeleteCounts(progress);
}

export async function deleteDayCascadeData(
  ctx: CascadeCtx,
  input: DayCascadeInput,
): Promise<DayCascadeDeleteCounts> {
  const summaries = await ctx.db
    .query("daySummaries")
    .withIndex("by_user_day", (q) =>
      q.eq("userId", input.userId).eq("dayKey", input.dayKey),
    )
    .collect();

  let deletedSummaries = 0;
  for (const summary of summaries) {
    await ctx.db.delete(summary._id);
    deletedSummaries += 1;
  }

  const memories = await ctx.db
    .query("memories")
    .withIndex("by_user_day", (q) =>
      q.eq("userId", input.userId).eq("dayKey", input.dayKey),
    )
    .collect();

  let deletedMemories = 0;
  for (const memory of memories) {
    await deleteMemoryMediaByMemoryId(ctx, memory._id);
    await ctx.db.delete(memory._id);
    deletedMemories += 1;
  }

  const integrationDailyRows = await ctx.db
    .query("integrationDailyData")
    .withIndex("by_user_day", (q) =>
      q.eq("userId", input.userId).eq("dayKey", input.dayKey),
    )
    .collect();

  let deletedIntegrationDailyData = 0;
  for (const row of integrationDailyRows) {
    await ctx.db.delete(row._id);
    deletedIntegrationDailyData += 1;
  }

  return {
    deletedMemories,
    deletedSummaries,
    deletedIntegrationDailyData,
  };
}
