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
  deletedIntegrationSyncRuns: number;
  deletedIntegrationHealthEvents: number;
  deletedExportJobs: number;
  deletedRestoreJobs: number;
  deletedSummaryGenerationEvents: number;
  deletedSummaryQualityEvaluations: number;
  deletedSummaryGenerationQuotas: number;
};

export type DayCascadeDeleteCounts = {
  deletedMemories: number;
  deletedSummaries: number;
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
  "integrationSyncRuns",
  "exportJobs",
  "restoreJobs",
  "summaryQualityEvaluations",
  "summaryGenerationEvents",
  "integrationHealthEvents",
  "userPreferences",
  "auditLogs",
  "platformAuditEvents",
  "summaryGenerationQuotas",
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
    deletedIntegrationSyncRuns: 0,
    deletedIntegrationHealthEvents: 0,
    deletedExportJobs: 0,
    deletedRestoreJobs: 0,
    deletedSummaryGenerationEvents: 0,
    deletedSummaryQualityEvaluations: 0,
    deletedSummaryGenerationQuotas: 0,
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
    deletedIntegrationSyncRuns:
      base.deletedIntegrationSyncRuns + delta.deletedIntegrationSyncRuns,
    deletedIntegrationHealthEvents:
      base.deletedIntegrationHealthEvents +
      delta.deletedIntegrationHealthEvents,
    deletedExportJobs: base.deletedExportJobs + delta.deletedExportJobs,
    deletedRestoreJobs: base.deletedRestoreJobs + delta.deletedRestoreJobs,
    deletedSummaryGenerationEvents:
      base.deletedSummaryGenerationEvents +
      delta.deletedSummaryGenerationEvents,
    deletedSummaryQualityEvaluations:
      base.deletedSummaryQualityEvaluations +
      delta.deletedSummaryQualityEvaluations,
    deletedSummaryGenerationQuotas:
      base.deletedSummaryGenerationQuotas +
      delta.deletedSummaryGenerationQuotas,
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
    deletedIntegrationSyncRuns: progress.deletedIntegrationSyncRuns,
    deletedIntegrationHealthEvents: progress.deletedIntegrationHealthEvents,
    deletedExportJobs: progress.deletedExportJobs,
    deletedRestoreJobs: progress.deletedRestoreJobs,
    deletedSummaryGenerationEvents: progress.deletedSummaryGenerationEvents,
    deletedSummaryQualityEvaluations: progress.deletedSummaryQualityEvaluations,
    deletedSummaryGenerationQuotas: progress.deletedSummaryGenerationQuotas,
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
  try {
    await ctx.storage.delete(storageId as Id<"_storage">);
  } catch {
    // Storage blob may already be gone — continue cleanup.
  }
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

async function deleteExportJobsByUserBatch(
  ctx: CascadeCtx,
  userId: Id<"user">,
  cursor: string | null,
  batchSize: number,
): Promise<BatchDeleteResult> {
  const page = await (ctx.db as any)
    .query("exportJobs")
    .withIndex("by_user_requestedAt", (q: any) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const job of page.page as Array<{
    _id: string;
    artifactStorageId?: string;
  }>) {
    if (typeof job.artifactStorageId === "string" && job.artifactStorageId) {
      await safeDeleteStorageBlob(ctx, job.artifactStorageId);
    }
    await (ctx.db as any).delete(job._id);
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
  const page = await (ctx.db as any)
    .query("restoreJobs")
    .withIndex("by_user_requestedAt", (q: any) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const job of page.page as Array<{ _id: string }>) {
    await (ctx.db as any).delete(job._id);
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
  const page = await (ctx.db as any)
    .query("summaryQualityEvaluations")
    .withIndex("by_user_day_evaluatedAt", (q: any) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const evaluation of page.page as Array<{ _id: string }>) {
    await (ctx.db as any).delete(evaluation._id);
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
  const page = await (ctx.db as any)
    .query("summaryGenerationEvents")
    .withIndex("by_user_day_createdAt", (q: any) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const event of page.page as Array<{ _id: string }>) {
    await (ctx.db as any).delete(event._id);
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
  const page = await (ctx.db as any)
    .query("integrationHealthEvents")
    .withIndex("by_userId_at", (q: any) => q.eq("userId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const event of page.page as Array<{ _id: string }>) {
    await (ctx.db as any).delete(event._id);
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
  const page = await (ctx.db as any)
    .query("platformAuditEvents")
    .withIndex("by_actorUserId_at", (q: any) => q.eq("actorUserId", userId))
    .paginate({
      numItems: batchSize,
      cursor,
    });

  let deleted = 0;
  for (const event of page.page as Array<{ _id: string }>) {
    await (ctx.db as any).delete(event._id);
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

  return {
    deletedMemories,
    deletedSummaries,
  };
}
