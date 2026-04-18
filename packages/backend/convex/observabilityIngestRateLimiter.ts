import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const CLIENT_IP_HEADER_CANDIDATES = [
  "cf-connecting-ip",
  "x-real-ip",
  "x-forwarded-for",
  "x-client-ip",
  "true-client-ip",
] as const;

const USER_ID_HEADER_NAME = "x-daylog-user-id";

const UNKNOWN_IP_KEY = "unknown";
const ANONYMOUS_USER_KEY = "anonymous";

const RATE_LIMIT_KEY_MAX_LENGTH = 120;

const IP_BUCKET_CAPACITY = 300;
const IP_BUCKET_REFILL_PER_SECOND = 10;

const USER_BUCKET_CAPACITY = 120;
const USER_BUCKET_REFILL_PER_SECOND = 3;

const BURST_THRESHOLD_RATIO = 0.2;

const METRICS_SHARD_COUNT = 16;
const METRICS_SLOT_COUNT = 60 * 24;

type RateLimitScope = "ip" | "user";

type BucketConfig = {
  scope: RateLimitScope;
  capacity: number;
  refillPerSecond: number;
};

type RateLimitStateRow = {
  _id?: string;
  tokens?: number;
  lastRefillAt?: number;
  allowedRequests?: number;
  blockedRequests?: number;
  burstAttempts?: number;
};

type RateLimitMetricsRow = {
  _id?: string;
  epochMinute?: number;
  allowedRequests?: number;
  blockedRequests?: number;
  burstAttempts?: number;
};

type ScopeEvaluation = {
  scope: RateLimitScope;
  key: string;
  config: BucketConfig;
  row: RateLimitStateRow | null;
  tokensAvailable: number;
  blocked: boolean;
  retryAfterMs: number;
  burstIfAllowed: boolean;
};

export type ObservabilityIngestRateLimitDecision = {
  allowed: boolean;
  blockedScopes: RateLimitScope[];
  retryAfterSeconds: number;
  burstAttempt: boolean;
  ipKey: string;
  userKey: string;
};

export type ObservabilityIngestRateLimitIdentity = {
  ipKey: string;
  userKey: string;
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function sanitizeRateLimitKey(
  raw: string | null | undefined,
  fallback: string,
): string {
  if (typeof raw !== "string") {
    return fallback;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fallback;
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, "_")
    .slice(0, RATE_LIMIT_KEY_MAX_LENGTH);

  return normalized.length > 0 ? normalized : fallback;
}

function parseForwardedFor(value: string): string | null {
  const first = value
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.length > 0);

  if (!first) {
    return null;
  }

  return first;
}

function extractRawClientIp(request: Request): string | null {
  for (const headerName of CLIENT_IP_HEADER_CANDIDATES) {
    const value = request.headers.get(headerName)?.trim();
    if (!value) {
      continue;
    }

    if (headerName === "x-forwarded-for") {
      const parsed = parseForwardedFor(value);
      if (parsed) {
        return parsed;
      }

      continue;
    }

    return value;
  }

  return null;
}

export function resolveObservabilityIngestIpKey(request: Request): string {
  return sanitizeRateLimitKey(extractRawClientIp(request), UNKNOWN_IP_KEY);
}

export function resolveObservabilityIngestUserKey(request: Request): string {
  const headerValue = request.headers.get(USER_ID_HEADER_NAME);
  return sanitizeRateLimitKey(headerValue, ANONYMOUS_USER_KEY);
}

export function resolveObservabilityIngestRateLimitIdentity(
  request: Request,
): ObservabilityIngestRateLimitIdentity {
  return {
    ipKey: resolveObservabilityIngestIpKey(request),
    userKey: resolveObservabilityIngestUserKey(request),
  };
}

export function fingerprintRateLimitKey(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function evaluateTokenBucket(
  currentTokens: number,
  lastRefillAt: number,
  now: number,
  capacity: number,
  refillPerSecond: number,
): {
  tokensAvailable: number;
  blocked: boolean;
  retryAfterMs: number;
  burstIfAllowed: boolean;
} {
  const elapsedMs = Math.max(now - lastRefillAt, 0);
  const refillAmount = (elapsedMs / 1000) * refillPerSecond;

  const refilledTokens = clamp(currentTokens + refillAmount, 0, capacity);
  const blocked = refilledTokens < 1;

  const retryAfterMs = blocked
    ? Math.ceil(((1 - refilledTokens) / refillPerSecond) * 1000)
    : 0;

  const tokensAfterConsume = clamp(refilledTokens - 1, 0, capacity);
  const burstThreshold = capacity * BURST_THRESHOLD_RATIO;

  return {
    tokensAvailable: refilledTokens,
    blocked,
    retryAfterMs: Math.max(retryAfterMs, 0),
    burstIfAllowed: tokensAfterConsume <= burstThreshold,
  };
}

function hashToShard(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) % METRICS_SHARD_COUNT;
}

function computeMetricsShard(
  ipKey: string,
  userKey: string,
  epochMinute: number,
): number {
  return hashToShard(`${ipKey}|${userKey}|${String(epochMinute)}`);
}

function normalizeNow(value: number): number {
  if (!Number.isFinite(value)) {
    return Date.now();
  }

  return Math.floor(value);
}

function getInitialTokens(
  row: RateLimitStateRow | null,
  capacity: number,
): number {
  if (!row || typeof row.tokens !== "number" || !Number.isFinite(row.tokens)) {
    return capacity;
  }

  return clamp(row.tokens, 0, capacity);
}

function getInitialLastRefillAt(
  row: RateLimitStateRow | null,
  now: number,
): number {
  if (
    !row ||
    typeof row.lastRefillAt !== "number" ||
    !Number.isFinite(row.lastRefillAt)
  ) {
    return now;
  }

  return row.lastRefillAt;
}

function getCounter(
  row: RateLimitStateRow | null,
  key: "allowedRequests" | "blockedRequests" | "burstAttempts",
): number {
  if (!row || typeof row[key] !== "number" || !Number.isFinite(row[key])) {
    return 0;
  }

  return row[key];
}

async function fetchRateLimitRow(
  db: any,
  scope: RateLimitScope,
  key: string,
): Promise<RateLimitStateRow | null> {
  return await db
    .query("observabilityIngestRateLimits")
    .withIndex("by_scope_key", (q: any) => q.eq("scope", scope).eq("key", key))
    .unique();
}

async function upsertScopeRow(
  db: any,
  evaluation: ScopeEvaluation,
  allowed: boolean,
  now: number,
): Promise<void> {
  const { row, config, scope, key, tokensAvailable, blocked, burstIfAllowed } =
    evaluation;

  const allowedRequests =
    getCounter(row, "allowedRequests") + (allowed ? 1 : 0);
  const blockedRequests =
    getCounter(row, "blockedRequests") + (blocked ? 1 : 0);

  const burstAttempts =
    getCounter(row, "burstAttempts") +
    (allowed ? (burstIfAllowed ? 1 : 0) : blocked ? 1 : 0);

  const nextTokens = allowed
    ? clamp(tokensAvailable - 1, 0, config.capacity)
    : tokensAvailable;

  const patch = {
    capacity: config.capacity,
    refillPerSecond: config.refillPerSecond,
    tokens: nextTokens,
    lastRefillAt: now,
    allowedRequests,
    blockedRequests,
    burstAttempts,
    updatedAt: now,
  };

  if (row?._id) {
    await db.patch(row._id, patch);
    return;
  }

  await db.insert("observabilityIngestRateLimits", {
    scope,
    key,
    createdAt: now,
    ...patch,
  });
}

async function upsertMetricsRow(
  db: any,
  args: {
    now: number;
    allowed: boolean;
    burstAttempt: boolean;
    ipKey: string;
    userKey: string;
  },
): Promise<void> {
  const epochMinute = Math.floor(args.now / 60_000);
  const slotMinute = epochMinute % METRICS_SLOT_COUNT;
  const shard = computeMetricsShard(args.ipKey, args.userKey, epochMinute);

  const existing: RateLimitMetricsRow | null = await db
    .query("observabilityIngestRateLimitMetrics")
    .withIndex("by_slot_shard", (q: any) =>
      q.eq("slotMinute", slotMinute).eq("shard", shard),
    )
    .unique();

  const allowedIncrement = args.allowed ? 1 : 0;
  const blockedIncrement = args.allowed ? 0 : 1;
  const burstIncrement = args.burstAttempt ? 1 : 0;

  if (!existing?._id) {
    await db.insert("observabilityIngestRateLimitMetrics", {
      slotMinute,
      shard,
      epochMinute,
      allowedRequests: allowedIncrement,
      blockedRequests: blockedIncrement,
      burstAttempts: burstIncrement,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return;
  }

  if (existing.epochMinute !== epochMinute) {
    await db.patch(existing._id, {
      epochMinute,
      allowedRequests: allowedIncrement,
      blockedRequests: blockedIncrement,
      burstAttempts: burstIncrement,
      updatedAt: args.now,
    });
    return;
  }

  await db.patch(existing._id, {
    allowedRequests: (existing.allowedRequests ?? 0) + allowedIncrement,
    blockedRequests: (existing.blockedRequests ?? 0) + blockedIncrement,
    burstAttempts: (existing.burstAttempts ?? 0) + burstIncrement,
    updatedAt: args.now,
  });
}

export const evaluateObservabilityIngestRateLimitInternal = internalMutation({
  args: {
    ipKey: v.string(),
    userKey: v.string(),
    receivedAt: v.number(),
  },
  handler: async (ctx, args): Promise<ObservabilityIngestRateLimitDecision> => {
    const now = normalizeNow(args.receivedAt);
    const db = ctx.db as any;

    const configs: Array<BucketConfig & { key: string }> = [
      {
        scope: "ip",
        key: args.ipKey,
        capacity: IP_BUCKET_CAPACITY,
        refillPerSecond: IP_BUCKET_REFILL_PER_SECOND,
      },
      {
        scope: "user",
        key: args.userKey,
        capacity: USER_BUCKET_CAPACITY,
        refillPerSecond: USER_BUCKET_REFILL_PER_SECOND,
      },
    ];

    const existingRows = await Promise.all(
      configs.map((config) => fetchRateLimitRow(db, config.scope, config.key)),
    );

    const evaluations: ScopeEvaluation[] = configs.map((config, index) => {
      const row = existingRows[index] ?? null;
      const initialTokens = getInitialTokens(row, config.capacity);
      const initialLastRefillAt = getInitialLastRefillAt(row, now);

      const tokenBucket = evaluateTokenBucket(
        initialTokens,
        initialLastRefillAt,
        now,
        config.capacity,
        config.refillPerSecond,
      );

      return {
        scope: config.scope,
        key: config.key,
        config,
        row,
        tokensAvailable: tokenBucket.tokensAvailable,
        blocked: tokenBucket.blocked,
        retryAfterMs: tokenBucket.retryAfterMs,
        burstIfAllowed: tokenBucket.burstIfAllowed,
      };
    });

    const blockedScopes = evaluations
      .filter((evaluation) => evaluation.blocked)
      .map((evaluation) => evaluation.scope);

    const allowed = blockedScopes.length === 0;

    const burstAttempt =
      !allowed || evaluations.some((evaluation) => evaluation.burstIfAllowed);

    const retryAfterSeconds =
      blockedScopes.length > 0
        ? Math.max(
            ...evaluations
              .filter((evaluation) => evaluation.blocked)
              .map((evaluation) => Math.ceil(evaluation.retryAfterMs / 1000)),
          )
        : 0;

    await Promise.all(
      evaluations.map((evaluation) =>
        upsertScopeRow(db, evaluation, allowed, now),
      ),
    );

    await upsertMetricsRow(db, {
      now,
      allowed,
      burstAttempt,
      ipKey: args.ipKey,
      userKey: args.userKey,
    });

    return {
      allowed,
      blockedScopes,
      retryAfterSeconds,
      burstAttempt,
      ipKey: args.ipKey,
      userKey: args.userKey,
    };
  },
});
