import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, internalMutation, query } from "./_generated/server";
import { requireAdmin } from "./authz";
import { captureException, logWarn } from "./observability";
import {
  getObservabilityIngestCorsDecision,
  type ObservabilityIngestAuthContext,
  verifyObservabilityIngestAuth,
} from "./observabilityIngestionSecurity";
import {
  fingerprintRateLimitKey,
  resolveObservabilityIngestRateLimitIdentity,
  type ObservabilityIngestRateLimitDecision,
} from "./observabilityIngestRateLimiter";

const MAX_PAYLOAD_BYTES = 24_000;
const MAX_EVENT_LENGTH = 120;
const MAX_CONTEXT_JSON_LENGTH = 4_000;
const MAX_ENVIRONMENT_LENGTH = 48;
const DEFAULT_TRANSPORT_HEALTH_WINDOW_HOURS = 24;
const MAX_TRANSPORT_HEALTH_WINDOW_HOURS = 24 * 14;
const MAX_TRANSPORT_HEALTH_ROWS = 5_000;
const MAX_TRANSPORT_HEALTH_TOP_EVENTS = 5;
const MAX_TRANSPORT_HEALTH_FILTER_LENGTH = 80;
const DEFAULT_RATE_LIMIT_METRICS_WINDOW_MINUTES = 60;
const MAX_RATE_LIMIT_METRICS_WINDOW_MINUTES = 24 * 60;
const MAX_RATE_LIMIT_METRICS_ROWS = 25_000;
const MAX_REPLAY_NONCE_LENGTH = 160;
const NONCE_SWEEP_BATCH_SIZE = 32;

const textEncoder = new TextEncoder();

type TransportHealthAccumulator = {
  ingestedCount: number;
  estimatedAttemptedCount: number;
  sampleRateTotal: number;
  lastReceivedAt: number | null;
};

type TopEventAccumulator = {
  ingestedCount: number;
  webCount: number;
  mobileCount: number;
  lastReceivedAt: number | null;
};

type ObservabilitySurface = "web" | "mobile";

type ObservabilityInfoEventPayloadInput = {
  schemaVersion?: unknown;
  app?: unknown;
  surface?: unknown;
  level?: unknown;
  event?: unknown;
  timestamp?: unknown;
  contextJson?: unknown;
  sampleRate?: unknown;
  sourceEnvironment?: unknown;
};

type ObservabilityInfoEventPayload = {
  schemaVersion: 1;
  app: "daylog";
  surface: ObservabilitySurface;
  level: "info";
  event: string;
  timestamp?: string;
  contextJson?: unknown;
  sampleRate?: unknown;
  sourceEnvironment?: unknown;
};

type ObservabilityInfoEventInsert = {
  app: "daylog";
  surface: ObservabilitySurface;
  level: "info";
  event: string;
  timestamp: string;
  emittedAt: number;
  receivedAt: number;
  sampleRate: number;
  sourceEnvironment?: string;
  contextJson?: string;
};

type ReplayNonceConsumeResult = {
  accepted: boolean;
  reason?: "replay";
};

function isObservabilityInfoEventPayloadInput(
  value: unknown,
): value is ObservabilityInfoEventPayloadInput {
  return typeof value === "object" && value !== null;
}

function isObservabilitySurface(value: unknown): value is ObservabilitySurface {
  return value === "web" || value === "mobile";
}

function toTransportHealthWindowHours(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TRANSPORT_HEALTH_WINDOW_HOURS;
  }

  const normalized = Math.floor(value);

  if (normalized < 1) {
    return 1;
  }

  if (normalized > MAX_TRANSPORT_HEALTH_WINDOW_HOURS) {
    return MAX_TRANSPORT_HEALTH_WINDOW_HOURS;
  }

  return normalized;
}

function toRateLimitMetricsWindowMinutes(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RATE_LIMIT_METRICS_WINDOW_MINUTES;
  }

  const normalized = Math.floor(value);

  if (normalized < 1) {
    return 1;
  }

  if (normalized > MAX_RATE_LIMIT_METRICS_WINDOW_MINUTES) {
    return MAX_RATE_LIMIT_METRICS_WINDOW_MINUTES;
  }

  return normalized;
}

function toNormalizedFilter(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.slice(0, MAX_TRANSPORT_HEALTH_FILTER_LENGTH);
}

function toEffectiveSampleRate(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  if (value <= 0) {
    return 1;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

function createTransportHealthAccumulator(): TransportHealthAccumulator {
  return {
    ingestedCount: 0,
    estimatedAttemptedCount: 0,
    sampleRateTotal: 0,
    lastReceivedAt: null,
  };
}

function createTopEventAccumulator(): TopEventAccumulator {
  return {
    ingestedCount: 0,
    webCount: 0,
    mobileCount: 0,
    lastReceivedAt: null,
  };
}

function accumulateTransportHealth(
  acc: TransportHealthAccumulator,
  row: { sampleRate: number; receivedAt: number },
): void {
  const effectiveSampleRate = toEffectiveSampleRate(row.sampleRate);

  acc.ingestedCount += 1;
  acc.sampleRateTotal += effectiveSampleRate;
  acc.estimatedAttemptedCount += 1 / effectiveSampleRate;

  if (acc.lastReceivedAt === null || row.receivedAt > acc.lastReceivedAt) {
    acc.lastReceivedAt = row.receivedAt;
  }
}

function finalizeTransportHealth(acc: TransportHealthAccumulator) {
  const estimatedDroppedCount = Math.max(
    acc.estimatedAttemptedCount - acc.ingestedCount,
    0,
  );

  const estimatedDropRate =
    acc.estimatedAttemptedCount > 0
      ? estimatedDroppedCount / acc.estimatedAttemptedCount
      : 0;

  return {
    ingestedCount: acc.ingestedCount,
    estimatedAttemptedCount: acc.estimatedAttemptedCount,
    estimatedDroppedCount,
    estimatedDropRate,
    averageSampleRate:
      acc.ingestedCount > 0 ? acc.sampleRateTotal / acc.ingestedCount : null,
    lastReceivedAt: acc.lastReceivedAt,
  };
}

function finalizeTopEventsByVolume(
  countsByEvent: Map<string, TopEventAccumulator>,
  totalIngestedCount: number,
) {
  return [...countsByEvent.entries()]
    .map(([event, acc]) => ({
      event,
      ingestedCount: acc.ingestedCount,
      webCount: acc.webCount,
      mobileCount: acc.mobileCount,
      lastReceivedAt: acc.lastReceivedAt,
      shareOfIngested:
        totalIngestedCount > 0 ? acc.ingestedCount / totalIngestedCount : 0,
    }))
    .sort((left, right) => {
      if (right.ingestedCount !== left.ingestedCount) {
        return right.ingestedCount - left.ingestedCount;
      }

      return (right.lastReceivedAt ?? 0) - (left.lastReceivedAt ?? 0);
    })
    .slice(0, MAX_TRANSPORT_HEALTH_TOP_EVENTS);
}

function jsonResponse(
  status: number,
  body: object,
  corsHeaders: Record<string, string>,
  extraHeaders?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      ...(extraHeaders ?? {}),
      "Content-Type": "application/json",
    },
  });
}

function toRequestContext(
  request: Request,
): Record<string, string | undefined> {
  const origin = request.headers.get("origin")?.trim();
  const userAgent = request.headers.get("user-agent")?.trim();

  return {
    method: request.method,
    origin: origin && origin.length > 0 ? origin : undefined,
    userAgent: userAgent && userAgent.length > 0 ? userAgent : undefined,
  };
}

function parseDeclaredContentLength(request: Request): number | null {
  const rawValue = request.headers.get("content-length")?.trim() ?? "";
  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.floor(parsed);
}

function toPayloadByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function toSafeSampleRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }

  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function toSafeContextJson(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.slice(0, MAX_CONTEXT_JSON_LENGTH);
}

function toSafeEnvironment(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.slice(0, MAX_ENVIRONMENT_LENGTH);
}

function toEmittedAt(
  timestamp: unknown,
  fallback: number,
): {
  emittedAt: number;
  timestamp: string;
} {
  if (typeof timestamp !== "string") {
    return {
      emittedAt: fallback,
      timestamp: new Date(fallback).toISOString(),
    };
  }

  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return {
      emittedAt: fallback,
      timestamp: new Date(fallback).toISOString(),
    };
  }

  return {
    emittedAt: parsed,
    timestamp,
  };
}

export const insertObservabilityInfoEventInternal = internalMutation({
  args: {
    app: v.literal("daylog"),
    surface: v.union(v.literal("web"), v.literal("mobile")),
    level: v.literal("info"),
    event: v.string(),
    timestamp: v.string(),
    emittedAt: v.number(),
    receivedAt: v.number(),
    sampleRate: v.number(),
    sourceEnvironment: v.optional(v.string()),
    contextJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row: ObservabilityInfoEventInsert = {
      app: args.app,
      surface: args.surface,
      level: args.level,
      event: args.event,
      timestamp: args.timestamp,
      emittedAt: args.emittedAt,
      receivedAt: args.receivedAt,
      sampleRate: args.sampleRate,
      sourceEnvironment: args.sourceEnvironment,
      contextJson: args.contextJson,
    };

    return await ctx.db.insert("observabilityInfoEvents", row);
  },
});

export const consumeObservabilityIngestNonceInternal = internalMutation({
  args: {
    nonce: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    issuedAtSeconds: v.number(),
    expiresAtSeconds: v.number(),
    consumedAt: v.number(),
  },
  handler: async (ctx, args): Promise<ReplayNonceConsumeResult> => {
    const nonce = args.nonce.trim().slice(0, MAX_REPLAY_NONCE_LENGTH);
    if (!nonce) {
      return {
        accepted: false,
        reason: "replay",
      };
    }

    const existing = await ctx.db
      .query("observabilityIngestNonces")
      .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
      .unique();

    if (existing) {
      return {
        accepted: false,
        reason: "replay",
      };
    }

    const expiredRows = await ctx.db
      .query("observabilityIngestNonces")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", args.consumedAt))
      .order("asc")
      .take(NONCE_SWEEP_BATCH_SIZE);

    await Promise.all(expiredRows.map((row) => ctx.db.delete(row._id)));

    await ctx.db.insert("observabilityIngestNonces", {
      nonce,
      userId: args.userId,
      sessionId: args.sessionId,
      issuedAtSeconds: args.issuedAtSeconds,
      expiresAt: args.expiresAtSeconds * 1000,
      consumedAt: args.consumedAt,
      createdAt: args.consumedAt,
    });

    return {
      accepted: true,
    };
  },
});

export const listObservabilityInfoEventsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    surface: v.optional(v.union(v.literal("web"), v.literal("mobile"))),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const surface = args.surface;
    if (isObservabilitySurface(surface)) {
      return await ctx.db
        .query("observabilityInfoEvents")
        .withIndex("by_surface_receivedAt", (q) => q.eq("surface", surface))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return await ctx.db
      .query("observabilityInfoEvents")
      .withIndex("by_receivedAt")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getObservabilityInfoTransportHealth = query({
  args: {
    windowHours: v.optional(v.number()),
    eventName: v.optional(v.string()),
    sourceEnvironment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const windowHours = toTransportHealthWindowHours(args.windowHours);
    const normalizedEventName = toNormalizedFilter(args.eventName);
    const normalizedSourceEnvironment = toNormalizedFilter(
      args.sourceEnvironment,
    );

    const now = Date.now();
    const windowStartAt = now - windowHours * 60 * 60 * 1000;

    const rows = await ctx.db
      .query("observabilityInfoEvents")
      .withIndex("by_receivedAt", (q) => q.gte("receivedAt", windowStartAt))
      .order("desc")
      .take(MAX_TRANSPORT_HEALTH_ROWS);

    const overall = createTransportHealthAccumulator();
    const web = createTransportHealthAccumulator();
    const mobile = createTransportHealthAccumulator();
    const topEventsByName = new Map<string, TopEventAccumulator>();

    for (const row of rows) {
      if (
        normalizedEventName &&
        !row.event.toLowerCase().includes(normalizedEventName)
      ) {
        continue;
      }

      if (normalizedSourceEnvironment) {
        const rowEnvironment = row.sourceEnvironment?.toLowerCase() ?? "";
        if (rowEnvironment !== normalizedSourceEnvironment) {
          continue;
        }
      }

      accumulateTransportHealth(overall, row);

      if (row.surface === "web") {
        accumulateTransportHealth(web, row);
      } else {
        accumulateTransportHealth(mobile, row);
      }

      const existing =
        topEventsByName.get(row.event) ?? createTopEventAccumulator();
      existing.ingestedCount += 1;
      if (row.surface === "web") {
        existing.webCount += 1;
      } else {
        existing.mobileCount += 1;
      }

      if (
        existing.lastReceivedAt === null ||
        row.receivedAt > existing.lastReceivedAt
      ) {
        existing.lastReceivedAt = row.receivedAt;
      }

      topEventsByName.set(row.event, existing);
    }

    const overallSummary = finalizeTransportHealth(overall);

    return {
      windowHours,
      windowStartAt,
      evaluatedRows: rows.length,
      truncated: rows.length >= MAX_TRANSPORT_HEALTH_ROWS,
      filters: {
        eventName: normalizedEventName ?? null,
        sourceEnvironment: normalizedSourceEnvironment ?? null,
      },
      overall: overallSummary,
      bySurface: {
        web: finalizeTransportHealth(web),
        mobile: finalizeTransportHealth(mobile),
      },
      topEvents: finalizeTopEventsByVolume(
        topEventsByName,
        overallSummary.ingestedCount,
      ),
    };
  },
});

export const getObservabilityIngestRateLimitMetrics = query({
  args: {
    windowMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const windowMinutes = toRateLimitMetricsWindowMinutes(args.windowMinutes);
    const nowMinute = Math.floor(Date.now() / 60_000);
    const windowStartMinute = nowMinute - windowMinutes + 1;

    const rows = await ctx.db
      .query("observabilityIngestRateLimitMetrics")
      .withIndex("by_epochMinute", (q) =>
        q.gte("epochMinute", windowStartMinute),
      )
      .order("desc")
      .take(MAX_RATE_LIMIT_METRICS_ROWS);

    let allowedRequests = 0;
    let blockedRequests = 0;
    let burstAttempts = 0;

    const perMinute = new Map<
      number,
      {
        allowedRequests: number;
        blockedRequests: number;
        burstAttempts: number;
      }
    >();

    for (const row of rows) {
      if (row.epochMinute > nowMinute) {
        continue;
      }

      if (row.epochMinute < windowStartMinute) {
        continue;
      }

      allowedRequests += row.allowedRequests;
      blockedRequests += row.blockedRequests;
      burstAttempts += row.burstAttempts;

      const minute = perMinute.get(row.epochMinute) ?? {
        allowedRequests: 0,
        blockedRequests: 0,
        burstAttempts: 0,
      };

      minute.allowedRequests += row.allowedRequests;
      minute.blockedRequests += row.blockedRequests;
      minute.burstAttempts += row.burstAttempts;
      perMinute.set(row.epochMinute, minute);
    }

    const minuteBuckets = [...perMinute.entries()]
      .sort(([leftMinute], [rightMinute]) => leftMinute - rightMinute)
      .map(([epochMinute, metrics]) => ({
        epochMinute,
        allowedRequests: metrics.allowedRequests,
        blockedRequests: metrics.blockedRequests,
        burstAttempts: metrics.burstAttempts,
      }));

    const totalRequests = allowedRequests + blockedRequests;

    return {
      windowMinutes,
      windowStartMinute,
      nowMinute,
      evaluatedRows: rows.length,
      truncated: rows.length >= MAX_RATE_LIMIT_METRICS_ROWS,
      totals: {
        totalRequests,
        allowedRequests,
        blockedRequests,
        burstAttempts,
        blockedRate: totalRequests > 0 ? blockedRequests / totalRequests : 0,
      },
      minuteBuckets,
    };
  },
});

export const observabilityInfoEventOptions = httpAction(
  async (_ctx, request) => {
    const corsDecision = getObservabilityIngestCorsDecision(request);
    if (!corsDecision.allowed) {
      logWarn("observability_info_event_origin_rejected", {
        reason: corsDecision.reason,
        ...toRequestContext(request),
      });

      return jsonResponse(
        403,
        { error: "Origin not allowed" },
        corsDecision.responseHeaders,
      );
    }

    return new Response(null, {
      status: 204,
      headers: corsDecision.responseHeaders,
    });
  },
);

export const ingestObservabilityInfoEvent = httpAction(async (ctx, request) => {
  const corsDecision = getObservabilityIngestCorsDecision(request);
  if (!corsDecision.allowed) {
    logWarn("observability_info_event_origin_rejected", {
      reason: corsDecision.reason,
      ...toRequestContext(request),
    });

    return jsonResponse(
      403,
      { error: "Origin not allowed" },
      corsDecision.responseHeaders,
    );
  }

  if (request.method !== "POST") {
    return jsonResponse(
      405,
      { error: "Method not allowed" },
      corsDecision.responseHeaders,
    );
  }

  const authDecision = await verifyObservabilityIngestAuth(request);
  if (!authDecision.ok) {
    logWarn("observability_info_event_auth_rejected", {
      reason: authDecision.reason,
      ...toRequestContext(request),
    });

    return jsonResponse(
      authDecision.status,
      { error: "Unauthorized" },
      corsDecision.responseHeaders,
    );
  }

  const authContext: ObservabilityIngestAuthContext = authDecision.auth;

  let replayDecision: ReplayNonceConsumeResult | null = null;
  try {
    replayDecision = (await ctx.runMutation(
      (internal as any).observabilityIngestion
        .consumeObservabilityIngestNonceInternal,
      {
        nonce: authContext.tokenId,
        userId: authContext.userId,
        sessionId: authContext.sessionId,
        issuedAtSeconds: authContext.issuedAtSeconds,
        expiresAtSeconds: authContext.expiresAtSeconds,
        consumedAt: Date.now(),
      },
    )) as ReplayNonceConsumeResult;
  } catch (error) {
    captureException("observability_info_event_replay_guard_failed", error, {
      status: "failed_closed",
      ...toRequestContext(request),
    });

    return jsonResponse(
      503,
      { error: "Temporarily unavailable" },
      corsDecision.responseHeaders,
    );
  }

  if (!replayDecision?.accepted) {
    logWarn("observability_info_event_replay_rejected", {
      reason: replayDecision?.reason ?? "replay",
      ...toRequestContext(request),
    });

    return jsonResponse(
      409,
      { error: "Replay detected" },
      corsDecision.responseHeaders,
    );
  }

  const rateLimitIdentity = resolveObservabilityIngestRateLimitIdentity(
    request,
    authContext.principalKey,
  );
  let rateLimitDecision: ObservabilityIngestRateLimitDecision | null = null;

  try {
    rateLimitDecision = await ctx.runMutation(
      internal.observabilityIngestRateLimiter
        .evaluateObservabilityIngestRateLimitInternal,
      {
        ipKey: rateLimitIdentity.ipKey,
        userKey: rateLimitIdentity.userKey,
        receivedAt: Date.now(),
      },
    );
  } catch (error) {
    captureException("observability_info_event_rate_limit_failed", error, {
      status: "failed_open",
      ipKeyHash: fingerprintRateLimitKey(rateLimitIdentity.ipKey),
      userKeyHash: fingerprintRateLimitKey(rateLimitIdentity.userKey),
      ...toRequestContext(request),
    });
  }

  if (rateLimitDecision && !rateLimitDecision.allowed) {
    const retryAfterSeconds = Math.max(rateLimitDecision.retryAfterSeconds, 1);

    logWarn("observability_info_event_rate_limited", {
      status: "blocked",
      blockedScopes: rateLimitDecision.blockedScopes,
      retryAfterSeconds,
      ipKeyHash: fingerprintRateLimitKey(rateLimitDecision.ipKey),
      userKeyHash: fingerprintRateLimitKey(rateLimitDecision.userKey),
      burstAttempt: rateLimitDecision.burstAttempt,
      ...toRequestContext(request),
    });

    return jsonResponse(
      429,
      {
        error: "Too many requests",
        retryAfterSeconds,
      },
      corsDecision.responseHeaders,
      {
        "Retry-After": String(retryAfterSeconds),
      },
    );
  }

  if (rateLimitDecision?.burstAttempt) {
    logWarn("observability_info_event_burst_attempt", {
      status: "warning",
      blockedScopes: rateLimitDecision.blockedScopes,
      ipKeyHash: fingerprintRateLimitKey(rateLimitDecision.ipKey),
      userKeyHash: fingerprintRateLimitKey(rateLimitDecision.userKey),
      ...toRequestContext(request),
    });
  }

  const declaredContentLength = parseDeclaredContentLength(request);
  if (
    typeof declaredContentLength === "number" &&
    declaredContentLength > MAX_PAYLOAD_BYTES
  ) {
    logWarn("observability_info_event_payload_too_large", {
      length: declaredContentLength,
      maxBytes: MAX_PAYLOAD_BYTES,
      source: "content-length",
    });

    return jsonResponse(
      413,
      { error: "Payload too large" },
      corsDecision.responseHeaders,
    );
  }

  const raw = await request.text();
  const payloadBytes = toPayloadByteLength(raw);

  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    logWarn("observability_info_event_payload_too_large", {
      length: payloadBytes,
      maxBytes: MAX_PAYLOAD_BYTES,
      source: "body",
    });

    return jsonResponse(
      413,
      { error: "Payload too large" },
      corsDecision.responseHeaders,
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return jsonResponse(
      400,
      { error: "Invalid JSON" },
      corsDecision.responseHeaders,
    );
  }

  if (!isObservabilityInfoEventPayloadInput(parsedBody)) {
    return jsonResponse(
      400,
      { error: "Invalid payload" },
      corsDecision.responseHeaders,
    );
  }

  const body = parsedBody;

  if (body.schemaVersion !== 1 || body.app !== "daylog") {
    return jsonResponse(
      400,
      { error: "Invalid payload envelope" },
      corsDecision.responseHeaders,
    );
  }

  if (body.surface !== "web" && body.surface !== "mobile") {
    return jsonResponse(
      400,
      { error: "Unsupported surface" },
      corsDecision.responseHeaders,
    );
  }

  if (body.level !== "info") {
    return jsonResponse(
      400,
      {
        error: "Only info events are accepted",
      },
      corsDecision.responseHeaders,
    );
  }

  if (typeof body.event !== "string" || body.event.trim().length === 0) {
    return jsonResponse(
      400,
      { error: "Missing event name" },
      corsDecision.responseHeaders,
    );
  }

  const payload: ObservabilityInfoEventPayload = {
    schemaVersion: 1,
    app: "daylog",
    surface: body.surface,
    level: "info",
    event: body.event.trim().slice(0, MAX_EVENT_LENGTH),
    timestamp: typeof body.timestamp === "string" ? body.timestamp : undefined,
    contextJson: body.contextJson,
    sampleRate: body.sampleRate,
    sourceEnvironment: body.sourceEnvironment,
  };

  const now = Date.now();
  const { emittedAt, timestamp } = toEmittedAt(payload.timestamp, now);
  const row: ObservabilityInfoEventInsert = {
    app: payload.app,
    surface: payload.surface,
    level: payload.level,
    event: payload.event,
    timestamp,
    emittedAt,
    receivedAt: now,
    sampleRate: toSafeSampleRate(payload.sampleRate),
    sourceEnvironment: toSafeEnvironment(payload.sourceEnvironment),
    contextJson: toSafeContextJson(payload.contextJson),
  };

  try {
    await ctx.runMutation(
      internal.observabilityIngestion.insertObservabilityInfoEventInternal,
      row,
    );
  } catch (error) {
    captureException("observability_info_event_insert_failed", error, {
      surface: row.surface,
      event: row.event,
    });

    return jsonResponse(
      500,
      { error: "Failed to ingest event" },
      corsDecision.responseHeaders,
    );
  }

  return jsonResponse(202, { accepted: true }, corsDecision.responseHeaders);
});
