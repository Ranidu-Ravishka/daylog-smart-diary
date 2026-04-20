import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getObservabilityIngestCorsDecision,
  resetObservabilityIngestSecurityConfigForTests,
  verifyObservabilityIngestAuth,
} from "./observabilityIngestionSecurity";
import {
  ingestObservabilityInfoEvent,
  observabilityInfoEventOptions,
} from "./observabilityIngestion";
import type { ObservabilityIngestRateLimitDecision } from "./observabilityIngestRateLimiter";

const PRIMARY_JWT_SECRET = "test_observability_jwt_secret_primary_value_123456";
const ROTATED_JWT_SECRET = "test_observability_jwt_secret_rotated_value_654321";
const ALLOWED_ORIGIN = "https://app.daylog.test";
const JWT_ISSUER = "daylog-observability-token";
const JWT_AUDIENCE = "daylog-observability-ingest";

const ORIGINAL_ENV = {
  DAYLOG_APP_ENV: process.env.DAYLOG_APP_ENV,
  APP_ENV: process.env.APP_ENV,
  DEPLOY_ENV: process.env.DEPLOY_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
  NODE_ENV: process.env.NODE_ENV,
  OBSERVABILITY_INGEST_JWT_SECRETS:
    process.env.OBSERVABILITY_INGEST_JWT_SECRETS,
  OBSERVABILITY_INGEST_ALLOWED_ORIGINS:
    process.env.OBSERVABILITY_INGEST_ALLOWED_ORIGINS,
};

type HttpActionHandler = (ctx: unknown, request: Request) => Promise<Response>;

type ReplayDecision = {
  accepted: boolean;
  reason?: "replay";
};

function buildRateLimitDecision(
  overrides?: Partial<ObservabilityIngestRateLimitDecision>,
): ObservabilityIngestRateLimitDecision {
  return {
    allowed: true,
    blockedScopes: [],
    retryAfterSeconds: 0,
    burstAttempt: false,
    ipKey: "127.0.0.1",
    userKey: "user_1:session_1",
    ...overrides,
  };
}

function isRateLimitMutationArgs(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  return "ipKey" in value && "userKey" in value && "receivedAt" in value;
}

function isReplayGuardMutationArgs(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  return "nonce" in value && "sessionId" in value && "consumedAt" in value;
}

function isInsertEventMutationArgs(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  return "app" in value && "surface" in value && "event" in value;
}

function countInsertMutationCalls(
  runMutation: ReturnType<typeof vi.fn>,
): number {
  return runMutation.mock.calls.filter((call) =>
    isInsertEventMutationArgs(call[1]),
  ).length;
}

function createRunMutationMock(options?: {
  rateLimitDecision?: ObservabilityIngestRateLimitDecision;
  replayDecisions?: ReplayDecision[];
}) {
  const replayQueue = [...(options?.replayDecisions ?? [{ accepted: true }])];

  return vi.fn(async (_ref: unknown, args: unknown) => {
    if (isReplayGuardMutationArgs(args)) {
      return replayQueue.shift() ?? { accepted: true };
    }

    if (isRateLimitMutationArgs(args)) {
      return options?.rateLimitDecision ?? buildRateLimitDecision();
    }

    return undefined;
  });
}

function setSecurityEnv(overrides?: {
  appEnv?: string;
  jwtSecrets?: string;
  allowedOrigins?: string;
}) {
  process.env.DAYLOG_APP_ENV = overrides?.appEnv ?? "production";
  process.env.APP_ENV = "";
  process.env.DEPLOY_ENV = "";
  process.env.VERCEL_ENV = "";
  process.env.NODE_ENV = "test";
  process.env.OBSERVABILITY_INGEST_JWT_SECRETS =
    overrides?.jwtSecrets ?? PRIMARY_JWT_SECRET;
  process.env.OBSERVABILITY_INGEST_ALLOWED_ORIGINS =
    overrides?.allowedOrigins ?? ALLOWED_ORIGIN;

  resetObservabilityIngestSecurityConfigForTests();
}

function restoreEnvironment() {
  if (ORIGINAL_ENV.DAYLOG_APP_ENV === undefined) {
    delete process.env.DAYLOG_APP_ENV;
  } else {
    process.env.DAYLOG_APP_ENV = ORIGINAL_ENV.DAYLOG_APP_ENV;
  }

  if (ORIGINAL_ENV.APP_ENV === undefined) {
    delete process.env.APP_ENV;
  } else {
    process.env.APP_ENV = ORIGINAL_ENV.APP_ENV;
  }

  if (ORIGINAL_ENV.DEPLOY_ENV === undefined) {
    delete process.env.DEPLOY_ENV;
  } else {
    process.env.DEPLOY_ENV = ORIGINAL_ENV.DEPLOY_ENV;
  }

  if (ORIGINAL_ENV.VERCEL_ENV === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = ORIGINAL_ENV.VERCEL_ENV;
  }

  if (ORIGINAL_ENV.NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  }

  if (ORIGINAL_ENV.OBSERVABILITY_INGEST_JWT_SECRETS === undefined) {
    delete process.env.OBSERVABILITY_INGEST_JWT_SECRETS;
  } else {
    process.env.OBSERVABILITY_INGEST_JWT_SECRETS =
      ORIGINAL_ENV.OBSERVABILITY_INGEST_JWT_SECRETS;
  }

  if (ORIGINAL_ENV.OBSERVABILITY_INGEST_ALLOWED_ORIGINS === undefined) {
    delete process.env.OBSERVABILITY_INGEST_ALLOWED_ORIGINS;
  } else {
    process.env.OBSERVABILITY_INGEST_ALLOWED_ORIGINS =
      ORIGINAL_ENV.OBSERVABILITY_INGEST_ALLOWED_ORIGINS;
  }

  resetObservabilityIngestSecurityConfigForTests();
}

function createValidPayload(): string {
  return JSON.stringify({
    schemaVersion: 1,
    app: "daylog",
    surface: "web",
    level: "info",
    event: "health_check",
    timestamp: new Date("2026-04-18T10:20:30.000Z").toISOString(),
    sampleRate: 1,
    sourceEnvironment: "production",
    contextJson: JSON.stringify({ source: "unit-test" }),
  });
}

async function signJwtInput(input: string, secret: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
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

async function createJwtToken(overrides?: {
  userId?: string;
  sessionId?: string;
  tokenId?: string;
  iat?: number;
  exp?: number;
  secret?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const iat = overrides?.iat ?? now - 5;
  const exp = overrides?.exp ?? now + 240;

  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const payload = {
    sub: overrides?.userId ?? "user_1",
    sid: overrides?.sessionId ?? "session_1",
    jti: overrides?.tokenId ?? crypto.randomUUID(),
    iat,
    exp,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
  };

  const headerPart = Buffer.from(JSON.stringify(header), "utf8").toString(
    "base64url",
  );
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );

  const signature = await signJwtInput(
    `${headerPart}.${payloadPart}`,
    overrides?.secret ?? PRIMARY_JWT_SECRET,
  );

  return `${headerPart}.${payloadPart}.${signature}`;
}

async function createValidAuthorizationHeader(): Promise<string> {
  const token = await createJwtToken();
  return `Bearer ${token}`;
}

describe.sequential("observability ingest security", () => {
  beforeEach(() => {
    setSecurityEnv();
  });

  afterAll(() => {
    restoreEnvironment();
  });

  it("allows configured origin and denies unknown/missing origin", () => {
    const allowed = getObservabilityIngestCorsDecision(
      new Request("https://convex.site/observability/info-event", {
        method: "OPTIONS",
        headers: {
          origin: ALLOWED_ORIGIN,
        },
      }),
    );

    expect(allowed.allowed).toBe(true);
    expect(allowed.responseHeaders["Access-Control-Allow-Origin"]).toBe(
      ALLOWED_ORIGIN,
    );

    const denied = getObservabilityIngestCorsDecision(
      new Request("https://convex.site/observability/info-event", {
        method: "OPTIONS",
        headers: {
          origin: "https://malicious.example",
        },
      }),
    );

    expect(denied.allowed).toBe(false);

    const missingOrigin = getObservabilityIngestCorsDecision(
      new Request("https://convex.site/observability/info-event", {
        method: "OPTIONS",
      }),
    );

    expect(missingOrigin.allowed).toBe(false);
    expect(missingOrigin.reason).toContain("missing origin");
  });

  it("requires valid bearer jwt", async () => {
    const unauthorized = await verifyObservabilityIngestAuth(
      new Request("https://convex.site/observability/info-event", {
        method: "POST",
      }),
    );

    expect(unauthorized.ok).toBe(false);
    if (!unauthorized.ok) {
      expect(unauthorized.status).toBe(401);
    }

    const authorized = await verifyObservabilityIngestAuth(
      new Request("https://convex.site/observability/info-event", {
        method: "POST",
        headers: {
          authorization: await createValidAuthorizationHeader(),
        },
      }),
    );

    expect(authorized.ok).toBe(true);
    if (authorized.ok) {
      expect(authorized.auth.userId).toBe("user_1");
      expect(authorized.auth.sessionId).toBe("session_1");
    }
  });

  it("accepts rotated signing keys while primary key issues new tokens", async () => {
    setSecurityEnv({
      jwtSecrets: `${PRIMARY_JWT_SECRET},${ROTATED_JWT_SECRET}`,
    });

    const authorized = await verifyObservabilityIngestAuth(
      new Request("https://convex.site/observability/info-event", {
        method: "POST",
        headers: {
          authorization: `Bearer ${await createJwtToken({ secret: ROTATED_JWT_SECRET })}`,
        },
      }),
    );

    expect(authorized.ok).toBe(true);
  });

  it("rejects invalid origin before attempting mutation", async () => {
    const runMutation = createRunMutationMock();
    const handler = (
      ingestObservabilityInfoEvent as unknown as {
        _handler: HttpActionHandler;
      }
    )._handler;

    const response = await handler(
      { runMutation },
      new Request("https://convex.site/observability/info-event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://malicious.example",
          authorization: await createValidAuthorizationHeader(),
        },
        body: createValidPayload(),
      }),
    );

    expect(response.status).toBe(403);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("rejects missing bearer token before attempting mutation", async () => {
    const runMutation = createRunMutationMock();
    const handler = (
      ingestObservabilityInfoEvent as unknown as {
        _handler: HttpActionHandler;
      }
    )._handler;

    const response = await handler(
      { runMutation },
      new Request("https://convex.site/observability/info-event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ALLOWED_ORIGIN,
        },
        body: createValidPayload(),
      }),
    );

    expect(response.status).toBe(401);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("rejects replayed token nonce and prevents duplicate inserts", async () => {
    const runMutation = createRunMutationMock({
      replayDecisions: [
        { accepted: true },
        { accepted: false, reason: "replay" },
      ],
    });
    const handler = (
      ingestObservabilityInfoEvent as unknown as {
        _handler: HttpActionHandler;
      }
    )._handler;

    const authorization = await createValidAuthorizationHeader();

    const firstResponse = await handler(
      { runMutation },
      new Request("https://convex.site/observability/info-event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ALLOWED_ORIGIN,
          authorization,
        },
        body: createValidPayload(),
      }),
    );

    const secondResponse = await handler(
      { runMutation },
      new Request("https://convex.site/observability/info-event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ALLOWED_ORIGIN,
          authorization,
        },
        body: createValidPayload(),
      }),
    );

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(409);
    expect(countInsertMutationCalls(runMutation)).toBe(1);
  });

  it("returns 429 and skips event insert when rate limit is exceeded", async () => {
    const runMutation = createRunMutationMock({
      rateLimitDecision: buildRateLimitDecision({
        allowed: false,
        blockedScopes: ["ip"],
        retryAfterSeconds: 2,
        burstAttempt: true,
      }),
    });
    const handler = (
      ingestObservabilityInfoEvent as unknown as {
        _handler: HttpActionHandler;
      }
    )._handler;

    const response = await handler(
      { runMutation },
      new Request("https://convex.site/observability/info-event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ALLOWED_ORIGIN,
          authorization: await createValidAuthorizationHeader(),
        },
        body: createValidPayload(),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(countInsertMutationCalls(runMutation)).toBe(0);
  });

  it("rejects oversized payloads before attempting insert mutation", async () => {
    const runMutation = createRunMutationMock();
    const handler = (
      ingestObservabilityInfoEvent as unknown as {
        _handler: HttpActionHandler;
      }
    )._handler;

    const oversizedPayload = JSON.stringify({
      schemaVersion: 1,
      app: "daylog",
      surface: "web",
      level: "info",
      event: "oversized_event",
      timestamp: new Date("2026-04-18T10:20:30.000Z").toISOString(),
      sampleRate: 1,
      sourceEnvironment: "production",
      contextJson: "x".repeat(25_000),
    });

    const response = await handler(
      { runMutation },
      new Request("https://convex.site/observability/info-event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ALLOWED_ORIGIN,
          authorization: await createValidAuthorizationHeader(),
        },
        body: oversizedPayload,
      }),
    );

    expect(response.status).toBe(413);
    expect(countInsertMutationCalls(runMutation)).toBe(0);
  });

  it("accepts signed requests from allowlisted origins", async () => {
    const runMutation = createRunMutationMock();
    const handler = (
      ingestObservabilityInfoEvent as unknown as {
        _handler: HttpActionHandler;
      }
    )._handler;

    const response = await handler(
      { runMutation },
      new Request("https://convex.site/observability/info-event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ALLOWED_ORIGIN,
          authorization: await createValidAuthorizationHeader(),
        },
        body: createValidPayload(),
      }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
    expect(countInsertMutationCalls(runMutation)).toBe(1);
    expect(
      runMutation.mock.calls.some((call) => isRateLimitMutationArgs(call[1])),
    ).toBe(true);
  });

  it("applies CORS policy to preflight OPTIONS", async () => {
    const optionsHandler = (
      observabilityInfoEventOptions as unknown as {
        _handler: HttpActionHandler;
      }
    )._handler;

    const allowedResponse = await optionsHandler(
      {},
      new Request("https://convex.site/observability/info-event", {
        method: "OPTIONS",
        headers: {
          origin: ALLOWED_ORIGIN,
        },
      }),
    );

    expect(allowedResponse.status).toBe(204);
    expect(allowedResponse.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );

    const deniedResponse = await optionsHandler(
      {},
      new Request("https://convex.site/observability/info-event", {
        method: "OPTIONS",
        headers: {
          origin: "https://malicious.example",
        },
      }),
    );

    expect(deniedResponse.status).toBe(403);
  });
});
