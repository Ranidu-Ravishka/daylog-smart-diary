const OBSERVABILITY_INGEST_TOKEN_ENV = "OBSERVABILITY_INGEST_TOKEN";
const OBSERVABILITY_INGEST_ALLOWED_ORIGINS_ENV =
  "OBSERVABILITY_INGEST_ALLOWED_ORIGINS";

const LOCAL_DEVELOPMENT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
] as const;

const PRODUCTION_ENVIRONMENT_VALUES = new Set(["production", "prod"]);

const INGEST_TOKEN_MIN_LENGTH = 24;

const INGEST_TOKEN_HEADER_NAME = "x-daylog-ingest-token";
const AUTHORIZATION_HEADER_NAME = "authorization";

const CORS_ALLOW_METHODS = "POST, OPTIONS";
const CORS_ALLOW_HEADERS = "Content-Type, X-Daylog-Ingest-Token, Authorization";

type IngestSecurityConfig = {
  ingestToken: string | null;
  allowedOrigins: Set<string>;
  configurationError: string | null;
};

type IngestAuthDecision =
  | {
      ok: true;
    }
  | {
      ok: false;
      status: 401;
      reason: string;
    };

type IngestCorsDecision = {
  allowed: boolean;
  reason?: string;
  responseHeaders: Record<string, string>;
};

let cachedConfigKey: string | null = null;
let cachedConfig: IngestSecurityConfig | null = null;

function isProductionEnvironment(): boolean {
  const candidates = [
    process.env.DAYLOG_APP_ENV,
    process.env.APP_ENV,
    process.env.DEPLOY_ENV,
    process.env.VERCEL_ENV,
    process.env.NODE_ENV,
  ];

  return candidates.some((value) => {
    const normalized = value?.trim().toLowerCase();
    return normalized ? PRODUCTION_ENVIRONMENT_VALUES.has(normalized) : false;
  });
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
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
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

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    Vary: "Origin",
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftLength = left.length;
  const rightLength = right.length;
  const maxLength = Math.max(leftLength, rightLength);

  let mismatch = leftLength ^ rightLength;

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = index < leftLength ? left.charCodeAt(index) : 0;
    const rightCode = index < rightLength ? right.charCodeAt(index) : 0;
    mismatch |= leftCode ^ rightCode;
  }

  return mismatch === 0;
}

function parseBearerToken(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (!trimmed.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = trimmed.slice("bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function resolveRequestIngestToken(request: Request): string | null {
  const headerToken = request.headers.get(INGEST_TOKEN_HEADER_NAME)?.trim();
  if (headerToken) {
    return headerToken;
  }

  return parseBearerToken(request.headers.get(AUTHORIZATION_HEADER_NAME));
}

function resolveConfigCacheKey(): string {
  return [
    process.env.DAYLOG_APP_ENV ?? "",
    process.env.APP_ENV ?? "",
    process.env.DEPLOY_ENV ?? "",
    process.env.VERCEL_ENV ?? "",
    process.env.NODE_ENV ?? "",
    process.env[OBSERVABILITY_INGEST_TOKEN_ENV] ?? "",
    process.env[OBSERVABILITY_INGEST_ALLOWED_ORIGINS_ENV] ?? "",
  ].join("\n");
}

function getObservabilityIngestSecurityConfig(): IngestSecurityConfig {
  const cacheKey = resolveConfigCacheKey();
  if (cachedConfig && cachedConfigKey === cacheKey) {
    return cachedConfig;
  }

  const errors: string[] = [];
  const isProduction = isProductionEnvironment();

  const configuredToken =
    process.env[OBSERVABILITY_INGEST_TOKEN_ENV]?.trim() ?? "";
  const ingestToken = configuredToken.length > 0 ? configuredToken : null;

  if (ingestToken && ingestToken.length < INGEST_TOKEN_MIN_LENGTH) {
    errors.push(
      `${OBSERVABILITY_INGEST_TOKEN_ENV} must be at least ${INGEST_TOKEN_MIN_LENGTH} characters.`,
    );
  }

  if (isProduction && !ingestToken) {
    errors.push(`${OBSERVABILITY_INGEST_TOKEN_ENV} must be configured.`);
  }

  const { origins, invalidEntries } = parseConfiguredOrigins(
    process.env[OBSERVABILITY_INGEST_ALLOWED_ORIGINS_ENV],
  );

  if (invalidEntries.length > 0) {
    errors.push(
      `${OBSERVABILITY_INGEST_ALLOWED_ORIGINS_ENV} contains invalid entries: ${invalidEntries.join(", ")}.`,
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
    ingestToken,
    allowedOrigins: origins,
    configurationError: errors.length > 0 ? errors.join(" ") : null,
  };

  return cachedConfig;
}

export function verifyObservabilityIngestAuth(
  request: Request,
): IngestAuthDecision {
  const config = getObservabilityIngestSecurityConfig();

  if (config.configurationError) {
    return {
      ok: false,
      status: 401,
      reason: config.configurationError,
    };
  }

  if (!config.ingestToken) {
    return {
      ok: false,
      status: 401,
      reason: `${OBSERVABILITY_INGEST_TOKEN_ENV} is not configured`,
    };
  }

  const requestToken = resolveRequestIngestToken(request);
  if (!requestToken) {
    return {
      ok: false,
      status: 401,
      reason: "missing ingest token",
    };
  }

  if (!constantTimeEquals(requestToken, config.ingestToken)) {
    return {
      ok: false,
      status: 401,
      reason: "invalid ingest token",
    };
  }

  return { ok: true };
}

export function getObservabilityIngestCorsDecision(
  request: Request,
): IngestCorsDecision {
  const config = getObservabilityIngestSecurityConfig();

  if (config.configurationError) {
    return {
      allowed: false,
      reason: config.configurationError,
      responseHeaders: buildCorsHeaders(null),
    };
  }

  const rawOrigin = request.headers.get("origin")?.trim() ?? "";
  if (rawOrigin.length === 0) {
    return {
      allowed: true,
      responseHeaders: buildCorsHeaders(null),
    };
  }

  const origin = normalizeRequestOrigin(rawOrigin);
  if (!origin) {
    return {
      allowed: false,
      reason: "invalid origin header",
      responseHeaders: buildCorsHeaders(null),
    };
  }

  if (!config.allowedOrigins.has(origin)) {
    return {
      allowed: false,
      reason: `origin not allowed: ${origin}`,
      responseHeaders: buildCorsHeaders(null),
    };
  }

  return {
    allowed: true,
    responseHeaders: buildCorsHeaders(origin),
  };
}

export function resetObservabilityIngestSecurityConfigForTests(): void {
  cachedConfigKey = null;
  cachedConfig = null;
}
