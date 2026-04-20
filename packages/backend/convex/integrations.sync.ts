import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  asOAuthRefreshProvider,
  assertIntegrationProvider,
} from "./integrationProviders";
import { getRequiredIntegrationPlugin } from "./integrationPlugins";
import { deriveTokenValidityStatus } from "./integrationHealth";
import { captureException, logInfo } from "./observability";
import { validateDayKey } from "./validators";
import { getResolvedTimeZone, resolveTimeZone } from "../../ui/lib/day-window";
import {
  isAccessTokenNearExpiry,
  isOpaqueTokenRef,
  refreshOAuthAccessTokenWithRetry,
} from "./integrations.auth";
import {
  ProviderRequestError,
  syncDerivedAppleCalendarForDay,
  syncProviderForDay,
} from "./integrations.providers";
import {
  recordIntegrationHealthEvent,
  sanitizeSyncError,
} from "./integrations.health";
import type { NormalizedIntegrationDailySync } from "./providerAdapters";

export async function syncMyIntegrationForDayImpl(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  args: {
    provider: string;
    dayKey: string;
    timeZone?: string;
  },
) {
  validateDayKey(args.dayKey);
  const provider = assertIntegrationProvider(args.provider);
  const plugin = getRequiredIntegrationPlugin(provider);
  const syncTimeZone = resolveTimeZone(args.timeZone, getResolvedTimeZone());

  logInfo("integration_sync.started", {
    status: "started",
    provider,
    syncMode: plugin.syncMode,
    dayKey: args.dayKey,
    timeZone: syncTimeZone,
  });

  const integration = (await ctx.runQuery(
    api.integrations.getIntegrationByProvider,
    {
      provider,
    },
  )) as {
    _id: Id<"integrations">;
    userId: Id<"user">;
    tokenRef?: string;
    status: "connected" | "disconnected" | "error";
  } | null;

  if (!integration) {
    throw new Error(
      `Provider "${provider}" is not connected for this account.`,
    );
  }
  if (integration.status === "disconnected") {
    throw new Error(`Provider "${provider}" is disconnected.`);
  }

  const syncRunState = (await ctx.runMutation(
    internal.integrations.beginIntegrationSyncRunInternal,
    {
      userId: integration.userId,
      provider,
      dayKey: args.dayKey,
    },
  )) as {
    shouldSync: boolean;
    reason: "ready" | "already_synced" | "already_running";
  };

  if (!syncRunState.shouldSync) {
    await recordIntegrationHealthEvent(ctx, {
      provider,
      userId: integration.userId,
      integrationId: integration._id,
      dayKey: args.dayKey,
      outcome: "skipped",
      tokenValidityStatus: "unknown",
      error: `Sync skipped (${syncRunState.reason})`,
    });

    logInfo("integration_sync.skipped", {
      status: "skipped",
      provider,
      dayKey: args.dayKey,
      userId: integration.userId,
      reason: syncRunState.reason,
    });

    return {
      success: true,
      provider,
      dayKey: args.dayKey,
      idempotent: true,
      skippedReason: syncRunState.reason,
    };
  }

  const syncStartedAt = Date.now();
  const oauthRefreshProvider = asOAuthRefreshProvider(provider);
  let latestTokenValidityStatus = deriveTokenValidityStatus(undefined);

  try {
    let currentTokenRef = integration.tokenRef ?? "";
    let accessToken = "";
    let refreshToken: string | undefined;
    let accessTokenExpiresAt: number | undefined;

    if (plugin.requiresStoredToken) {
      if (!integration.tokenRef) {
        throw new Error(
          `Provider "${provider}" is missing tokenRef. Reconnect integration before syncing.`,
        );
      }

      currentTokenRef = integration.tokenRef;
      if (!isOpaqueTokenRef(integration.tokenRef)) {
        throw new Error(
          `Provider "${provider}" has an unsafe legacy token reference. Run token hardening migration and reconnect this integration before syncing.`,
        );
      }

      const secret = (await ctx.runQuery(
        internal.integrations.getIntegrationAccessTokenByRefInternal,
        {
          tokenRef: integration.tokenRef,
          userId: integration.userId,
          provider,
        },
      )) as {
        accessToken: string;
        refreshToken?: string;
        accessTokenExpiresAt?: number;
        needsKeyRotation?: boolean;
      } | null;

      if (!secret?.accessToken) {
        throw new Error(
          `Provider "${provider}" secret not found. Reconnect integration before syncing.`,
        );
      }

      accessToken = secret.accessToken;
      refreshToken = secret.refreshToken;
      accessTokenExpiresAt = secret.accessTokenExpiresAt;
      latestTokenValidityStatus =
        deriveTokenValidityStatus(accessTokenExpiresAt);

      if (secret.needsKeyRotation) {
        currentTokenRef = await ctx.runMutation(
          internal.integrations.storeIntegrationSecretInternal,
          {
            userId: integration.userId,
            provider,
            accessToken,
            refreshToken,
            accessTokenExpiresAt,
            existingTokenRef: currentTokenRef,
          },
        );
      }
    }

    if (
      plugin.requiresStoredToken &&
      oauthRefreshProvider &&
      isAccessTokenNearExpiry(accessTokenExpiresAt)
    ) {
      if (!refreshToken) {
        throw new Error(
          `Provider "${provider}" access token has expired and no refresh token is available. Reconnect integration.`,
        );
      }

      const refreshed = await refreshOAuthAccessTokenWithRetry(
        oauthRefreshProvider,
        refreshToken,
      );

      const nextRefreshToken = refreshed.refreshToken ?? refreshToken;

      currentTokenRef = await ctx.runMutation(
        internal.integrations.storeIntegrationSecretInternal,
        {
          userId: integration.userId,
          provider,
          accessToken: refreshed.accessToken,
          refreshToken: nextRefreshToken,
          accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
          lastRefreshAt: Date.now(),
          existingTokenRef: currentTokenRef,
        },
      );

      accessToken = refreshed.accessToken;
      refreshToken = nextRefreshToken;
      accessTokenExpiresAt = refreshed.accessTokenExpiresAt;
      latestTokenValidityStatus =
        deriveTokenValidityStatus(accessTokenExpiresAt);
    }

    let normalized: NormalizedIntegrationDailySync;

    if (plugin.syncMode === "derived_contextual_calendar") {
      normalized = await syncDerivedAppleCalendarForDay(ctx, args.dayKey);
    } else if (plugin.syncMode === "client_push") {
      throw new Error(
        `Provider "${provider}" sync is managed by device-side upload. Use the provider-specific client sync flow.`,
      );
    } else {
      try {
        normalized = await syncProviderForDay(
          provider,
          accessToken,
          args.dayKey,
          syncTimeZone,
          syncStartedAt,
        );
      } catch (error) {
        const shouldRetryAfterRefresh =
          plugin.requiresStoredToken &&
          !!oauthRefreshProvider &&
          !!refreshToken &&
          error instanceof ProviderRequestError &&
          error.status === 401;

        if (!shouldRetryAfterRefresh) {
          throw error;
        }

        if (!oauthRefreshProvider || !refreshToken) {
          throw error;
        }

        const refreshed = await refreshOAuthAccessTokenWithRetry(
          oauthRefreshProvider,
          refreshToken,
        );

        const nextRefreshToken = refreshed.refreshToken ?? refreshToken;
        await ctx.runMutation(
          internal.integrations.storeIntegrationSecretInternal,
          {
            userId: integration.userId,
            provider,
            accessToken: refreshed.accessToken,
            refreshToken: nextRefreshToken,
            accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
            lastRefreshAt: Date.now(),
            existingTokenRef: currentTokenRef,
          },
        );

        accessToken = refreshed.accessToken;
        refreshToken = nextRefreshToken;
        accessTokenExpiresAt = refreshed.accessTokenExpiresAt;
        latestTokenValidityStatus =
          deriveTokenValidityStatus(accessTokenExpiresAt);

        normalized = await syncProviderForDay(
          provider,
          accessToken,
          args.dayKey,
          syncTimeZone,
          syncStartedAt,
        );
      }
    }

    await ctx.runMutation(
      internal.integrations.upsertIntegrationDailyDataInternal,
      {
        userId: integration.userId,
        provider,
        dayKey: args.dayKey,
        metrics: normalized.metrics,
        summary: normalized.summary,
        signals: normalized.signals,
        context: normalized.context,
      },
    );

    await ctx.runMutation(api.integrations.recordSync, {
      integrationId: integration._id,
    });

    await ctx.runMutation(
      internal.integrations.completeIntegrationSyncRunInternal,
      {
        userId: integration.userId,
        provider,
        dayKey: args.dayKey,
        status: "success",
      },
    );

    await recordIntegrationHealthEvent(ctx, {
      provider,
      userId: integration.userId,
      integrationId: integration._id,
      dayKey: args.dayKey,
      outcome: "success",
      tokenValidityStatus: latestTokenValidityStatus,
      latencyMs: Date.now() - syncStartedAt,
    });

    logInfo("integration_sync.succeeded", {
      status: "succeeded",
      provider,
      dayKey: args.dayKey,
      userId: integration.userId,
      durationMs: Date.now() - syncStartedAt,
      tokenValidityStatus: latestTokenValidityStatus,
    });

    return {
      success: true,
      provider,
      dayKey: args.dayKey,
    };
  } catch (error) {
    const message = sanitizeSyncError(error);

    await ctx.runMutation(api.integrations.markIntegrationError, {
      integrationId: integration._id,
      reason: message,
    });

    await ctx.runMutation(
      internal.integrations.completeIntegrationSyncRunInternal,
      {
        userId: integration.userId,
        provider,
        dayKey: args.dayKey,
        status: "error",
        lastError: message,
      },
    );

    await recordIntegrationHealthEvent(ctx, {
      provider,
      userId: integration.userId,
      integrationId: integration._id,
      dayKey: args.dayKey,
      outcome: "error",
      tokenValidityStatus: latestTokenValidityStatus,
      error: message,
      latencyMs: Date.now() - syncStartedAt,
    });

    captureException("integration_sync.failed", error, {
      status: "failed",
      provider,
      dayKey: args.dayKey,
      userId: integration.userId,
      durationMs: Date.now() - syncStartedAt,
      tokenValidityStatus: latestTokenValidityStatus,
    });

    throw error;
  }
}
