type RateLimitIdentity = {
  ip: string;
  user: string;
};

type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  penaltyLevel: number;
};

type BucketState = {
  tokens: number;
  lastRefillAt: number;
  blockedUntil: number;
  penaltyLevel: number;
};

const BUCKET_CAPACITY = 60;
const REFILL_PER_SECOND = 2;
const MAX_PENALTY_LEVEL = 6;
const BASE_PENALTY_MS = 1_000;

const state = new Map<string, BucketState>();

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function sanitizeIdentity(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) return fallback;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, "_");
  return normalized.length > 0 ? normalized.slice(0, 128) : fallback;
}

function getIpFromHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return first ?? null;
}

export function resolveRateLimitIdentity(
  request: Request,
  userId?: string,
): RateLimitIdentity {
  const ip =
    getIpFromHeaderValue(request.headers.get("x-forwarded-for")) ??
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip");

  return {
    ip: sanitizeIdentity(ip, "unknown_ip"),
    user: sanitizeIdentity(userId, "anonymous"),
  };
}

function evaluateBucket(key: string, now = Date.now()): RateLimitDecision {
  const existing = state.get(key);
  const current: BucketState = existing ?? {
    tokens: BUCKET_CAPACITY,
    lastRefillAt: now,
    blockedUntil: 0,
    penaltyLevel: 0,
  };

  const refill = ((now - current.lastRefillAt) / 1000) * REFILL_PER_SECOND;
  const tokens = clamp(
    current.tokens + Math.max(refill, 0),
    0,
    BUCKET_CAPACITY,
  );

  if (current.blockedUntil > now) {
    const retryAfterSeconds = Math.ceil((current.blockedUntil - now) / 1000);
    state.set(key, {
      ...current,
      tokens,
      lastRefillAt: now,
    });
    return {
      allowed: false,
      retryAfterSeconds: Math.max(retryAfterSeconds, 1),
      penaltyLevel: current.penaltyLevel,
    };
  }

  if (tokens < 1) {
    const nextPenalty = clamp(current.penaltyLevel + 1, 1, MAX_PENALTY_LEVEL);
    const blockedMs = BASE_PENALTY_MS * 2 ** (nextPenalty - 1);
    const blockedUntil = now + blockedMs;
    state.set(key, {
      tokens,
      lastRefillAt: now,
      blockedUntil,
      penaltyLevel: nextPenalty,
    });
    return {
      allowed: false,
      retryAfterSeconds: Math.max(Math.ceil(blockedMs / 1000), 1),
      penaltyLevel: nextPenalty,
    };
  }

  const nextPenalty = tokens < BUCKET_CAPACITY * 0.2 ? current.penaltyLevel : 0;
  state.set(key, {
    tokens: tokens - 1,
    lastRefillAt: now,
    blockedUntil: 0,
    penaltyLevel: nextPenalty,
  });

  return {
    allowed: true,
    retryAfterSeconds: 0,
    penaltyLevel: nextPenalty,
  };
}

export function evaluateAdminRateLimit(
  identity: RateLimitIdentity,
): RateLimitDecision {
  const perIp = evaluateBucket(`admin:ip:${identity.ip}`);
  const perUser = evaluateBucket(`admin:user:${identity.user}`);

  if (perIp.allowed && perUser.allowed) {
    return { allowed: true, retryAfterSeconds: 0, penaltyLevel: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      perIp.retryAfterSeconds,
      perUser.retryAfterSeconds,
    ),
    penaltyLevel: Math.max(perIp.penaltyLevel, perUser.penaltyLevel),
  };
}
