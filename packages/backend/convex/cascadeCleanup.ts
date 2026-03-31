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
): Promise<void> {
  const media = await ctx.db
    .query("memoryMedia")
    .withIndex("by_memory", (q) => q.eq("memoryId", memoryId))
    .collect();

  for (const mediaDoc of media) {
    await safeDeleteStorageBlob(ctx, mediaDoc.storageId);
    await ctx.db.delete(mediaDoc._id);
  }
}

async function deleteMemoriesByUser(
  ctx: CascadeCtx,
  userId: Id<"user">,
): Promise<void> {
  const memories = await ctx.db
    .query("memories")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .collect();

  for (const memory of memories) {
    await deleteMemoryMediaByMemoryId(ctx, memory._id);
    await ctx.db.delete(memory._id);
  }
}

async function deleteSummariesByUser(
  ctx: CascadeCtx,
  userId: Id<"user">,
): Promise<void> {
  const summaries = await ctx.db
    .query("daySummaries")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .collect();

  for (const summary of summaries) {
    await ctx.db.delete(summary._id);
  }
}

async function deleteDaysByUser(
  ctx: CascadeCtx,
  userId: Id<"user">,
): Promise<void> {
  const days = await ctx.db
    .query("days")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .collect();

  for (const day of days) {
    await ctx.db.delete(day._id);
  }
}

async function deleteIntegrationsByUser(
  ctx: CascadeCtx,
  userId: Id<"user">,
): Promise<void> {
  const integrations = await ctx.db
    .query("integrations")
    .withIndex("by_user_provider", (q) => q.eq("userId", userId))
    .collect();

  for (const integration of integrations) {
    await ctx.db.delete(integration._id);
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
}

async function deletePreferencesByClerkUserId(
  ctx: CascadeCtx,
  clerkUserId: string,
): Promise<void> {
  const preferences = await ctx.db
    .query("userPreferences")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
    .collect();

  for (const preference of preferences) {
    await ctx.db.delete(preference._id);
  }
}

async function deleteAuditLogsByUser(
  ctx: CascadeCtx,
  userId: Id<"user">,
): Promise<void> {
  const auditLogs = await ctx.db
    .query("auditLogs")
    .withIndex("by_userId", (q) => q.eq("actorUserId", userId))
    .collect();

  for (const log of auditLogs) {
    await ctx.db.delete(log._id);
  }
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
): Promise<void> {
  await deleteMemoriesByUser(ctx, input.userId);
  await deleteDaysByUser(ctx, input.userId);
  await deleteSummariesByUser(ctx, input.userId);
  await deleteIntegrationsByUser(ctx, input.userId);
  await deletePreferencesByClerkUserId(ctx, input.clerkUserId);
  await deleteAuditLogsByUser(ctx, input.userId);
  await deleteSummaryQuotasByUser(ctx, input.userId);
}

export async function deleteDayCascadeData(
  ctx: CascadeCtx,
  input: DayCascadeInput,
): Promise<void> {
  const summaries = await ctx.db
    .query("daySummaries")
    .withIndex("by_user_day", (q) =>
      q.eq("userId", input.userId).eq("dayKey", input.dayKey),
    )
    .collect();

  for (const summary of summaries) {
    await ctx.db.delete(summary._id);
  }

  const memories = await ctx.db
    .query("memories")
    .withIndex("by_user_day", (q) =>
      q.eq("userId", input.userId).eq("dayKey", input.dayKey),
    )
    .collect();

  for (const memory of memories) {
    await deleteMemoryMediaByMemoryId(ctx, memory._id);
    await ctx.db.delete(memory._id);
  }
}
