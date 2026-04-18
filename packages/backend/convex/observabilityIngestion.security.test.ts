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

const VALID_INGEST_TOKEN = "test_ingest_token_1234567890abcdef";
const ALLOWED_ORIGIN = "https://app.daylog.test";

const ORIGINAL_ENV = {
  DAYLOG_APP_ENV: process.env.DAYLOG_APP_ENV,
  APP_ENV: process.env.APP_ENV,
  DEPLOY_ENV: process.env.DEPLOY_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
  NODE_ENV: process.env.NODE_ENV,
  OBSERVABILITY_INGEST_TOKEN: process.env.OBSERVABILITY_INGEST_TOKEN,
  OBSERVABILITY_INGEST_ALLOWED_ORIGINS:
    process.env.OBSERVABILITY_INGEST_ALLOWED_ORIGINS,
};

type HttpActionHandler = (ctx: unknown, request: Request) => Promise<Response>;

function setSecurityEnv(overrides?: {
  appEnv?: string;
  ingestToken?: string;
  allowedOrigins?: string;
}) {
  process.env.DAYLOG_APP_ENV = overrides?.appEnv ?? "production";
  process.env.APP_ENV = "";
  process.env.DEPLOY_ENV = "";
  process.env.VERCEL_ENV = "";
  process.env.NODE_ENV = "test";
  process.env.OBSERVABILITY_INGEST_TOKEN =
    overrides?.ingestToken ?? VALID_INGEST_TOKEN;
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

  if (ORIGINAL_ENV.OBSERVABILITY_INGEST_TOKEN === undefined) {
    delete process.env.OBSERVABILITY_INGEST_TOKEN;
  } else {
    process.env.OBSERVABILITY_INGEST_TOKEN =
      ORIGINAL_ENV.OBSERVABILITY_INGEST_TOKEN;
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

describe.sequential("observability ingest security", () => {
  beforeEach(() => {
    setSecurityEnv();
  });

  afterAll(() => {
    restoreEnvironment();
  });

  it("allows configured origin and denies unknown origin", () => {
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
    expect(
      denied.responseHeaders["Access-Control-Allow-Origin"],
    ).toBeUndefined();
  });

  it("requires valid ingest token", () => {
    const unauthorized = verifyObservabilityIngestAuth(
      new Request("https://convex.site/observability/info-event", {
        method: "POST",
      }),
    );

    expect(unauthorized.ok).toBe(false);
    if (!unauthorized.ok) {
      expect(unauthorized.status).toBe(401);
    }

    const authorized = verifyObservabilityIngestAuth(
      new Request("https://convex.site/observability/info-event", {
        method: "POST",
        headers: {
          "x-daylog-ingest-token": VALID_INGEST_TOKEN,
        },
      }),
    );

    expect(authorized.ok).toBe(true);
  });

  it("rejects invalid origin before attempting mutation", async () => {
    const runMutation = vi.fn(async () => undefined);
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
          "x-daylog-ingest-token": VALID_INGEST_TOKEN,
        },
        body: createValidPayload(),
      }),
    );

    expect(response.status).toBe(403);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("rejects unsigned requests before attempting mutation", async () => {
    const runMutation = vi.fn(async () => undefined);
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

  it("rejects oversized payloads before attempting mutation", async () => {
    const runMutation = vi.fn(async () => undefined);
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
          "x-daylog-ingest-token": VALID_INGEST_TOKEN,
        },
        body: oversizedPayload,
      }),
    );

    expect(response.status).toBe(413);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("accepts signed requests from allowlisted origins", async () => {
    const runMutation = vi.fn(async () => undefined);
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
          "x-daylog-ingest-token": VALID_INGEST_TOKEN,
        },
        body: createValidPayload(),
      }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
    expect(runMutation).toHaveBeenCalledTimes(1);
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
