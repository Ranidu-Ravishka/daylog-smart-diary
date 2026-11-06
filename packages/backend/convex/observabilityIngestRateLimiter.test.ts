import { describe, expect, it } from "vitest";

import {
  evaluateObservabilityIngestRateLimitInternal,
  evaluateTokenBucket,
  fingerprintRateLimitKey,
  resolveObservabilityIngestIpKey,
  resolveObservabilityIngestRateLimitIdentity,
  resolveObservabilityIngestPrincipalKey,
} from "./observabilityIngestRateLimiter";
import { createInMemoryDb } from "../test-utils/inMemoryConvex";

type ConvexHandler = {
  _handler: (ctx: { db: ReturnType<typeof createInMemoryDb> }, args: {
    ipKey: string;
    userKey: string;
    receivedAt: number;
  }) => Promise<{
    allowed: boolean;
    blockedScopes: string[];
    retryAfterSeconds: number;
    burstAttempt: boolean;
    ipKey: string;
    userKey: string;
  }>;
};

describe("observability ingest rate limiter utility", () => {
  it("resolves sanitized ip and principal keys", () => {
    const identity = resolveObservabilityIngestRateLimitIdentity(
      new Request("https://convex.site/observability/info-event", {
        headers: {
          "x-forwarded-for": "203.0.113.24, 10.0.0.1",
        },
      }),
      "User_001:Session_01",
    );

    expect(identity).toEqual({
      ipKey: "203.0.113.24",
      userKey: "user_001:session_01",
    });
  });

  it("falls back for missing headers and sanitizes unusual principal keys", () => {
    expect(resolveObservabilityIngestIpKey(new Request("https://convex.site"))).toBe(
      "unknown",
    );
    expect(
      resolveObservabilityIngestIpKey(
        new Request("https://convex.site", {
          headers: { "x-real-ip": " 203.0.113.25 " },
        }),
      ),
    ).toBe("203.0.113.25");
    expect(resolveObservabilityIngestPrincipalKey("  ")).toBe("anonymous");
    expect(resolveObservabilityIngestPrincipalKey("User/01?x")).toBe(
      "user_01_x",
    );
  });

  it("computes retry delay when bucket has no token available", () => {
    const now = Date.parse("2026-04-18T13:00:00.000Z");
    const result = evaluateTokenBucket(0.1, now, now, 10, 2);

    expect(result.blocked).toBe(true);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("marks low remaining capacity as burst when still allowed", () => {
    const now = Date.parse("2026-04-18T13:00:00.000Z");
    const result = evaluateTokenBucket(1.2, now, now, 10, 1);

    expect(result.blocked).toBe(false);
    expect(result.burstIfAllowed).toBe(true);
  });

  it("hashes telemetry keys deterministically", () => {
    const first = fingerprintRateLimitKey("203.0.113.24");
    const second = fingerprintRateLimitKey("203.0.113.24");
    const third = fingerprintRateLimitKey("203.0.113.25");

    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it("persists allowed and blocked scope decisions with rolling metrics", async () => {
    const db = createInMemoryDb();
    const evaluate = (evaluateObservabilityIngestRateLimitInternal as unknown as ConvexHandler)
      ._handler;
    const receivedAt = Date.parse("2026-04-18T13:00:00.000Z");

    await expect(
      evaluate({ db }, { ipKey: "ip-1", userKey: "user-1", receivedAt }),
    ).resolves.toMatchObject({
      allowed: true,
      blockedScopes: [],
      burstAttempt: false,
    });

    const blockedDb = createInMemoryDb({
      observabilityIngestRateLimits: [
        {
          _id: "ip-row",
          _creationTime: 1,
          scope: "ip",
          key: "ip-1",
          tokens: 0,
          lastRefillAt: receivedAt,
          allowedRequests: 2,
          blockedRequests: 0,
          burstAttempts: 0,
        },
        {
          _id: "user-row",
          _creationTime: 2,
          scope: "user",
          key: "user-1",
          tokens: 0,
          lastRefillAt: receivedAt,
          allowedRequests: 2,
          blockedRequests: 0,
          burstAttempts: 0,
        },
      ],
    });

    const result = await evaluate(
      { db: blockedDb },
      { ipKey: "ip-1", userKey: "user-1", receivedAt },
    );
    expect(result).toMatchObject({
      allowed: false,
      blockedScopes: ["ip", "user"],
      retryAfterSeconds: 1,
      burstAttempt: true,
    });
  });
});
