import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
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
  "daySummaries",
  "integrationDailyData",
  "locationSignals",
  "summaryGenerationEvents",
];

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
  daySummaries: number;
  integrationDailyData: number;
  locationSignals: number;
  summaryGenerationEvents: number;
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

function retentionCutoff(now: number, retentionDays: number): number {
  return now - retentionDays * 24 * 60 * 60 * 1000;
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

type RetentionPolicyReader = {
  query: (table: "dataRetentionPolicies") => {
    collect: () => Promise<
      Array<{
        key: string;
        retentionDays: number;
        sensitive: boolean;
        enabled: boolean;
        updatedAt: number;
      }>
    >;
  };
};

async function resolveEffectiveRetentionPolicies(ctx: {
  db: RetentionPolicyReader;
}): Promise<Record<RetentionPolicyKey, EffectiveRetentionPolicy>> {
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

  const persisted = await ctx.db.query("dataRetentionPolicies").collect();
  for (const policy of persisted) {
    if (!isRetentionPolicyKey(policy.key)) continue;

    resolved[policy.key] = {
      key: policy.key,
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

async function runRetentionCleanupInternal(
  ctx: MutationCtx,
  args: CleanupExecutionArgs,
) {
  const startedAt = Date.now();
  const effectivePolicies = await resolveEffectiveRetentionPolicies(ctx);

  const deletedCounts: RetentionDeleteCounts = {
    memories: 0,
    daySummaries: 0,
    integrationDailyData: 0,
    locationSignals: 0,
    summaryGenerationEvents: 0,
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
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const effective = await resolveEffectiveRetentionPolicies(ctx);
    return summarizePolicies(effective).map((policy) => ({
      ...policy,
      source: effective[policy.key].source,
      updatedAt: effective[policy.key].updatedAt,
    }));
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
