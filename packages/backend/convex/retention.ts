import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./authz";
import { deleteMemoryMediaByMemoryId } from "./cascadeCleanup";
import type { Id } from "./_generated/dataModel";
import {
  getRetentionDeleteBatchSize,
  getRetentionPolicyDefaults,
  type RetentionPolicyKey,
} from "./runtimeConfig";

const POLICY_KEYS: RetentionPolicyKey[] = [
  "memories",
  "days",
  "daySummaries",
  "integrationDailyData",
  "integrationSyncRuns",
  "locationSignals",
  "summaryGenerationEvents",
  "summaryQualityEvaluations",
  "summaryGenerationQuotas",
  "infoEvents",
  "integrationHealthEvents",
  "auditLogs",
  "platformAuditEvents",
  "exportJobs",
  "restoreJobs",
  "userDeletionJobs",
];

const DEFAULT_ADMIN_RETENTION_POLICIES_PAGE_LIMIT = 25;
const MAX_ADMIN_RETENTION_POLICIES_PAGE_LIMIT = 100;

type EffectiveRetentionPolicy = {
  key: RetentionPolicyKey;
  retentionDays: number;
  sensitive: boolean;
  enabled: boolean;
  source: "env" | "db";
  updatedAt?: number;
};

type RetentionDeleteCounts = {
  memories: number;
  days: number;
  daySummaries: number;
  integrationDailyData: number;
  integrationSyncRuns: number;
  locationSignals: number;
  summaryGenerationEvents: number;
  summaryQualityEvaluations: number;
  summaryGenerationQuotas: number;
  infoEvents: number;
  integrationHealthEvents: number;
  auditLogs: number;
  platformAuditEvents: number;
  exportJobs: number;
  restoreJobs: number;
  userDeletionJobs: number;
};

type CleanupExecutionArgs = {
  trigger: "cron" | "manual";
  actorUserId?: Id<"user">;
  dryRun: boolean;
  maxDeletesPerPolicy: number;
};

function isRetentionPolicyKey(value: string): value is RetentionPolicyKey {
  return (POLICY_KEYS as string[]).includes(value);
}

function clampAdminRetentionPoliciesPageLimit(
  value: number | undefined,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ADMIN_RETENTION_POLICIES_PAGE_LIMIT;
  }

  const normalized = Math.floor(value);
  if (normalized < 1) return 1;
  if (normalized > MAX_ADMIN_RETENTION_POLICIES_PAGE_LIMIT) {
    return MAX_ADMIN_RETENTION_POLICIES_PAGE_LIMIT;
  }

  return normalized;
}

function parseAdminRetentionPoliciesCursor(cursor: string | undefined): number {
  if (typeof cursor !== "string" || cursor.trim().length === 0) {
    return 0;
  }

  const parsed = Number(cursor);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function retentionCutoff(now: number, retentionDays: number): number {
  return now - retentionDays * 24 * 60 * 60 * 1000;
}

function retentionCutoffDayKey(now: number, retentionDays: number): string {
  return new Date(retentionCutoff(now, retentionDays))
    .toISOString()
    .slice(0, 10);
}

function toRetentionDays(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new Error("retentionDays must be an integer between 1 and 3650");
  }

  return value;
}

function summarizePolicies(
  policies: Record<RetentionPolicyKey, EffectiveRetentionPolicy>,
) {
  return POLICY_KEYS.map((key) => {
    const policy = policies[key];
    return {
      key,
      retentionDays: policy.retentionDays,
      sensitive: policy.sensitive,
      enabled: policy.enabled,
    };
  });
}

function safeDetailsJson(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).slice(0, 1500);
}

async function resolveEffectiveRetentionPolicies(
  db: QueryCtx["db"] | MutationCtx["db"],
): Promise<Record<RetentionPolicyKey, EffectiveRetentionPolicy>> {
  const defaults = getRetentionPolicyDefaults();

  const resolved = POLICY_KEYS.reduce(
    (acc, key) => {
      acc[key] = {
        key,
        retentionDays: defaults[key].retentionDays,
        sensitive: defaults[key].sensitive,
        enabled: defaults[key].enabled,
        source: "env",
      };
      return acc;
    },
    {} as Record<RetentionPolicyKey, EffectiveRetentionPolicy>,
  );

  for (const key of POLICY_KEYS) {
    const policy = await db
      .query("dataRetentionPolicies")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (!policy) {
      continue;
    }

    resolved[key] = {
      key,
      retentionDays: toRetentionDays(policy.retentionDays),
      sensitive: policy.sensitive,
      enabled: policy.enabled,
      source: "db",
      updatedAt: policy.updatedAt,
    };
  }

  return resolved;
}

async function purgeMemories(
  ctx: Pick<MutationCtx, "db" | "storage">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleMemories = await ctx.db
    .query("memories")
    .withIndex("by_happenedAt", (q) => q.lt("happenedAt", cutoff))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleMemories.length;

  for (const memory of staleMemories) {
    await deleteMemoryMediaByMemoryId(ctx, memory._id);
    await ctx.db.delete(memory._id);
  }

  return staleMemories.length;
}

async function purgeDaySummaries(
  ctx: Pick<MutationCtx, "db">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleSummaries = await ctx.db
    .query("daySummaries")
    .withIndex("by_generatedAt", (q) => q.lt("generatedAt", cutoff))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleSummaries.length;

  for (const summary of staleSummaries) {
    await ctx.db.delete(summary._id);
  }

  return staleSummaries.length;
}

async function purgeDays(
  ctx: Pick<MutationCtx, "db">,
  cutoffDayKey: string,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleDays = await ctx.db
    .query("days")
    .withIndex("by_dayKey", (q) => q.lt("dayKey", cutoffDayKey))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleDays.length;

  for (const day of staleDays) {
    await ctx.db.delete(day._id);
  }

  return staleDays.length;
}

async function purgeLocationSignals(
  ctx: Pick<MutationCtx, "db">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleLocationRows = await ctx.db
    .query("integrationDailyData")
    .withIndex("by_provider_syncedAt", (q) =>
      q.eq("provider", "location").lt("syncedAt", cutoff),
    )
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleLocationRows.length;

  for (const row of staleLocationRows) {
    await ctx.db.delete(row._id);
  }

  return staleLocationRows.length;
}

async function purgeIntegrationDailyData(
  ctx: Pick<MutationCtx, "db">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleRows = await ctx.db
    .query("integrationDailyData")
    .withIndex("by_syncedAt", (q) => q.lt("syncedAt", cutoff))
    .order("asc")
    .take(maxDeletes * 3);

  const nonLocationRows = staleRows
    .filter((row) => row.provider !== "location")
    .slice(0, maxDeletes);

  if (dryRun) return nonLocationRows.length;

  for (const row of nonLocationRows) {
    await ctx.db.delete(row._id);
  }

  return nonLocationRows.length;
}

async function purgeSummaryGenerationEvents(
  ctx: Pick<MutationCtx, "db">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleEvents = await ctx.db
    .query("summaryGenerationEvents")
    .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleEvents.length;

  for (const event of staleEvents) {
    const evaluations = await ctx.db
      .query("summaryQualityEvaluations")
      .withIndex("by_generationEventId", (q) =>
        q.eq("generationEventId", event._id),
      )
      .collect();

    for (const evaluation of evaluations) {
      await ctx.db.delete(evaluation._id);
    }

    await ctx.db.delete(event._id);
  }

  return staleEvents.length;
}

async function purgeSummaryQualityEvaluations(
  ctx: Pick<MutationCtx, "db">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleEvaluations = await ctx.db
    .query("summaryQualityEvaluations")
    .withIndex("by_evaluatedAt", (q) => q.lt("evaluatedAt", cutoff))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleEvaluations.length;

  for (const evaluation of staleEvaluations) {
    await ctx.db.delete(evaluation._id);
  }

  return staleEvaluations.length;
}

async function purgeSummaryGenerationQuotas(
  ctx: Pick<MutationCtx, "db">,
  cutoffDayKey: string,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleQuotas = await (ctx.db as any)
    .query("summaryGenerationQuotas")
    .withIndex("by_quotaDayKey", (q: any) => q.lt("quotaDayKey", cutoffDayKey))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleQuotas.length;

  for (const quota of staleQuotas) {
    await (ctx.db as any).delete(quota._id);
  }

  return staleQuotas.length;
}

async function purgeIntegrationSyncRuns(
  ctx: Pick<MutationCtx, "db">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleRuns = await (ctx.db as any)
    .query("integrationSyncRuns")
    .withIndex("by_updatedAt", (q: any) => q.lt("updatedAt", cutoff))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleRuns.length;

  for (const run of staleRuns) {
    await (ctx.db as any).delete(run._id);
  }

  return staleRuns.length;
}

async function purgeIntegrationHealthEvents(
  ctx: Pick<MutationCtx, "db">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleEvents = await (ctx.db as any)
    .query("integrationHealthEvents")
    .withIndex("by_at", (q: any) => q.lt("at", cutoff))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleEvents.length;

  for (const event of staleEvents) {
    await (ctx.db as any).delete(event._id);
  }

  return staleEvents.length;
}

async function purgeAuditLogs(
  ctx: Pick<MutationCtx, "db">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleLogs = await ctx.db
    .query("auditLogs")
    .withIndex("by_createdAt", (q) => q.lt("at", cutoff))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleLogs.length;

  for (const log of staleLogs) {
    await ctx.db.delete(log._id);
  }

  return staleLogs.length;
}

async function purgePlatformAuditEvents(
  ctx: Pick<MutationCtx, "db">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleEvents = await (ctx.db as any)
    .query("platformAuditEvents")
    .withIndex("by_at", (q: any) => q.lt("at", cutoff))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleEvents.length;

  for (const event of staleEvents) {
    await (ctx.db as any).delete(event._id);
  }

  return staleEvents.length;
}

async function purgeExportJobs(
  ctx: Pick<MutationCtx, "db" | "storage">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleJobs = await (ctx.db as any)
    .query("exportJobs")
    .withIndex("by_requestedAt", (q: any) => q.lt("requestedAt", cutoff))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleJobs.length;

  for (const job of staleJobs) {
    if (typeof job.artifactStorageId === "string" && job.artifactStorageId) {
      try {
        await ctx.storage.delete(job.artifactStorageId);
      } catch {
        // Ignore missing or already-deleted artifacts.
      }
    }

    await (ctx.db as any).delete(job._id);
  }

  return staleJobs.length;
}

async function purgeRestoreJobs(
  ctx: Pick<MutationCtx, "db">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleJobs = await (ctx.db as any)
    .query("restoreJobs")
    .withIndex("by_requestedAt", (q: any) => q.lt("requestedAt", cutoff))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleJobs.length;

  for (const job of staleJobs) {
    await (ctx.db as any).delete(job._id);
  }

  return staleJobs.length;
}

async function purgeUserDeletionJobs(
  ctx: Pick<MutationCtx, "db">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleJobs = await ctx.db
    .query("userDeletionJobs")
    .withIndex("by_updatedAt", (q) => q.lt("updatedAt", cutoff))
    .order("asc")
    .take(maxDeletes * 3);

  const terminalJobs = staleJobs
    .filter((job) => job.status === "completed" || job.status === "failed")
    .slice(0, maxDeletes);

  if (dryRun) return terminalJobs.length;

  for (const job of terminalJobs) {
    await ctx.db.delete(job._id);
  }

  return terminalJobs.length;
}

async function purgeInfoEvents(
  ctx: Pick<MutationCtx, "db">,
  cutoff: number,
  maxDeletes: number,
  dryRun: boolean,
): Promise<number> {
  const staleEvents = await (ctx.db as any)
    .query("observabilityInfoEvents")
    .withIndex("by_receivedAt", (q: any) => q.lt("receivedAt", cutoff))
    .order("asc")
    .take(maxDeletes);

  if (dryRun) return staleEvents.length;

  for (const event of staleEvents) {
    await (ctx.db as any).delete(event._id);
  }

  return staleEvents.length;
}

async function runRetentionCleanupInternal(
  ctx: MutationCtx,
  args: CleanupExecutionArgs,
) {
  const startedAt = Date.now();
  const effectivePolicies = await resolveEffectiveRetentionPolicies(ctx.db);

  const deletedCounts: RetentionDeleteCounts = {
    memories: 0,
    days: 0,
    daySummaries: 0,
    integrationDailyData: 0,
    integrationSyncRuns: 0,
    locationSignals: 0,
    summaryGenerationEvents: 0,
    summaryQualityEvaluations: 0,
    summaryGenerationQuotas: 0,
    infoEvents: 0,
    integrationHealthEvents: 0,
    auditLogs: 0,
    platformAuditEvents: 0,
    exportJobs: 0,
    restoreJobs: 0,
    userDeletionJobs: 0,
  };

  try {
    if (effectivePolicies.memories.enabled) {
      deletedCounts.memories = await purgeMemories(
        ctx,
        retentionCutoff(startedAt, effectivePolicies.memories.retentionDays),
        args.maxDeletesPerPolicy,
        args.dryRun,
      );
    }

    if (effectivePolicies.days.enabled) {
      deletedCounts.days = await purgeDays(
        ctx,
        retentionCutoffDayKey(startedAt, effectivePolicies.days.retentionDays),
        args.maxDeletesPerPolicy,
        args.dryRun,
      );
    }

    if (effectivePolicies.daySummaries.enabled) {
      deletedCounts.daySummaries = await purgeDaySummaries(
        ctx,
        retentionCutoff(
          startedAt,
          effectivePolicies.daySummaries.retentionDays,
        ),
        args.maxDeletesPerPolicy,
        args.dryRun,
      );
    }

    if (effectivePolicies.locationSignals.enabled) {
      deletedCounts.locationSignals = await purgeLocationSignals(
        ctx,
        retentionCutoff(
          startedAt,
          effectivePolicies.locationSignals.retentionDays,
        ),
        args.maxDeletesPerPolicy,
        args.dryRun,
      );
    }

    if (effectivePolicies.integrationDailyData.enabled) {
      deletedCounts.integrationDailyData = await purgeIntegrationDailyData(
        ctx,
        retentionCutoff(
          startedAt,
          effectivePolicies.integrationDailyData.retentionDays,
        ),
        args.maxDeletesPerPolicy,
        args.dryRun,
      );
    }

    if (effectivePolicies.integrationSyncRuns.enabled) {
      deletedCounts.integrationSyncRuns = await purgeIntegrationSyncRuns(
        ctx,
        retentionCutoff(
          startedAt,
          effectivePolicies.integrationSyncRuns.retentionDays,
        ),
        args.maxDeletesPerPolicy,
        args.dryRun,
      );
    }

    if (effectivePolicies.summaryQualityEvaluations.enabled) {
      deletedCounts.summaryQualityEvaluations =
        await purgeSummaryQualityEvaluations(
          ctx,
          retentionCutoff(
            startedAt,
            effectivePolicies.summaryQualityEvaluations.retentionDays,
          ),
          args.maxDeletesPerPolicy,
          args.dryRun,
        );
    }

    if (effectivePolicies.summaryGenerationEvents.enabled) {
      deletedCounts.summaryGenerationEvents =
        await purgeSummaryGenerationEvents(
          ctx,
          retentionCutoff(
            startedAt,
            effectivePolicies.summaryGenerationEvents.retentionDays,
          ),
          args.maxDeletesPerPolicy,
          args.dryRun,
        );
    }

    if (effectivePolicies.summaryGenerationQuotas.enabled) {
      deletedCounts.summaryGenerationQuotas =
        await purgeSummaryGenerationQuotas(
          ctx,
          retentionCutoffDayKey(
            startedAt,
            effectivePolicies.summaryGenerationQuotas.retentionDays,
          ),
          args.maxDeletesPerPolicy,
          args.dryRun,
        );
    }

    if (effectivePolicies.infoEvents.enabled) {
      deletedCounts.infoEvents = await purgeInfoEvents(
        ctx,
        retentionCutoff(startedAt, effectivePolicies.infoEvents.retentionDays),
        args.maxDeletesPerPolicy,
        args.dryRun,
      );
    }

    if (effectivePolicies.integrationHealthEvents.enabled) {
      deletedCounts.integrationHealthEvents =
        await purgeIntegrationHealthEvents(
          ctx,
          retentionCutoff(
            startedAt,
            effectivePolicies.integrationHealthEvents.retentionDays,
          ),
          args.maxDeletesPerPolicy,
          args.dryRun,
        );
    }

    if (effectivePolicies.auditLogs.enabled) {
      deletedCounts.auditLogs = await purgeAuditLogs(
        ctx,
        retentionCutoff(startedAt, effectivePolicies.auditLogs.retentionDays),
        args.maxDeletesPerPolicy,
        args.dryRun,
      );
    }

    if (effectivePolicies.platformAuditEvents.enabled) {
      deletedCounts.platformAuditEvents = await purgePlatformAuditEvents(
        ctx,
        retentionCutoff(
          startedAt,
          effectivePolicies.platformAuditEvents.retentionDays,
        ),
        args.maxDeletesPerPolicy,
        args.dryRun,
      );
    }

    if (effectivePolicies.exportJobs.enabled) {
      deletedCounts.exportJobs = await purgeExportJobs(
        ctx,
        retentionCutoff(startedAt, effectivePolicies.exportJobs.retentionDays),
        args.maxDeletesPerPolicy,
        args.dryRun,
      );
    }

    if (effectivePolicies.restoreJobs.enabled) {
      deletedCounts.restoreJobs = await purgeRestoreJobs(
        ctx,
        retentionCutoff(startedAt, effectivePolicies.restoreJobs.retentionDays),
        args.maxDeletesPerPolicy,
        args.dryRun,
      );
    }

    if (effectivePolicies.userDeletionJobs.enabled) {
      deletedCounts.userDeletionJobs = await purgeUserDeletionJobs(
        ctx,
        retentionCutoff(
          startedAt,
          effectivePolicies.userDeletionJobs.retentionDays,
        ),
        args.maxDeletesPerPolicy,
        args.dryRun,
      );
    }

    const finishedAt = Date.now();

    const runId = await ctx.db.insert("dataRetentionRuns", {
      trigger: args.trigger,
      status: "success",
      dryRun: args.dryRun,
      startedAt,
      finishedAt,
      policySnapshot: summarizePolicies(effectivePolicies),
      deletedCounts,
      actorUserId: args.actorUserId,
    });

    await ctx.db.insert("platformAuditEvents", {
      category: "retention",
      action: args.dryRun ? "retention_dry_run" : "retention_cleanup",
      actorType: args.actorUserId ? "admin" : "system",
      actorUserId: args.actorUserId,
      target: String(runId),
      details: safeDetailsJson({
        trigger: args.trigger,
        deletedCounts,
      }),
      at: finishedAt,
    });

    return {
      runId,
      trigger: args.trigger,
      dryRun: args.dryRun,
      startedAt,
      finishedAt,
      deletedCounts,
      policies: summarizePolicies(effectivePolicies),
    };
  } catch (error) {
    const finishedAt = Date.now();
    const message =
      error instanceof Error
        ? error.message.slice(0, 220)
        : "Retention cleanup failed";

    const failedRunId = await ctx.db.insert("dataRetentionRuns", {
      trigger: args.trigger,
      status: "error",
      dryRun: args.dryRun,
      startedAt,
      finishedAt,
      policySnapshot: summarizePolicies(effectivePolicies),
      deletedCounts,
      error: message,
      actorUserId: args.actorUserId,
    });

    await ctx.db.insert("platformAuditEvents", {
      category: "retention",
      action: "retention_cleanup_failed",
      actorType: args.actorUserId ? "admin" : "system",
      actorUserId: args.actorUserId,
      target: String(failedRunId),
      details: safeDetailsJson({
        trigger: args.trigger,
        error: message,
      }),
      at: finishedAt,
    });

    throw error;
  }
}

export const listEffectiveRetentionPolicies = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const effective = await resolveEffectiveRetentionPolicies(ctx.db);
    const allPolicies = summarizePolicies(effective).map((policy) => ({
      ...policy,
      source: effective[policy.key].source,
      updatedAt: effective[policy.key].updatedAt,
    }));

    const limit = clampAdminRetentionPoliciesPageLimit(args.limit);
    const start = parseAdminRetentionPoliciesCursor(args.cursor);
    const items = allPolicies.slice(start, start + limit);
    const nextOffset = start + items.length;

    return {
      items,
      nextCursor: nextOffset < allPolicies.length ? String(nextOffset) : null,
    };
  },
});

export const upsertRetentionPolicy = mutation({
  args: {
    key: v.string(),
    retentionDays: v.number(),
    sensitive: v.optional(v.boolean()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    if (!isRetentionPolicyKey(args.key)) {
      throw new Error("Unsupported retention policy key");
    }

    const now = Date.now();
    const retentionDays = toRetentionDays(args.retentionDays);

    const existing = await ctx.db
      .query("dataRetentionPolicies")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    const payload = {
      key: args.key,
      retentionDays,
      sensitive: args.sensitive ?? existing?.sensitive ?? false,
      enabled: args.enabled ?? existing?.enabled ?? true,
      updatedBy: admin._id,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("dataRetentionPolicies", {
        ...payload,
        createdAt: now,
      });
    }

    return {
      success: true,
      ...payload,
    };
  },
});

export const runRetentionCleanupNow = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
    maxDeletesPerPolicy: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const maxDeletesPerPolicy =
      typeof args.maxDeletesPerPolicy === "number" &&
      Number.isFinite(args.maxDeletesPerPolicy) &&
      args.maxDeletesPerPolicy > 0
        ? Math.min(Math.floor(args.maxDeletesPerPolicy), 5000)
        : getRetentionDeleteBatchSize();

    return await runRetentionCleanupInternal(ctx, {
      trigger: "manual",
      actorUserId: admin._id,
      dryRun: args.dryRun ?? false,
      maxDeletesPerPolicy,
    });
  },
});

export const runScheduledRetentionCleanupInternal = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    maxDeletesPerPolicy: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxDeletesPerPolicy =
      typeof args.maxDeletesPerPolicy === "number" &&
      Number.isFinite(args.maxDeletesPerPolicy) &&
      args.maxDeletesPerPolicy > 0
        ? Math.min(Math.floor(args.maxDeletesPerPolicy), 5000)
        : getRetentionDeleteBatchSize();

    return await runRetentionCleanupInternal(ctx, {
      trigger: "cron",
      dryRun: args.dryRun ?? false,
      maxDeletesPerPolicy,
    });
  },
});

export const listRetentionRunsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    return await ctx.db
      .query("dataRetentionRuns")
      .withIndex("by_startedAt")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
