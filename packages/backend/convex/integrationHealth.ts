import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { assertIntegrationProvider } from "./integrationProviders";
import { getActiveUserById, requireAdmin, requireUser } from "./authz";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { validateDayKey } from "./validators";

const RECENT_OUTCOME_WINDOW = 50;
const MAX_RECENT_FAILURES = 20;
const DEFAULT_PROVIDER_HEALTH_LIMIT = 50;
const MAX_PROVIDER_HEALTH_LIMIT = 200;
const MAX_PROVIDER_HEALTH_SUMMARY_ROWS = 256;

export type IntegrationHealthStatus = "connected" | "degraded" | "failed";

export type TokenValidityStatus =
  | "valid"
  | "expiring_soon"
  | "expired"
  | "unknown";

function clampMessage(error: string | undefined): string | undefined {
  if (!error) return undefined;
  return error.slice(0, 220);
}

function toTokenValidityStatus(value: string | undefined): TokenValidityStatus {
  if (value === "valid") return "valid";
  if (value === "expiring_soon") return "expiring_soon";
  if (value === "expired") return "expired";
  return "unknown";
}

export function deriveTokenValidityStatus(
  accessTokenExpiresAt: number | undefined,
  now = Date.now(),
): TokenValidityStatus {
  if (
    typeof accessTokenExpiresAt !== "number" ||
    !Number.isFinite(accessTokenExpiresAt)
  ) {
    return "unknown";
  }

  if (accessTokenExpiresAt <= now) {
    return "expired";
  }

  const oneHour = 60 * 60 * 1000;
  if (accessTokenExpiresAt - now <= oneHour) {
    return "expiring_soon";
  }

  return "valid";
}

function deriveProviderStatus(args: {
  tokenValidityStatus: TokenValidityStatus;
  errorRate: number;
  hasRecentFailure: boolean;
}): IntegrationHealthStatus {
  if (args.tokenValidityStatus === "expired") {
    return "failed";
  }

  if (args.errorRate >= 0.5) {
    return "failed";
  }

  if (
    args.errorRate > 0 ||
    args.hasRecentFailure ||
    args.tokenValidityStatus === "expiring_soon" ||
    args.tokenValidityStatus === "unknown"
  ) {
    return "degraded";
  }

  return "connected";
}

type RecordIntegrationHealthEventArgs = {
  provider: string;
  userId?: Id<"user">;
  integrationId?: Id<"integrations">;
  dayKey?: string;
  outcome: "success" | "error" | "skipped";
  tokenValidityStatus?: string;
  error?: string;
  latencyMs?: number;
};

function normalizeOptionalDayKey(
  dayKey: string | undefined,
): string | undefined {
  if (!dayKey) return undefined;
  validateDayKey(dayKey);
  return dayKey;
}

function toListLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_PROVIDER_HEALTH_LIMIT;
  }

  const normalized = Math.floor(limit);
  if (normalized < 1) return 1;
  if (normalized > MAX_PROVIDER_HEALTH_LIMIT) return MAX_PROVIDER_HEALTH_LIMIT;
  return normalized;
}

function summarizeStatuses(
  rows: Array<{ status: IntegrationHealthStatus; updatedAt: number }>,
) {
  let connected = 0;
  let degraded = 0;
  let failed = 0;
  let updatedAt = 0;

  for (const row of rows) {
    if (row.status === "connected") connected += 1;
    if (row.status === "degraded") degraded += 1;
    if (row.status === "failed") failed += 1;
    if (row.updatedAt > updatedAt) updatedAt = row.updatedAt;
  }

  return {
    connected,
    degraded,
    failed,
    totalProviders: rows.length,
    updatedAt,
  };
}

export async function recordIntegrationHealthEventInDb(
  db: MutationCtx["db"],
  args: RecordIntegrationHealthEventArgs,
) {
  const provider = assertIntegrationProvider(args.provider);
  const normalizedDayKey = normalizeOptionalDayKey(args.dayKey);
  const now = Date.now();
  const tokenValidityStatus = toTokenValidityStatus(args.tokenValidityStatus);

  const existing = await db
    .query("integrationProviderHealth")
    .withIndex("by_provider", (q) => q.eq("provider", provider))
    .unique();

  const previousOutcomes = existing?.recentOutcomes ?? [];
  const nextOutcomes = [...previousOutcomes, args.outcome].slice(
    -RECENT_OUTCOME_WINDOW,
  );

  const attemptOutcomes = nextOutcomes.filter(
    (outcome) => outcome !== "skipped",
  );
  const failedOutcomes = attemptOutcomes.filter(
    (outcome) => outcome === "error",
  );

  const errorRate =
    attemptOutcomes.length > 0
      ? failedOutcomes.length / attemptOutcomes.length
      : 0;

  const recentFailures = [...(existing?.recentFailures ?? [])];
  const sanitizedError = clampMessage(args.error);

  if (args.outcome === "error") {
    recentFailures.push({
      at: now,
      error: sanitizedError ?? "Provider sync failed",
      dayKey: normalizedDayKey,
      userId: args.userId,
    });
  }

  const nextRecentFailures = recentFailures.slice(-MAX_RECENT_FAILURES);
  const status = deriveProviderStatus({
    tokenValidityStatus,
    errorRate,
    hasRecentFailure: args.outcome === "error",
  });

  const patch = {
    provider,
    status,
    tokenValidityStatus,
    lastSyncAt: args.outcome === "success" ? now : existing?.lastSyncAt,
    lastFailureAt: args.outcome === "error" ? now : existing?.lastFailureAt,
    totalSyncAttempts:
      (existing?.totalSyncAttempts ?? 0) + (args.outcome === "skipped" ? 0 : 1),
    failedSyncAttempts:
      (existing?.failedSyncAttempts ?? 0) + (args.outcome === "error" ? 1 : 0),
    errorRate,
    recentOutcomes: nextOutcomes,
    recentFailures: nextRecentFailures,
    updatedAt: now,
  };

  if (existing) {
    await db.patch(existing._id, patch);
  } else {
    await db.insert("integrationProviderHealth", patch);
  }

  await db.insert("integrationHealthEvents", {
    provider,
    userId: args.userId,
    integrationId: args.integrationId,
    dayKey: normalizedDayKey,
    outcome: args.outcome,
    status,
    tokenValidityStatus,
    error: sanitizedError,
    latencyMs: args.latencyMs,
    at: now,
  });

  if (args.outcome === "error") {
    await db.insert("platformAuditEvents", {
      category: "integration_health",
      action: "provider_sync_error",
      actorType: args.userId ? "user" : "system",
      actorUserId: args.userId,
      target: provider,
      details: sanitizedError,
      at: now,
    });
  }

  return {
    provider,
    status,
    errorRate,
    tokenValidityStatus,
    updatedAt: now,
  };
}

export const recordIntegrationHealthEventInternal = internalMutation({
  args: {
    provider: v.string(),
    userId: v.optional(v.id("user")),
    integrationId: v.optional(v.id("integrations")),
    dayKey: v.optional(v.string()),
    outcome: v.union(
      v.literal("success"),
      v.literal("error"),
      v.literal("skipped"),
    ),
    tokenValidityStatus: v.optional(v.string()),
    error: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (
      args.userId &&
      !(await getActiveUserById(ctx, args.userId))
    ) {
      throw new Error("Cannot record integration health for an inactive user");
    }

    return await recordIntegrationHealthEventInDb(ctx.db, args);
  },
});

export const listIntegrationProviderHealth = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("connected"),
        v.literal("degraded"),
        v.literal("failed"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = toListLimit(args.limit);

    if (args.status) {
      return await ctx.db
        .query("integrationProviderHealth")
        .withIndex("by_status_updatedAt", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("integrationProviderHealth")
      .withIndex("by_status_updatedAt")
      .order("desc")
      .take(limit);
  },
});

export const listIntegrationProviderHealthPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(
      v.union(
        v.literal("connected"),
        v.literal("degraded"),
        v.literal("failed"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    if (args.status) {
      return await ctx.db
        .query("integrationProviderHealth")
        .withIndex("by_status_updatedAt", (q) => q.eq("status", args.status!))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return await ctx.db
      .query("integrationProviderHealth")
      .withIndex("by_status_updatedAt")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getIntegrationHealthSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db
      .query("integrationProviderHealth")
      .withIndex("by_status_updatedAt")
      .order("desc")
      .take(MAX_PROVIDER_HEALTH_SUMMARY_ROWS);

    return summarizeStatuses(rows);
  },
});

export const listIntegrationHealthEventsForProvider = query({
  args: {
    provider: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const provider = assertIntegrationProvider(args.provider);

    return await ctx.db
      .query("integrationHealthEvents")
      .withIndex("by_provider_at", (q) => q.eq("provider", provider))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const listMyIntegrationHealth = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) => q.eq("userId", user._id))
      .take(MAX_PROVIDER_HEALTH_SUMMARY_ROWS);

    const recentUserEvents = await ctx.db
      .query("integrationHealthEvents")
      .withIndex("by_userId_at", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(MAX_PROVIDER_HEALTH_SUMMARY_ROWS);

    return integrations.map((integration) => {
      const providerEvents = recentUserEvents.filter(
        (event) => event.provider === integration.provider,
      );
      const mostRecentEvent = providerEvents[0];
      const hasRecentFailure = providerEvents.some(
        (event) => event.outcome === "error",
      );

      // `providerEvents` is sorted desc (newest first). UI/reliability logic
      // expects oldest→newest for `recentOutcomes[recentOutcomes.length - 1]`
      // to represent the *latest* outcome, so reverse once.
      const orderedEvents = [...providerEvents].reverse();
      const recentOutcomes = orderedEvents
        .slice(-RECENT_OUTCOME_WINDOW)
        .map((event) => event.outcome);
      const recentFailures = orderedEvents
        .filter((event) => event.outcome === "error")
        .slice(-MAX_RECENT_FAILURES)
        .map((event) => ({
          at: event.at,
          error: event.error ?? "Provider sync failed",
          dayKey: event.dayKey,
          userId: event.userId,
        }));

      const lastSuccessEvent = orderedEvents
        .slice()
        .reverse()
        .find((event) => event.outcome === "success");

      const health = {
        status:
          integration.status === "connected"
            ? hasRecentFailure
              ? ("degraded" as const)
              : ("connected" as const)
            : ("failed" as const),
        tokenValidityStatus: mostRecentEvent?.tokenValidityStatus ?? "unknown",
        lastOutcome: mostRecentEvent?.outcome,
        lastError: mostRecentEvent?.error,
        lastSyncAt: lastSuccessEvent?.at ?? integration.lastSyncAt,
        updatedAt: mostRecentEvent?.at ?? integration.lastSyncAt,
        recentOutcomes,
        recentFailures,
      };

      return {
        provider: integration.provider,
        integrationStatus: integration.status,
        integrationLastSyncAt: integration.lastSyncAt,
        integrationLastError: integration.lastError,
        health,
      };
    });
  },
});
