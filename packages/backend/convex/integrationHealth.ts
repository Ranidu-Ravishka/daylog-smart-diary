import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { assertIntegrationProvider } from "./integrationProviders";
import { requireAdmin, requireUser } from "./authz";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { validateDayKey } from "./validators";

const RECENT_OUTCOME_WINDOW = 50;
const MAX_RECENT_FAILURES = 20;

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
    return await recordIntegrationHealthEventInDb(ctx.db, args);
  },
});

export const listIntegrationProviderHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    return await ctx.db
      .query("integrationProviderHealth")
      .withIndex("by_status_updatedAt")
      .order("desc")
      .collect();
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
      .collect();

    return await Promise.all(
      integrations.map(async (integration) => {
        const health = await ctx.db
          .query("integrationProviderHealth")
          .withIndex("by_provider", (q) =>
            q.eq("provider", integration.provider),
          )
          .unique();

        return {
          provider: integration.provider,
          integrationStatus: integration.status,
          integrationLastSyncAt: integration.lastSyncAt,
          integrationLastError: integration.lastError,
          health,
        };
      }),
    );
  },
});
