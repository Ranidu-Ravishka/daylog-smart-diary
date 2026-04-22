import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as integrationsModule from "./integrations";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const USER_ID = "user_member_001" as Id<"user">;

function seededDb() {
  return createInMemoryDb({
    user: [
      {
        _id: USER_ID,
        _creationTime: 1,
        clerkUserId: "clerk_member_001",
        email: "member@example.com",
        isAdmin: false,
      },
    ],
  });
}

describe("oauth mobile handoff behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues a one-time handoff code for an OAuth provider", async () => {
    const db = seededDb();
    const begin = handler<{ provider: string }, { handoffCode: string }>(
      integrationsModule.beginOAuthMobileHandoff,
    );

    const result = await begin(createAuthCtx(db, "clerk_member_001"), {
      provider: "google_calendar",
    });

    expect(result.handoffCode).toMatch(/^[0-9a-f]{64}$/);
    const rows = db.getTable("oauthMobileHandoffs");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: result.handoffCode,
      userId: USER_ID,
      provider: "google_calendar",
    });
    expect(
      (rows[0] as unknown as { expiresAt: number }).expiresAt,
    ).toBeGreaterThan(Date.now());
  });

  it("rejects non-OAuth providers", async () => {
    const db = seededDb();
    const begin = handler<{ provider: string }, { handoffCode: string }>(
      integrationsModule.beginOAuthMobileHandoff,
    );

    await expect(
      begin(createAuthCtx(db, "clerk_member_001"), {
        provider: "apple_health",
      }),
    ).rejects.toThrow(/does not use OAuth/);
  });

  it("rejects unknown providers", async () => {
    const db = seededDb();
    const begin = handler<{ provider: string }, { handoffCode: string }>(
      integrationsModule.beginOAuthMobileHandoff,
    );

    await expect(
      begin(createAuthCtx(db, "clerk_member_001"), {
        provider: "not_a_real_provider",
      }),
    ).rejects.toThrow();
  });

  it("consumes a valid handoff code, returns userId/provider, and marks it consumed", async () => {
    const db = seededDb();
    const begin = handler<{ provider: string }, { handoffCode: string }>(
      integrationsModule.beginOAuthMobileHandoff,
    );
    const consume = handler<
      { code: string },
      { userId: Id<"user">; provider: string } | null
    >(integrationsModule.consumeOAuthMobileHandoffInternal);

    const { handoffCode } = await begin(createAuthCtx(db, "clerk_member_001"), {
      provider: "spotify",
    });

    const consumed = await consume(createAuthCtx(db, null), {
      code: handoffCode,
    });
    expect(consumed).toEqual({ userId: USER_ID, provider: "spotify" });

    const rows = db.getTable("oauthMobileHandoffs");
    expect(
      (rows[0] as unknown as { consumedAt?: number }).consumedAt,
    ).toBeGreaterThan(0);
  });

  it("returns null when consuming an unknown code", async () => {
    const db = seededDb();
    const consume = handler<
      { code: string },
      { userId: Id<"user">; provider: string } | null
    >(integrationsModule.consumeOAuthMobileHandoffInternal);

    expect(
      await consume(createAuthCtx(db, null), { code: "does_not_exist" }),
    ).toBeNull();
    // Empty / whitespace code short-circuits without a DB lookup.
    expect(await consume(createAuthCtx(db, null), { code: "   " })).toBeNull();
  });

  it("returns null when the same code is consumed twice", async () => {
    const db = seededDb();
    const begin = handler<{ provider: string }, { handoffCode: string }>(
      integrationsModule.beginOAuthMobileHandoff,
    );
    const consume = handler<
      { code: string },
      { userId: Id<"user">; provider: string } | null
    >(integrationsModule.consumeOAuthMobileHandoffInternal);

    const { handoffCode } = await begin(createAuthCtx(db, "clerk_member_001"), {
      provider: "spotify",
    });

    const first = await consume(createAuthCtx(db, null), { code: handoffCode });
    expect(first).not.toBeNull();
    const second = await consume(createAuthCtx(db, null), {
      code: handoffCode,
    });
    expect(second).toBeNull();
  });

  it("returns null when consuming an expired handoff", async () => {
    const db = seededDb();
    const begin = handler<{ provider: string }, { handoffCode: string }>(
      integrationsModule.beginOAuthMobileHandoff,
    );
    const consume = handler<
      { code: string },
      { userId: Id<"user">; provider: string } | null
    >(integrationsModule.consumeOAuthMobileHandoffInternal);

    const { handoffCode } = await begin(createAuthCtx(db, "clerk_member_001"), {
      provider: "spotify",
    });

    // Advance beyond the 10-minute TTL.
    vi.setSystemTime(new Date("2026-04-01T12:20:00.000Z"));

    expect(
      await consume(createAuthCtx(db, null), { code: handoffCode }),
    ).toBeNull();
  });

  it("purges expired handoff rows and leaves fresh ones", async () => {
    const db = seededDb();
    const begin = handler<{ provider: string }, { handoffCode: string }>(
      integrationsModule.beginOAuthMobileHandoff,
    );
    const purge = handler<{ limit?: number }, { deleted: number }>(
      integrationsModule.purgeExpiredOAuthMobileHandoffsInternal,
    );

    await begin(createAuthCtx(db, "clerk_member_001"), { provider: "spotify" });
    vi.setSystemTime(new Date("2026-04-01T12:20:00.000Z"));
    await begin(createAuthCtx(db, "clerk_member_001"), {
      provider: "google_calendar",
    });

    // Now (12:20) one row has expired and one is fresh.
    const result = await purge(createAuthCtx(db, null), {});
    expect(result.deleted).toBe(1);

    const remaining = db.getTable("oauthMobileHandoffs");
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as unknown as { provider: string }).provider).toBe(
      "google_calendar",
    );
  });

  it("clamps purge limit and supports explicit limit", async () => {
    const db = seededDb();
    const begin = handler<{ provider: string }, { handoffCode: string }>(
      integrationsModule.beginOAuthMobileHandoff,
    );
    const purge = handler<{ limit?: number }, { deleted: number }>(
      integrationsModule.purgeExpiredOAuthMobileHandoffsInternal,
    );

    await begin(createAuthCtx(db, "clerk_member_001"), { provider: "spotify" });
    await begin(createAuthCtx(db, "clerk_member_001"), {
      provider: "google_calendar",
    });
    await begin(createAuthCtx(db, "clerk_member_001"), {
      provider: "google_fit",
    });

    vi.setSystemTime(new Date("2026-04-01T12:20:00.000Z"));

    const first = await purge(createAuthCtx(db, null), { limit: 2 });
    expect(first.deleted).toBe(2);

    const second = await purge(createAuthCtx(db, null), { limit: 10 });
    expect(second.deleted).toBe(1);

    expect(db.getTable("oauthMobileHandoffs")).toHaveLength(0);
  });
});
