import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

const PRIMARY_JWT_SECRET = "test_observability_jwt_secret_primary_value_123456";
const ROTATED_JWT_SECRET = "test_observability_jwt_secret_rotated_value_654321";
const ALLOWED_ORIGIN = "https://app.daylog.test";

type TokenPayload = {
  sub: string;
  sid: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
};

function makeRequest(origin?: string): NextRequest {
  const headers = new Headers();
  if (origin) {
    headers.set("origin", origin);
  }

  return new NextRequest("https://app.daylog.test/api/observability/token", {
    method: "POST",
    headers,
  });
}

async function loadRouteModule() {
  return await import("./route");
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

function decodePart(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe.sequential("/api/observability/token", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.stubEnv("NODE_ENV", "test");
    process.env.OBSERVABILITY_INGEST_ALLOWED_ORIGINS = ALLOWED_ORIGIN;
    process.env.OBSERVABILITY_INGEST_JWT_SECRETS = PRIMARY_JWT_SECRET;
  });

  it("returns 401 for unauthenticated callers", async () => {
    authMock.mockResolvedValue({ userId: null, sessionId: null });

    const { POST } = await loadRouteModule();
    const response = await POST(makeRequest(ALLOWED_ORIGIN));

    expect(response.status).toBe(401);
  });

  it("rejects missing origin", async () => {
    authMock.mockResolvedValue({ userId: "user_1", sessionId: "sess_1" });

    const { POST } = await loadRouteModule();
    const response = await POST(makeRequest());

    expect(response.status).toBe(403);
  });

  it("issues a short-lived signed token for authenticated requests", async () => {
    authMock.mockResolvedValue({ userId: "user_1", sessionId: "sess_1" });

    const { POST } = await loadRouteModule();
    const response = await POST(makeRequest(ALLOWED_ORIGIN));

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      token: string;
      issuedAt: number;
      expiresAt: number;
    };

    expect(typeof payload.token).toBe("string");
    expect(payload.expiresAt).toBeGreaterThan(payload.issuedAt);

    const [headerPart, bodyPart, signaturePart] = payload.token.split(".");
    expect(headerPart).toBeTruthy();
    expect(bodyPart).toBeTruthy();
    expect(signaturePart).toBeTruthy();

    const header = decodePart(headerPart!) as {
      alg: string;
      typ: string;
    };
    const body = decodePart(bodyPart!) as TokenPayload;

    expect(header.alg).toBe("HS256");
    expect(header.typ).toBe("JWT");
    expect(body.sub).toBe("user_1");
    expect(body.sid).toBe("sess_1");
    expect(typeof body.jti).toBe("string");
    expect(body.jti.length).toBeGreaterThan(0);
    expect(body.iss).toBe("daylog-observability-token");
    expect(body.aud).toBe("daylog-observability-ingest");
    expect(body.exp - body.iat).toBeLessThanOrEqual(300);

    const expectedSignature = await signJwtInput(
      `${headerPart}.${bodyPart}`,
      PRIMARY_JWT_SECRET,
    );

    expect(signaturePart).toBe(expectedSignature);
  });

  it("always signs with the first configured secret", async () => {
    process.env.OBSERVABILITY_INGEST_JWT_SECRETS = `${PRIMARY_JWT_SECRET},${ROTATED_JWT_SECRET}`;
    authMock.mockResolvedValue({ userId: "user_1", sessionId: "sess_1" });

    const { POST } = await loadRouteModule();
    const response = await POST(makeRequest(ALLOWED_ORIGIN));
    const payload = (await response.json()) as { token: string };

    const [headerPart, bodyPart, signaturePart] = payload.token.split(".");

    const primarySignature = await signJwtInput(
      `${headerPart}.${bodyPart}`,
      PRIMARY_JWT_SECRET,
    );
    const rotatedSignature = await signJwtInput(
      `${headerPart}.${bodyPart}`,
      ROTATED_JWT_SECRET,
    );

    expect(signaturePart).toBe(primarySignature);
    expect(signaturePart).not.toBe(rotatedSignature);
  });
});
