import { describe, expect, it } from "vitest";

import {
  evaluateTokenBucket,
  fingerprintRateLimitKey,
  resolveObservabilityIngestRateLimitIdentity,
} from "./observabilityIngestRateLimiter";

describe("observability ingest rate limiter utility", () => {
  it("resolves sanitized ip and user keys from request headers", () => {
    const identity = resolveObservabilityIngestRateLimitIdentity(
      new Request("https://convex.site/observability/info-event", {
        headers: {
          "x-forwarded-for": "203.0.113.24, 10.0.0.1",
          "x-daylog-user-id": "User_001",
        },
      }),
    );

    expect(identity).toEqual({
      ipKey: "203.0.113.24",
      userKey: "user_001",
    });
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
});
