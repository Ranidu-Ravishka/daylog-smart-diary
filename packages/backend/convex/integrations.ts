import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
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

const OPAQUE_TOKEN_REF_PREFIX = "tokref_";
const PROVIDER_SYNC_MAX_ATTEMPTS = 3;
const PROVIDER_SYNC_BASE_BACKOFF_MS = 300;
const PROVIDER_SYNC_TIMEOUT_MS = 8_000;
const PROVIDER_SYNC_TOTAL_BUDGET_MS = 20_000;
const SYNC_RUN_IN_PROGRESS_TTL_MS = 60_000;

class ProviderRequestError extends Error {
  status: number;
  retryable: boolean;

  constructor(status: number, message: string, retryable: boolean) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
    this.retryable = retryable;
  }
}

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

function isOpaqueTokenRef(value: string): boolean {
  return value.startsWith(OPAQUE_TOKEN_REF_PREFIX);
}

function createOpaqueTokenRef(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  return `${OPAQUE_TOKEN_REF_PREFIX}${uuid}`;
}

function isRetryableProviderStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderRequestError) return error.retryable;
  if (error instanceof TypeError) return true;
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  ) {
    return true;
  }
  return false;
}

function sanitizeSyncError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Provider sync failed";
  return message.slice(0, 220);
}

function jitteredBackoff(attempt: number): number {
  const base = PROVIDER_SYNC_BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 180);
  return base + jitter;
}

function remainingBudget(syncStartedAt: number): number {
  return PROVIDER_SYNC_TOTAL_BUDGET_MS - (Date.now() - syncStartedAt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertIntegrationSecret(
  db: {
    query: (table: "integrationSecrets") => {
      withIndex: (
        indexName: string,
        apply: (q: {
          eq: (field: string, value: unknown) => unknown;
        }) => unknown,
      ) => {
        collect: () => Promise<
          Array<{ _id: Id<"integrationSecrets">; tokenRef: string }>
        >;
        unique: () => Promise<{
          _id: Id<"integrationSecrets">;
          tokenRef: string;
        } | null>;
      };
    };
    patch: (
      id: Id<"integrationSecrets">,
      value: Record<string, unknown>,
    ) => Promise<void>;
    insert: (
      table: "integrationSecrets",
      value: Record<string, unknown>,
    ) => Promise<Id<"integrationSecrets">>;
    get: (id: Id<"integrationSecrets">) => Promise<{ tokenRef: string } | null>;
  },
  args: {
    userId: Id<"user">;
    provider: string;
    accessToken: string;
    existingTokenRef?: string;
  },
): Promise<string> {
  const now = Date.now();
  const tokenRef =
    args.existingTokenRef && isOpaqueTokenRef(args.existingTokenRef)
      ? args.existingTokenRef
      : createOpaqueTokenRef();

  const existing = await db
    .query("integrationSecrets")
    .withIndex("by_tokenRef", (q) => q.eq("tokenRef", tokenRef))
    .unique();

  if (existing) {
    await db.patch(existing._id, {
      userId: args.userId,
      provider: args.provider,
      accessToken: args.accessToken,
      updatedAt: now,
    });
    return tokenRef;
  }

  await db.insert("integrationSecrets", {
    userId: args.userId,
    provider: args.provider,
    tokenRef,
    accessToken: args.accessToken,
    createdAt: now,
    updatedAt: now,
  });

  return tokenRef;
}

async function deleteIntegrationSecretByRef(
  db: {
    query: (table: "integrationSecrets") => {
      withIndex: (
        indexName: string,
        apply: (q: {
          eq: (field: string, value: unknown) => unknown;
        }) => unknown,
      ) => {
        unique: () => Promise<{ _id: Id<"integrationSecrets"> } | null>;
      };
    };
    delete: (id: Id<"integrationSecrets">) => Promise<void>;
  },
  tokenRef: string | undefined,
): Promise<void> {
  if (!tokenRef || !isOpaqueTokenRef(tokenRef)) return;

  const secret = await db
    .query("integrationSecrets")
    .withIndex("by_tokenRef", (q) => q.eq("tokenRef", tokenRef))
    .unique();

  if (!secret) return;
  await db.delete(secret._id);
}

async function upsertIntegrationDailyDataDoc(
  db: unknown,
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
  const typedDb = db as {
    query: (table: "integrationDailyData") => {
      withIndex: (
        indexName: "by_user_provider_day",
        apply: (q: {
          eq: (
            field: string,
            value: unknown,
          ) => {
            eq: (
              field: string,
              value: unknown,
            ) => {
              eq: (field: string, value: unknown) => unknown;
            };
          };
        }) => unknown,
      ) => {
        unique: () => Promise<{ _id: Id<"integrationDailyData"> } | null>;
      };
    };
    patch: (
      id: Id<"integrationDailyData">,
      value: {
        metrics?: {
          steps?: number;
          sleepMinutes?: number;
          screenTimeMinutes?: number;
          spendingTotal?: number;
        };
        summary?: string;
        signals?: string[];
        syncedAt: number;
      },
    ) => Promise<void>;
    get: (id: Id<"integrationDailyData">) => Promise<unknown>;
    insert: (
      table: "integrationDailyData",
      value: {
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
        syncedAt: number;
      },
    ) => Promise<Id<"integrationDailyData">>;
  };

  const existing = await typedDb
    .query("integrationDailyData")
    .withIndex("by_user_provider_day", (q) =>
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
    await typedDb.patch(existing._id, payload);
    return await typedDb.get(existing._id);
  }

  const id = await typedDb.insert("integrationDailyData", {
    userId: args.userId,
    provider: args.provider,
    dayKey: args.dayKey,
    ...payload,
  });

  return await typedDb.get(id);
}

async function fetchJson<T>(
  url: string,
  accessToken: string,
  syncStartedAt: number,
  init?: RequestInit,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= PROVIDER_SYNC_MAX_ATTEMPTS; attempt++) {
    const budgetMs = remainingBudget(syncStartedAt);
    if (budgetMs <= 0) {
      throw new Error("Provider sync timed out before request could complete.");
    }

    const timeoutMs = Math.max(
      250,
      Math.min(PROVIDER_SYNC_TIMEOUT_MS, budgetMs),
    );
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...(init ?? {}),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ProviderRequestError(
          response.status,
          `Provider request failed (${response.status})`,
          isRetryableProviderStatus(response.status),
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      const shouldRetry =
        attempt < PROVIDER_SYNC_MAX_ATTEMPTS &&
        isRetryableProviderError(error) &&
        remainingBudget(syncStartedAt) > 0;

      if (!shouldRetry) {
        throw error;
      }

      const backoffMs = Math.min(
        jitteredBackoff(attempt),
        Math.max(50, remainingBudget(syncStartedAt) - 50),
      );
      await sleep(backoffMs);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Provider sync failed after retries.");
}

async function syncGoogleCalendarForDay(
  accessToken: string,
  dayKey: string,
  syncStartedAt: number,
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
    syncStartedAt,
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
  syncStartedAt: number,
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
    syncStartedAt,
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
  syncStartedAt: number,
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
    syncStartedAt,
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
  accessToken: string,
  dayKey: string,
  syncStartedAt: number,
): Promise<NormalizedIntegrationDailySync> {
  switch (provider) {
    case "google_calendar":
      return await syncGoogleCalendarForDay(accessToken, dayKey, syncStartedAt);
    case "spotify":
      return await syncSpotifyForDay(accessToken, dayKey, syncStartedAt);
    case "google_fit":
      return await syncGoogleFitForDay(accessToken, dayKey, syncStartedAt);
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

    const nextTokenRef = args.tokenRef
      ? await upsertIntegrationSecret(ctx.db as never, {
          userId: user._id,
          provider: args.provider,
          accessToken: args.tokenRef,
        })
      : undefined;

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
        tokenRef: nextTokenRef ?? existing.tokenRef,
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
      tokenRef: nextTokenRef,
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

    await deleteIntegrationSecretByRef(ctx.db as never, integration.tokenRef);

    return await ctx.db.get(args.integrationId);
  },
});

export const getIntegrationAccessTokenByRefInternal = internalQuery({
  args: {
    tokenRef: v.string(),
    userId: v.id("user"),
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    const secret = await ctx.db
      .query("integrationSecrets")
      .withIndex("by_tokenRef", (q) => q.eq("tokenRef", args.tokenRef))
      .unique();

    if (!secret) return null;
    if (secret.userId !== args.userId || secret.provider !== args.provider) {
      return null;
    }

    return { accessToken: secret.accessToken };
  },
});

export const storeIntegrationSecretInternal = internalMutation({
  args: {
    userId: v.id("user"),
    provider: v.string(),
    accessToken: v.string(),
    existingTokenRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await upsertIntegrationSecret(ctx.db as never, {
      userId: args.userId,
      provider: args.provider,
      accessToken: args.accessToken,
      existingTokenRef: args.existingTokenRef,
    });
  },
});

export const updateIntegrationTokenRefInternal = internalMutation({
  args: {
    integrationId: v.id("integrations"),
    tokenRef: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.integrationId, { tokenRef: args.tokenRef });
    return { success: true };
  },
});

export const beginIntegrationSyncRunInternal = internalMutation({
  args: {
    userId: v.id("user"),
    provider: v.string(),
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const existingRun = await ctx.db
      .query("integrationSyncRuns")
      .withIndex("by_user_provider_day", (q) =>
        q
          .eq("userId", args.userId)
          .eq("provider", args.provider)
          .eq("dayKey", args.dayKey),
      )
      .unique();

    const existingDailyData = await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_provider_day", (q) =>
        q
          .eq("userId", args.userId)
          .eq("provider", args.provider)
          .eq("dayKey", args.dayKey),
      )
      .unique();

    if (
      existingRun?.status === "in_progress" &&
      now - existingRun.updatedAt < SYNC_RUN_IN_PROGRESS_TTL_MS
    ) {
      return { shouldSync: false, reason: "already_running" as const };
    }

    if (existingRun?.status === "success" && existingDailyData) {
      return { shouldSync: false, reason: "already_synced" as const };
    }

    if (existingRun) {
      await ctx.db.patch(existingRun._id, {
        status: "in_progress",
        updatedAt: now,
        startedAt: now,
        lastError: undefined,
      });
    } else {
      await ctx.db.insert("integrationSyncRuns", {
        userId: args.userId,
        provider: args.provider,
        dayKey: args.dayKey,
        status: "in_progress",
        startedAt: now,
        updatedAt: now,
        lastError: undefined,
      });
    }

    return { shouldSync: true, reason: "ready" as const };
  },
});

export const completeIntegrationSyncRunInternal = internalMutation({
  args: {
    userId: v.id("user"),
    provider: v.string(),
    dayKey: v.string(),
    status: v.union(v.literal("success"), v.literal("error")),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existingRun = await ctx.db
      .query("integrationSyncRuns")
      .withIndex("by_user_provider_day", (q) =>
        q
          .eq("userId", args.userId)
          .eq("provider", args.provider)
          .eq("dayKey", args.dayKey),
      )
      .unique();

    const payload = {
      status: args.status,
      updatedAt: Date.now(),
      lastError: args.status === "error" ? args.lastError : undefined,
    };

    if (existingRun) {
      await ctx.db.patch(existingRun._id, payload);
      return { success: true };
    }

    await ctx.db.insert("integrationSyncRuns", {
      userId: args.userId,
      provider: args.provider,
      dayKey: args.dayKey,
      status: args.status,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      lastError: args.status === "error" ? args.lastError : undefined,
    });

    return { success: true };
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

    await deleteIntegrationSecretByRef(ctx.db as never, integration.tokenRef);

    const syncRuns = await ctx.db
      .query("integrationSyncRuns")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", integration.userId).eq("provider", integration.provider),
      )
      .collect();
    for (const run of syncRuns) {
      await ctx.db.delete(run._id);
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

    const syncRunState = (await ctx.runMutation(
      internal.integrations.beginIntegrationSyncRunInternal,
      {
        userId: integration.userId,
        provider: args.provider,
        dayKey: args.dayKey,
      },
    )) as {
      shouldSync: boolean;
      reason: "ready" | "already_synced" | "already_running";
    };

    if (!syncRunState.shouldSync) {
      return {
        success: true,
        provider: args.provider,
        dayKey: args.dayKey,
        idempotent: true,
        skippedReason: syncRunState.reason,
      };
    }

    const syncStartedAt = Date.now();

    try {
      if (!integration.tokenRef) {
        throw new Error(
          `Provider "${args.provider}" is missing tokenRef. Reconnect integration before syncing.`,
        );
      }

      let accessToken = integration.tokenRef;
      if (isOpaqueTokenRef(integration.tokenRef)) {
        const secret = (await ctx.runQuery(
          internal.integrations.getIntegrationAccessTokenByRefInternal,
          {
            tokenRef: integration.tokenRef,
            userId: integration.userId,
            provider: args.provider,
          },
        )) as { accessToken: string } | null;

        if (!secret?.accessToken) {
          throw new Error(
            `Provider "${args.provider}" secret not found. Reconnect integration before syncing.`,
          );
        }

        accessToken = secret.accessToken;
      } else {
        const migratedTokenRef = await ctx.runMutation(
          internal.integrations.storeIntegrationSecretInternal,
          {
            userId: integration.userId,
            provider: args.provider,
            accessToken: integration.tokenRef,
          },
        );

        await ctx.runMutation(
          internal.integrations.updateIntegrationTokenRefInternal,
          {
            integrationId: integration._id,
            tokenRef: migratedTokenRef,
          },
        );
      }

      const normalized = await syncProviderForDay(
        args.provider,
        accessToken,
        args.dayKey,
        syncStartedAt,
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

      await ctx.runMutation(
        internal.integrations.completeIntegrationSyncRunInternal,
        {
          userId: integration.userId,
          provider: args.provider,
          dayKey: args.dayKey,
          status: "success",
        },
      );

      return {
        success: true,
        provider: args.provider,
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
          provider: args.provider,
          dayKey: args.dayKey,
          status: "error",
          lastError: message,
        },
      );

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
