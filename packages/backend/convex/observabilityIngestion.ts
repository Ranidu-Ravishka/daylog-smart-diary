import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, internalMutation, query } from "./_generated/server";
import { requireAdmin } from "./authz";
import { captureException, logWarn } from "./observability";

const MAX_PAYLOAD_BYTES = 24_000;
const MAX_EVENT_LENGTH = 120;
const MAX_CONTEXT_JSON_LENGTH = 4_000;
const MAX_ENVIRONMENT_LENGTH = 48;
const DEFAULT_TRANSPORT_HEALTH_WINDOW_HOURS = 24;
const MAX_TRANSPORT_HEALTH_WINDOW_HOURS = 24 * 14;
const MAX_TRANSPORT_HEALTH_ROWS = 5_000;
const MAX_TRANSPORT_HEALTH_TOP_EVENTS = 5;
const MAX_TRANSPORT_HEALTH_FILTER_LENGTH = 80;

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

type IngestPayload = {
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

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function jsonResponse(request: Request, status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
    },
  });
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
    return await (ctx.db as any).insert("observabilityInfoEvents", args);
  },
});

export const listObservabilityInfoEventsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    surface: v.optional(v.union(v.literal("web"), v.literal("mobile"))),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    if (args.surface) {
      return await ctx.db
        .query("observabilityInfoEvents")
        .withIndex("by_surface_receivedAt", (q) =>
          q.eq("surface", args.surface as "web" | "mobile"),
        )
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

export const observabilityInfoEventOptions = httpAction(
  async (_ctx, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  },
);

export const ingestObservabilityInfoEvent = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Method not allowed" });
  }

  const raw = await request.text();
  if (raw.length > MAX_PAYLOAD_BYTES) {
    logWarn("observability_info_event_payload_too_large", {
      length: raw.length,
      maxBytes: MAX_PAYLOAD_BYTES,
    });

    return jsonResponse(request, 413, { error: "Payload too large" });
  }

  let body: IngestPayload;
  try {
    body = JSON.parse(raw) as IngestPayload;
  } catch {
    return jsonResponse(request, 400, { error: "Invalid JSON" });
  }

  const surface = body.surface;
  const level = body.level;
  const event = body.event;

  if (body.schemaVersion !== 1 || body.app !== "daylog") {
    return jsonResponse(request, 400, { error: "Invalid payload envelope" });
  }

  if (surface !== "web" && surface !== "mobile") {
    return jsonResponse(request, 400, { error: "Unsupported surface" });
  }

  if (level !== "info") {
    return jsonResponse(request, 400, {
      error: "Only info events are accepted",
    });
  }

  if (typeof event !== "string" || event.trim().length === 0) {
    return jsonResponse(request, 400, { error: "Missing event name" });
  }

  const now = Date.now();
  const { emittedAt, timestamp } = toEmittedAt(body.timestamp, now);
  const row = {
    app: "daylog" as const,
    surface,
    level: "info" as const,
    event: event.trim().slice(0, MAX_EVENT_LENGTH),
    timestamp,
    emittedAt,
    receivedAt: now,
    sampleRate: toSafeSampleRate(body.sampleRate),
    sourceEnvironment: toSafeEnvironment(body.sourceEnvironment),
    contextJson: toSafeContextJson(body.contextJson),
  };

  try {
    await ctx.runMutation(
      (internal as any).observabilityIngestion
        .insertObservabilityInfoEventInternal,
      row,
    );
  } catch (error) {
    captureException("observability_info_event_insert_failed", error, {
      surface: row.surface,
      event: row.event,
    });

    return jsonResponse(request, 500, { error: "Failed to ingest event" });
  }

  return jsonResponse(request, 202, { accepted: true });
});
