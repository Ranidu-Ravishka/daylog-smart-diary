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
};

export type DayCascadeDeleteCounts = {
  deletedMemories: number;
  deletedSummaries: number;
};

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

async function deleteMemoriesByUser(
  ctx: CascadeCtx,
  userId: Id<"user">,
): Promise<number> {
  const memories = await ctx.db
    .query("memories")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .collect();

  let deletedMemories = 0;
  for (const memory of memories) {
    await deleteMemoryMediaByMemoryId(ctx, memory._id);
    await ctx.db.delete(memory._id);
    deletedMemories += 1;
  }

  return deletedMemories;
}

async function deleteSummariesByUser(
  ctx: CascadeCtx,
  userId: Id<"user">,
): Promise<number> {
  const summaries = await ctx.db
    .query("daySummaries")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .collect();

  let deletedSummaries = 0;
  for (const summary of summaries) {
    await ctx.db.delete(summary._id);
    deletedSummaries += 1;
  }

  return deletedSummaries;
}

async function deleteDaysByUser(
  ctx: CascadeCtx,
  userId: Id<"user">,
): Promise<number> {
  const days = await ctx.db
    .query("days")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .collect();

  let deletedDays = 0;
  for (const day of days) {
    await ctx.db.delete(day._id);
    deletedDays += 1;
  }

  return deletedDays;
}

async function deleteIntegrationsByUser(
  ctx: CascadeCtx,
  userId: Id<"user">,
): Promise<number> {
  const integrations = await ctx.db
    .query("integrations")
    .withIndex("by_user_provider", (q) => q.eq("userId", userId))
    .collect();

  let deletedIntegrations = 0;
  for (const integration of integrations) {
    await ctx.db.delete(integration._id);
    deletedIntegrations += 1;
  }

  const integrationDailyData = await ctx.db
    .query("integrationDailyData")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .collect();

  for (const row of integrationDailyData) {
    await ctx.db.delete(row._id);
  }

  const integrationSecrets = await ctx.db
    .query("integrationSecrets")
    .withIndex("by_user_provider", (q) => q.eq("userId", userId))
    .collect();

  for (const secret of integrationSecrets) {
    await ctx.db.delete(secret._id);
  }

  const integrationSyncRuns = await ctx.db
    .query("integrationSyncRuns")
    .withIndex("by_user_provider", (q) => q.eq("userId", userId))
    .collect();

  for (const run of integrationSyncRuns) {
    await ctx.db.delete(run._id);
  }

  return deletedIntegrations;
}

async function deletePreferencesByClerkUserId(
  ctx: CascadeCtx,
  clerkUserId: string,
): Promise<number> {
  const preferences = await ctx.db
    .query("userPreferences")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
    .collect();

  let deletedPreferences = 0;
  for (const preference of preferences) {
    await ctx.db.delete(preference._id);
    deletedPreferences += 1;
  }

  return deletedPreferences;
}

async function deleteAuditLogsByUser(
  ctx: CascadeCtx,
  userId: Id<"user">,
): Promise<number> {
  const auditLogs = await ctx.db
    .query("auditLogs")
    .withIndex("by_userId", (q) => q.eq("actorUserId", userId))
    .collect();

  let deletedAuditLogs = 0;
  for (const log of auditLogs) {
    await ctx.db.delete(log._id);
    deletedAuditLogs += 1;
  }

  return deletedAuditLogs;
}

async function deleteSummaryQuotasByUser(
  ctx: CascadeCtx,
  userId: Id<"user">,
): Promise<void> {
  const quotas = await ctx.db
    .query("summaryGenerationQuotas")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .collect();

  for (const quota of quotas) {
    await ctx.db.delete(quota._id);
  }
}

export async function deleteUserCascadeData(
  ctx: CascadeCtx,
  input: UserCascadeInput,
): Promise<UserCascadeDeleteCounts> {
  const deletedMemories = await deleteMemoriesByUser(ctx, input.userId);
  const deletedDays = await deleteDaysByUser(ctx, input.userId);
  const deletedSummaries = await deleteSummariesByUser(ctx, input.userId);
  const deletedIntegrations = await deleteIntegrationsByUser(ctx, input.userId);
  const deletedPreferences = await deletePreferencesByClerkUserId(
    ctx,
    input.clerkUserId,
  );
  const deletedAuditLogs = await deleteAuditLogsByUser(ctx, input.userId);
  await deleteSummaryQuotasByUser(ctx, input.userId);

  return {
    deletedMemories,
    deletedSummaries,
    deletedDays,
    deletedIntegrations,
    deletedPreferences,
    deletedAuditLogs,
  };
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
