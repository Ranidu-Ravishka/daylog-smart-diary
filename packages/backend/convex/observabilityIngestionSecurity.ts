const OBSERVABILITY_INGEST_JWT_SECRETS_ENV = "OBSERVABILITY_INGEST_JWT_SECRETS";
const OBSERVABILITY_INGEST_ALLOWED_ORIGINS_ENV =
  "OBSERVABILITY_INGEST_ALLOWED_ORIGINS";

const INGEST_JWT_ISSUER = "daylog-observability-token";
const INGEST_JWT_AUDIENCE = "daylog-observability-ingest";
const INGEST_JWT_ALGORITHM = "HS256";
const INGEST_JWT_TYPE = "JWT";

const LOCAL_DEVELOPMENT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
] as const;

const PRODUCTION_ENVIRONMENT_VALUES = new Set(["production", "prod"]);

const JWT_SECRET_MIN_LENGTH = 32;
const MAX_TOKEN_LIFETIME_SECONDS = 5 * 60;
const MAX_CLOCK_SKEW_SECONDS = 30;

const AUTHORIZATION_HEADER_NAME = "authorization";

const CORS_ALLOW_METHODS = "POST, OPTIONS";
const CORS_ALLOW_HEADERS = "Content-Type, Authorization";

type IngestSecurityConfig = {
  jwtSecrets: string[];
  allowedOrigins: Set<string>;
  configurationError: string | null;
};

export type ObservabilityIngestAuthContext = {
  userId: string;
  sessionId: string;
  tokenId: string;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
  principalKey: string;
};

type IngestAuthDecision =
  | {
      ok: true;
      auth: ObservabilityIngestAuthContext;
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

type JwtHeaderInput = {
  alg?: unknown;
  typ?: unknown;
};

type JwtPayloadInput = {
  sub?: unknown;
  sid?: unknown;
  jti?: unknown;
  iat?: unknown;
  exp?: unknown;
  iss?: unknown;
  aud?: unknown;
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

function resolveRequestBearerToken(request: Request): string | null {
  return parseBearerToken(request.headers.get(AUTHORIZATION_HEADER_NAME));
}

function toFiniteInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.floor(value);
}

function decodeBase64UrlJson(value: string): unknown {
  try {
    const json = Buffer.from(value, "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
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

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseConfiguredJwtSecrets(raw: string | undefined): {
  secrets: string[];
  invalidEntries: string[];
} {
  const unique = new Set<string>();
  const invalidEntries: string[] = [];

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

function resolveJwtTokenParts(token: string): {
  headerPart: string;
  payloadPart: string;
  signaturePart: string;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) {
    return null;
  }

  return {
    headerPart,
    payloadPart,
    signaturePart,
  };
}

function isExpectedJwtHeader(value: unknown): value is JwtHeaderInput {
  return typeof value === "object" && value !== null;
}

function isExpectedJwtPayload(value: unknown): value is JwtPayloadInput {
  return typeof value === "object" && value !== null;
}

function validateJwtClaims(payload: JwtPayloadInput):
  | {
      ok: true;
      userId: string;
      sessionId: string;
      tokenId: string;
      issuedAtSeconds: number;
      expiresAtSeconds: number;
    }
  | {
      ok: false;
      reason: string;
    } {
  const userId = asNonEmptyString(payload.sub);
  if (!userId) {
    return {
      ok: false,
      reason: "token subject claim is invalid",
    };
  }

  const sessionId = asNonEmptyString(payload.sid);
  if (!sessionId) {
    return {
      ok: false,
      reason: "token session claim is invalid",
    };
  }

  const tokenId = asNonEmptyString(payload.jti);
  if (!tokenId) {
    return {
      ok: false,
      reason: "token id claim is invalid",
    };
  }

  const issuedAtSeconds = toFiniteInteger(payload.iat);
  const expiresAtSeconds = toFiniteInteger(payload.exp);

  if (issuedAtSeconds === null || expiresAtSeconds === null) {
    return {
      ok: false,
      reason: "token iat/exp claims must be integers",
    };
  }

  if (expiresAtSeconds <= issuedAtSeconds) {
    return {
      ok: false,
      reason: "token expiration must be after issue time",
    };
  }

  const lifetimeSeconds = expiresAtSeconds - issuedAtSeconds;
  if (lifetimeSeconds > MAX_TOKEN_LIFETIME_SECONDS) {
    return {
      ok: false,
      reason: "token lifetime exceeds maximum allowed duration",
    };
  }

  if (payload.iss !== INGEST_JWT_ISSUER) {
    return {
      ok: false,
      reason: "token issuer claim is invalid",
    };
  }

  if (payload.aud !== INGEST_JWT_AUDIENCE) {
    return {
      ok: false,
      reason: "token audience claim is invalid",
    };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (issuedAtSeconds > nowSeconds + MAX_CLOCK_SKEW_SECONDS) {
    return {
      ok: false,
      reason: "token issue time is in the future",
    };
  }

  if (expiresAtSeconds <= nowSeconds - MAX_CLOCK_SKEW_SECONDS) {
    return {
      ok: false,
      reason: "token is expired",
    };
  }

  return {
    ok: true,
    userId,
    sessionId,
    tokenId,
    issuedAtSeconds,
    expiresAtSeconds,
  };
}

function resolveConfigCacheKey(): string {
  return [
    process.env.DAYLOG_APP_ENV ?? "",
    process.env.APP_ENV ?? "",
    process.env.DEPLOY_ENV ?? "",
    process.env.VERCEL_ENV ?? "",
    process.env.NODE_ENV ?? "",
    process.env[OBSERVABILITY_INGEST_JWT_SECRETS_ENV] ?? "",
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
    jwtSecrets: secrets,
    allowedOrigins: origins,
    configurationError: errors.length > 0 ? errors.join(" ") : null,
  };

  return cachedConfig;
}

export async function verifyObservabilityIngestAuth(
  request: Request,
): Promise<IngestAuthDecision> {
  const config = getObservabilityIngestSecurityConfig();

  if (config.configurationError) {
    return {
      ok: false,
      status: 401,
      reason: config.configurationError,
    };
  }

  if (config.jwtSecrets.length === 0) {
    return {
      ok: false,
      status: 401,
      reason: `${OBSERVABILITY_INGEST_JWT_SECRETS_ENV} is not configured`,
    };
  }

  const bearerToken = resolveRequestBearerToken(request);
  if (!bearerToken) {
    return {
      ok: false,
      status: 401,
      reason: "missing bearer token",
    };
  }

  const tokenParts = resolveJwtTokenParts(bearerToken);
  if (!tokenParts) {
    return {
      ok: false,
      status: 401,
      reason: "malformed jwt token",
    };
  }

  const decodedHeader = decodeBase64UrlJson(tokenParts.headerPart);
  if (!isExpectedJwtHeader(decodedHeader)) {
    return {
      ok: false,
      status: 401,
      reason: "invalid jwt header",
    };
  }

  if (
    decodedHeader.alg !== INGEST_JWT_ALGORITHM ||
    decodedHeader.typ !== INGEST_JWT_TYPE
  ) {
    return {
      ok: false,
      status: 401,
      reason: "unsupported jwt header",
    };
  }

  const decodedPayload = decodeBase64UrlJson(tokenParts.payloadPart);
  if (!isExpectedJwtPayload(decodedPayload)) {
    return {
      ok: false,
      status: 401,
      reason: "invalid jwt payload",
    };
  }

  const signingInput = `${tokenParts.headerPart}.${tokenParts.payloadPart}`;

  let hasValidSignature = false;
  for (const secret of config.jwtSecrets) {
    const expectedSignature = await signJwtInput(signingInput, secret);
    if (constantTimeEquals(tokenParts.signaturePart, expectedSignature)) {
      hasValidSignature = true;
      break;
    }
  }

  if (!hasValidSignature) {
    return {
      ok: false,
      status: 401,
      reason: "invalid jwt signature",
    };
  }

  const claims = validateJwtClaims(decodedPayload);
  if (!claims.ok) {
    return {
      ok: false,
      status: 401,
      reason: claims.reason,
    };
  }

  return {
    ok: true,
    auth: {
      userId: claims.userId,
      sessionId: claims.sessionId,
      tokenId: claims.tokenId,
      issuedAtSeconds: claims.issuedAtSeconds,
      expiresAtSeconds: claims.expiresAtSeconds,
      principalKey: `${claims.userId}:${claims.sessionId}`,
    },
  };
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
      allowed: false,
      reason: "missing origin header",
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
