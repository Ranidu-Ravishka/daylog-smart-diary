import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { requireUser, requireOwnership } from "./authz";
import { validateDayKey } from "./validators";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const SUPPORTED_INTEGRATION_PROVIDERS = [
  "google_calendar",
  "google_fit",
  "spotify",
  "apple_health",
] as const;

type SupportedIntegrationProvider =
  (typeof SUPPORTED_INTEGRATION_PROVIDERS)[number];

type NormalizedIntegrationDailySync = {
  metrics?: {
    steps?: number;
    sleepMinutes?: number;
    screenTimeMinutes?: number;
    spendingTotal?: number;
  };
  summary?: string;
  signals?: string[];
};

function isSupportedProvider(
  provider: string,
): provider is SupportedIntegrationProvider {
  return SUPPORTED_INTEGRATION_PROVIDERS.includes(
    provider as SupportedIntegrationProvider,
  );
}

function getUtcDayRange(dayKey: string) {
  const start = new Date(`${dayKey}T00:00:00.000Z`).getTime();
  const end = new Date(`${dayKey}T23:59:59.999Z`).getTime();
  return { start, end };
}

function sanitizeSignals(signals: string[] | undefined) {
  return (signals ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

async function upsertIntegrationDailyDataDoc(
  db: any,
  args: {
    userId: Id<"user">;
    provider: string;
    dayKey: string;
    metrics?: {
      steps?: number;
      sleepMinutes?: number;
      screenTimeMinutes?: number;
      spendingTotal?: number;
    };
    summary?: string;
    signals?: string[];
  },
) {
  const existing = await db
    .query("integrationDailyData")
    .withIndex("by_user_provider_day", (q: any) =>
      q
        .eq("userId", args.userId)
        .eq("provider", args.provider)
        .eq("dayKey", args.dayKey),
    )
    .unique();

  const payload = {
    metrics: args.metrics,
    summary: args.summary,
    signals: sanitizeSignals(args.signals),
    syncedAt: Date.now(),
  };

  if (existing) {
    await db.patch(existing._id, payload);
    return await db.get(existing._id);
  }

  const id = await db.insert("integrationDailyData", {
    userId: args.userId,
    provider: args.provider,
    dayKey: args.dayKey,
    ...payload,
  });

  return await db.get(id);
}

async function fetchJson<T>(
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...(init ?? {}),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Provider request failed (${response.status}): ${body.slice(0, 220)}`,
    );
  }

  return (await response.json()) as T;
}

async function syncGoogleCalendarForDay(
  accessToken: string,
  dayKey: string,
): Promise<NormalizedIntegrationDailySync> {
  const { start, end } = getUtcDayRange(dayKey);

  const result = await fetchJson<{
    items?: Array<{
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(new Date(start).toISOString())}&timeMax=${encodeURIComponent(new Date(end).toISOString())}&maxResults=100`,
    accessToken,
  );

  const events = result.items ?? [];
  let busyMinutes = 0;

  for (const event of events) {
    const from = event.start?.dateTime
      ? new Date(event.start.dateTime).getTime()
      : null;
    const to = event.end?.dateTime
      ? new Date(event.end.dateTime).getTime()
      : null;
    if (!from || !to || Number.isNaN(from) || Number.isNaN(to) || to <= from) {
      continue;
    }
    busyMinutes += Math.round((to - from) / 60000);
  }

  const topEventTitles = events
    .map((event) => event.summary?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 5);

  return {
    summary:
      events.length > 0
        ? `Google Calendar: ${events.length} events, ~${busyMinutes} busy minutes.`
        : "Google Calendar: no events for this day.",
    signals: sanitizeSignals([
      events.length > 0
        ? `${events.length} calendar events`
        : "No calendar events",
      busyMinutes > 0 ? `${busyMinutes} busy minutes` : "No timed events",
      ...topEventTitles,
    ]),
  };
}

async function syncSpotifyForDay(
  accessToken: string,
  dayKey: string,
): Promise<NormalizedIntegrationDailySync> {
  const { start, end } = getUtcDayRange(dayKey);

  const result = await fetchJson<{
    items?: Array<{
      played_at?: string;
      track?: {
        name?: string;
        artists?: Array<{ name?: string }>;
      };
    }>;
  }>(
    `https://api.spotify.com/v1/me/player/recently-played?limit=50&after=${Math.max(start - 1, 0)}`,
    accessToken,
  );

  const plays = (result.items ?? []).filter((item) => {
    const playedAt = item.played_at ? new Date(item.played_at).getTime() : NaN;
    return Number.isFinite(playedAt) && playedAt >= start && playedAt <= end;
  });

  const uniqueArtists = new Set<string>();
  for (const play of plays) {
    for (const artist of play.track?.artists ?? []) {
      if (artist.name?.trim()) uniqueArtists.add(artist.name.trim());
    }
  }

  const topTracks = plays
    .map((play) => play.track?.name?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, 5);

  return {
    summary:
      plays.length > 0
        ? `Spotify: ${plays.length} recent plays from ${uniqueArtists.size} artist(s).`
        : "Spotify: no recent playback for this day.",
    signals: sanitizeSignals([
      plays.length > 0 ? `${plays.length} tracks played` : "No track playback",
      uniqueArtists.size > 0
        ? `${uniqueArtists.size} unique artists`
        : "No artist activity",
      ...topTracks,
    ]),
  };
}

async function syncGoogleFitForDay(
  accessToken: string,
  dayKey: string,
): Promise<NormalizedIntegrationDailySync> {
  const { start, end } = getUtcDayRange(dayKey);

  const aggregateResponse = await fetchJson<{
    bucket?: Array<{
      dataset?: Array<{
        point?: Array<{
          startTimeNanos?: string;
          endTimeNanos?: string;
          value?: Array<{ intVal?: number }>;
          dataTypeName?: string;
        }>;
      }>;
    }>;
  }>(
    "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate",
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        aggregateBy: [
          { dataTypeName: "com.google.step_count.delta" },
          { dataTypeName: "com.google.sleep.segment" },
        ],
        bucketByTime: { durationMillis: 86_400_000 },
        startTimeMillis: start,
        endTimeMillis: end,
      }),
    },
  );

  const points = (aggregateResponse.bucket ?? []).flatMap((bucket) =>
    (bucket.dataset ?? []).flatMap((dataset) => dataset.point ?? []),
  );

  const steps = points.reduce((acc, point) => {
    const value = point.value?.[0]?.intVal;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return acc + value;
    }
    return acc;
  }, 0);

  const sleepMinutes = points.reduce((acc, point) => {
    const startNanos = Number(point.startTimeNanos ?? 0);
    const endNanos = Number(point.endTimeNanos ?? 0);
    if (!Number.isFinite(startNanos) || !Number.isFinite(endNanos)) return acc;
    if (endNanos <= startNanos) return acc;
    return acc + Math.round((endNanos - startNanos) / 1_000_000_000 / 60);
  }, 0);

  return {
    metrics: {
      steps: steps > 0 ? steps : undefined,
      sleepMinutes: sleepMinutes > 0 ? sleepMinutes : undefined,
    },
    summary:
      steps > 0 || sleepMinutes > 0
        ? `Google Fit: ${steps.toLocaleString()} steps, ${sleepMinutes} sleep minutes.`
        : "Google Fit: no measurable activity for this day.",
    signals: sanitizeSignals([
      steps > 0 ? `${steps.toLocaleString()} steps` : "No step count",
      sleepMinutes > 0 ? `${sleepMinutes} sleep minutes` : "No sleep segments",
    ]),
  };
}

async function syncProviderForDay(
  provider: SupportedIntegrationProvider,
  tokenRef: string,
  dayKey: string,
): Promise<NormalizedIntegrationDailySync> {
  switch (provider) {
    case "google_calendar":
      return await syncGoogleCalendarForDay(tokenRef, dayKey);
    case "spotify":
      return await syncSpotifyForDay(tokenRef, dayKey);
    case "google_fit":
      return await syncGoogleFitForDay(tokenRef, dayKey);
    case "apple_health":
      throw new Error(
        "Apple Health sync requires client-device upload. Use syncAppleHealthDailyData from mobile.",
      );
    default:
      throw new Error("Unsupported provider");
  }
}

// ── Connect a new integration ───────────────────────────────
export const connectIntegration = mutation({
  args: {
    provider: v.string(),
    scopes: v.optional(v.array(v.string())),
    tokenRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    // Check if this provider is already connected
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", args.provider),
      )
      .unique();

    if (existing) {
      // Re-connect / update
      await ctx.db.patch(existing._id, {
        status: "connected" as const,
        lastError: undefined,
        scopes: args.scopes,
        tokenRef: args.tokenRef,
        lastSyncAt: Date.now(),
      });

      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("integrations", {
      userId: user._id,
      provider: args.provider,
      status: "connected",
      lastError: undefined,
      scopes: args.scopes,
      tokenRef: args.tokenRef,
      lastSyncAt: Date.now(),
    });

    return await ctx.db.get(id);
  },
});

// ── Disconnect an integration ───────────────────────────────
export const disconnectIntegration = mutation({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const integration = await ctx.db.get(args.integrationId);

    if (!integration) {
      throw new Error("Integration not found");
    }

    requireOwnership(user, integration.userId);

    await ctx.db.patch(args.integrationId, {
      status: "disconnected" as const,
      lastError: undefined,
      tokenRef: undefined,
    });

    return await ctx.db.get(args.integrationId);
  },
});

// ── Mark an integration as errored ──────────────────────────
export const markIntegrationError = mutation({
  args: {
    integrationId: v.id("integrations"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const integration = await ctx.db.get(args.integrationId);

    if (!integration) {
      throw new Error("Integration not found");
    }

    requireOwnership(user, integration.userId);

    await ctx.db.patch(args.integrationId, {
      status: "error" as const,
      lastError: args.reason,
    });

    return await ctx.db.get(args.integrationId);
  },
});

// ── Record a successful sync timestamp ──────────────────────
export const recordSync = mutation({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const integration = await ctx.db.get(args.integrationId);

    if (!integration) {
      throw new Error("Integration not found");
    }

    requireOwnership(user, integration.userId);

    await ctx.db.patch(args.integrationId, {
      status: "connected" as const,
      lastError: undefined,
      lastSyncAt: Date.now(),
    });

    return await ctx.db.get(args.integrationId);
  },
});

// ── Get a specific integration by provider ──────────────────
export const getIntegrationByProvider = query({
  args: { provider: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    return await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", args.provider),
      )
      .unique();
  },
});

// ── List all integrations for the current user ──────────────
export const listMyIntegrations = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    return await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) => q.eq("userId", user._id))
      .collect();
  },
});

// ── Delete an integration entirely ──────────────────────────
export const deleteIntegration = mutation({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const integration = await ctx.db.get(args.integrationId);

    if (!integration) {
      throw new Error("Integration not found");
    }

    requireOwnership(user, integration.userId);

    const linkedDailyRows = await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", integration.userId).eq("provider", integration.provider),
      )
      .collect();

    for (const row of linkedDailyRows) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.delete(args.integrationId);
    return { success: true };
  },
});

export const listSupportedProviders = query({
  args: {},
  handler: async () => {
    return [...SUPPORTED_INTEGRATION_PROVIDERS];
  },
});

export const listMyIntegrationDailyDataForDay = query({
  args: { dayKey: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);

    return await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .collect();
  },
});

export const upsertMyIntegrationDailyData = mutation({
  args: {
    provider: v.string(),
    dayKey: v.string(),
    metrics: v.optional(
      v.object({
        steps: v.optional(v.number()),
        sleepMinutes: v.optional(v.number()),
        screenTimeMinutes: v.optional(v.number()),
        spendingTotal: v.optional(v.number()),
      }),
    ),
    summary: v.optional(v.string()),
    signals: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);

    return await upsertIntegrationDailyDataDoc(ctx.db, {
      userId: user._id,
      provider: args.provider,
      dayKey: args.dayKey,
      metrics: args.metrics,
      summary: args.summary,
      signals: args.signals,
    });
  },
});

export const syncAppleHealthDailyData = mutation({
  args: {
    dayKey: v.string(),
    metrics: v.object({
      steps: v.optional(v.number()),
      sleepMinutes: v.optional(v.number()),
      screenTimeMinutes: v.optional(v.number()),
      spendingTotal: v.optional(v.number()),
    }),
    summary: v.optional(v.string()),
    signals: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);

    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", "apple_health"),
      )
      .unique();

    if (!integration) {
      throw new Error(
        "Apple Health integration is not connected. Connect provider before syncing data.",
      );
    }

    const upserted = await upsertIntegrationDailyDataDoc(ctx.db, {
      userId: user._id,
      provider: "apple_health",
      dayKey: args.dayKey,
      metrics: args.metrics,
      summary:
        args.summary ??
        `Apple Health: ${args.metrics.steps ?? 0} steps, ${args.metrics.sleepMinutes ?? 0} sleep minutes.`,
      signals: args.signals,
    });

    await ctx.db.patch(integration._id, {
      status: "connected",
      lastError: undefined,
      lastSyncAt: Date.now(),
    });

    return upserted;
  },
});

export const upsertIntegrationDailyDataInternal = internalMutation({
  args: {
    userId: v.id("user"),
    provider: v.string(),
    dayKey: v.string(),
    metrics: v.optional(
      v.object({
        steps: v.optional(v.number()),
        sleepMinutes: v.optional(v.number()),
        screenTimeMinutes: v.optional(v.number()),
        spendingTotal: v.optional(v.number()),
      }),
    ),
    summary: v.optional(v.string()),
    signals: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    validateDayKey(args.dayKey);

    return await upsertIntegrationDailyDataDoc(ctx.db, {
      userId: args.userId,
      provider: args.provider,
      dayKey: args.dayKey,
      metrics: args.metrics,
      summary: args.summary,
      signals: args.signals,
    });
  },
});

export const syncMyIntegrationForDay = action({
  args: {
    provider: v.string(),
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateDayKey(args.dayKey);

    if (!isSupportedProvider(args.provider)) {
      throw new Error(
        `Unsupported provider "${args.provider}". Supported providers: ${SUPPORTED_INTEGRATION_PROVIDERS.join(", ")}`,
      );
    }

    const integration = (await ctx.runQuery(
      api.integrations.getIntegrationByProvider,
      {
        provider: args.provider,
      },
    )) as {
      _id: Id<"integrations">;
      userId: Id<"user">;
      tokenRef?: string;
      status: "connected" | "disconnected" | "error";
    } | null;

    if (!integration) {
      throw new Error(
        `Provider "${args.provider}" is not connected for this account.`,
      );
    }
    if (integration.status === "disconnected") {
      throw new Error(`Provider "${args.provider}" is disconnected.`);
    }

    try {
      if (!integration.tokenRef) {
        throw new Error(
          `Provider "${args.provider}" is missing tokenRef. Reconnect integration before syncing.`,
        );
      }

      const normalized = await syncProviderForDay(
        args.provider,
        integration.tokenRef,
        args.dayKey,
      );

      await ctx.runMutation(
        internal.integrations.upsertIntegrationDailyDataInternal,
        {
          userId: integration.userId,
          provider: args.provider,
          dayKey: args.dayKey,
          metrics: normalized.metrics,
          summary: normalized.summary,
          signals: normalized.signals,
        },
      );

      await ctx.runMutation(api.integrations.recordSync, {
        integrationId: integration._id,
      });

      return {
        success: true,
        provider: args.provider,
        dayKey: args.dayKey,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown integration sync error";

      await ctx.runMutation(api.integrations.markIntegrationError, {
        integrationId: integration._id,
        reason: message,
      });

      throw error;
    }
  },
});

export const syncAllMyIntegrationsForDay = action({
  args: {
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateDayKey(args.dayKey);

    const integrations = (await ctx.runQuery(
      api.integrations.listMyIntegrations,
      {},
    )) as Array<{
      provider: string;
      status: "connected" | "disconnected" | "error";
    }>;

    const results: Array<{
      provider: string;
      success: boolean;
      message?: string;
    }> = [];

    for (const integration of integrations) {
      if (!isSupportedProvider(integration.provider)) continue;
      if (integration.status !== "connected") continue;

      try {
        await ctx.runAction(api.integrations.syncMyIntegrationForDay, {
          provider: integration.provider,
          dayKey: args.dayKey,
        });
        results.push({ provider: integration.provider, success: true });
      } catch (error) {
        results.push({
          provider: integration.provider,
          success: false,
          message: error instanceof Error ? error.message : "Sync failed",
        });
      }
    }

    return {
      dayKey: args.dayKey,
      results,
    };
  },
});
