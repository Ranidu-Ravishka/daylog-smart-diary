import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const OBSERVABILITY_INGEST_JWT_SECRETS_ENV = "OBSERVABILITY_INGEST_JWT_SECRETS";
const OBSERVABILITY_INGEST_ALLOWED_ORIGINS_ENV =
  "OBSERVABILITY_INGEST_ALLOWED_ORIGINS";

const INGEST_JWT_ISSUER = "daylog-observability-token";
const INGEST_JWT_AUDIENCE = "daylog-observability-ingest";
const INGEST_JWT_ALGORITHM = "HS256";
const INGEST_JWT_TYPE = "JWT";

const JWT_SECRET_MIN_LENGTH = 32;
const TOKEN_TTL_SECONDS = 5 * 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS_PER_IP = 30;
const RATE_LIMIT_MAX_REQUESTS_PER_USER = 30;

const LOCAL_DEVELOPMENT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
] as const;

const PRODUCTION_ENVIRONMENT_VALUES = new Set(["production", "prod"]);

type RouteConfig = {
  signingSecret: string | null;
  allowedOrigins: Set<string>;
  configurationError: string | null;
};

let cachedConfigKey: string | null = null;
let cachedConfig: RouteConfig | null = null;
const rateLimitState = new Map<string, number[]>();

function isProductionEnvironment(): boolean {
  const normalized = process.env.NODE_ENV?.trim().toLowerCase();
  return normalized ? PRODUCTION_ENVIRONMENT_VALUES.has(normalized) : false;
}

function normalizeHttpsOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizeRequestOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

function parseConfiguredOrigins(raw: string | undefined): {
  origins: Set<string>;
  invalidEntries: string[];
} {
  const origins = new Set<string>();
  const invalidEntries: string[] = [];

  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const normalized = normalizeHttpsOrigin(entry);
    if (!normalized) {
      invalidEntries.push(entry);
      continue;
    }

    origins.add(normalized);
  }

  return {
    origins,
    invalidEntries,
  };
}

function parseConfiguredJwtSecrets(raw: string | undefined): {
  secrets: string[];
  invalidEntries: string[];
} {
  const invalidEntries: string[] = [];
  const unique = new Set<string>();

  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    if (entry.length < JWT_SECRET_MIN_LENGTH) {
      invalidEntries.push(entry);
      continue;
    }

    unique.add(entry);
  }

  return {
    secrets: [...unique],
    invalidEntries,
  };
}

function resolveConfigCacheKey(): string {
  return [
    process.env.NODE_ENV ?? "",
    process.env[OBSERVABILITY_INGEST_JWT_SECRETS_ENV] ?? "",
    process.env[OBSERVABILITY_INGEST_ALLOWED_ORIGINS_ENV] ?? "",
  ].join("\n");
}

function getRouteConfig(): RouteConfig {
  const cacheKey = resolveConfigCacheKey();
  if (cachedConfig && cachedConfigKey === cacheKey) {
    return cachedConfig;
  }

  const errors: string[] = [];
  const isProduction = isProductionEnvironment();

  const { secrets, invalidEntries } = parseConfiguredJwtSecrets(
    process.env[OBSERVABILITY_INGEST_JWT_SECRETS_ENV],
  );

  if (invalidEntries.length > 0) {
    errors.push(
      `${OBSERVABILITY_INGEST_JWT_SECRETS_ENV} contains entries shorter than ${JWT_SECRET_MIN_LENGTH} characters.`,
    );
  }

  if (isProduction && secrets.length === 0) {
    errors.push(`${OBSERVABILITY_INGEST_JWT_SECRETS_ENV} must be configured.`);
  }

  const { origins, invalidEntries: invalidOrigins } = parseConfiguredOrigins(
    process.env[OBSERVABILITY_INGEST_ALLOWED_ORIGINS_ENV],
  );

  if (invalidOrigins.length > 0) {
    errors.push(
      `${OBSERVABILITY_INGEST_ALLOWED_ORIGINS_ENV} contains invalid entries: ${invalidOrigins.join(", ")}.`,
    );
  }

  if (isProduction && origins.size === 0) {
    errors.push(
      `${OBSERVABILITY_INGEST_ALLOWED_ORIGINS_ENV} must include at least one https origin.`,
    );
  }

  if (!isProduction) {
    for (const origin of LOCAL_DEVELOPMENT_ORIGINS) {
      origins.add(origin);
    }
  }

  cachedConfigKey = cacheKey;
  cachedConfig = {
    signingSecret: secrets[0] ?? null,
    allowedOrigins: origins,
    configurationError: errors.length > 0 ? errors.join(" ") : null,
  };

  return cachedConfig;
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json(
    {
      error: message,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store, no-cache, max-age=0",
      },
    },
  );
}

function parseIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor
      .split(",")
      .map((part) => part.trim())
      .find((part) => part.length > 0);
    if (first) return first.toLowerCase();
  }
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  ).toLowerCase();
}

function pruneWindow(now: number, points: number[]): number[] {
  return points.filter((ts) => now - ts <= RATE_LIMIT_WINDOW_MS);
}

function evaluateSlidingWindowRateLimit(
  key: string,
  limit: number,
  now = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const existing = pruneWindow(now, rateLimitState.get(key) ?? []);
  if (existing.length >= limit) {
    const oldest = existing[0] ?? now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000),
    );
    rateLimitState.set(key, existing);
    return { allowed: false, retryAfterSeconds };
  }
  existing.push(now);
  rateLimitState.set(key, existing);
  return { allowed: true, retryAfterSeconds: 0 };
}

function validateRequestOrigin(
  request: NextRequest,
  allowedOrigins: Set<string>,
): { ok: true } | { ok: false; message: string } {
  const rawOrigin = request.headers.get("origin")?.trim() ?? "";
  if (rawOrigin.length === 0) {
    return {
      ok: false,
      message: "Missing Origin header",
    };
  }

  const origin = normalizeRequestOrigin(rawOrigin);
  if (!origin) {
    return {
      ok: false,
      message: "Invalid Origin header",
    };
  }

  if (!allowedOrigins.has(origin)) {
    return {
      ok: false,
      message: "Origin not allowed",
    };
  }

  return {
    ok: true,
  };
}

async function signJwtInput(input: string, secret: string): Promise<string> {
  const keyData = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(input),
  );

  return Buffer.from(signature).toString("base64url");
}

async function issueIngestToken(args: {
  userId: string;
  sessionId: string;
  signingSecret: string;
}): Promise<{ token: string; issuedAt: number; expiresAt: number }> {
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAtSeconds + TOKEN_TTL_SECONDS;

  const header = {
    alg: INGEST_JWT_ALGORITHM,
    typ: INGEST_JWT_TYPE,
  };

  const payload = {
    sub: args.userId,
    sid: args.sessionId,
    jti: crypto.randomUUID(),
    iat: issuedAtSeconds,
    exp: expiresAtSeconds,
    iss: INGEST_JWT_ISSUER,
    aud: INGEST_JWT_AUDIENCE,
  };

  const headerPart = Buffer.from(JSON.stringify(header), "utf8").toString(
    "base64url",
  );
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );

  const signaturePart = await signJwtInput(
    `${headerPart}.${payloadPart}`,
    args.signingSecret,
  );

  return {
    token: `${headerPart}.${payloadPart}.${signaturePart}`,
    issuedAt: issuedAtSeconds * 1000,
    expiresAt: expiresAtSeconds * 1000,
  };
}

export async function POST(request: NextRequest) {
  const { userId, sessionId } = await auth();
  if (!userId || !sessionId) {
    return jsonError("Unauthorized", 401);
  }

  const now = Date.now();
  const ipDecision = evaluateSlidingWindowRateLimit(
    `obs-token:ip:${parseIp(request)}`,
    RATE_LIMIT_MAX_REQUESTS_PER_IP,
    now,
  );
  const userDecision = evaluateSlidingWindowRateLimit(
    `obs-token:user:${userId}`,
    RATE_LIMIT_MAX_REQUESTS_PER_USER,
    now,
  );
  if (!ipDecision.allowed || !userDecision.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store, no-cache, max-age=0",
          "Retry-After": String(
            Math.max(
              ipDecision.retryAfterSeconds,
              userDecision.retryAfterSeconds,
            ),
          ),
        },
      },
    );
  }

  const config = getRouteConfig();
  if (config.configurationError || !config.signingSecret) {
    return jsonError(
      config.configurationError ?? "Signing configuration is unavailable",
      503,
    );
  }

  const originDecision = validateRequestOrigin(request, config.allowedOrigins);
  if (!originDecision.ok) {
    return jsonError(originDecision.message, 403);
  }

  const token = await issueIngestToken({
    userId,
    sessionId,
    signingSecret: config.signingSecret,
  });

  return NextResponse.json(token, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, max-age=0",
      Pragma: "no-cache",
    },
  });
}
