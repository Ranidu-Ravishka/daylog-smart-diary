import { describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import {
  deriveTokenValidityStatus,
  recordIntegrationHealthEventInDb,
} from "./integrationHealth";
import * as integrationHealthModule from "./integrationHealth";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const ADMIN_ID = "user_admin_001" as Id<"user">;
const MEMBER_ID = "user_member_001" as Id<"user">;

function seededDb() {
  return createInMemoryDb({
    user: [
      {
        _id: ADMIN_ID,
        _creationTime: 1,
        clerkUserId: "clerk_admin_001",
        email: "admin@example.com",
        isAdmin: true,
      },
      {
        _id: MEMBER_ID,
        _creationTime: 2,
        clerkUserId: "clerk_member_001",
        email: "member@example.com",
        isAdmin: false,
      },
    ],
    integrations: [
      {
        _id: "integration_member_spotify_001",
        _creationTime: 3,
        userId: MEMBER_ID,
        provider: "spotify",
        status: "connected",
        lastSyncAt: 100,
      },
    ],
  });
}

describe("integration health behavior", () => {
  it("derives token validity status from expiration windows", () => {
    const now = Date.parse("2026-04-03T12:00:00.000Z");

    expect(deriveTokenValidityStatus(undefined, now)).toBe("unknown");
    expect(deriveTokenValidityStatus(now - 1, now)).toBe("expired");
    expect(deriveTokenValidityStatus(now + 30 * 60 * 1000, now)).toBe(
      "expiring_soon",
    );
    expect(deriveTokenValidityStatus(now + 2 * 60 * 60 * 1000, now)).toBe(
      "valid",
    );
  });

  it("records provider health events and exposes summaries through queries", async () => {
    const db = seededDb();

    await recordIntegrationHealthEventInDb(db as never, {
      provider: "spotify",
      userId: MEMBER_ID,
      integrationId: "integration_member_spotify_001" as Id<"integrations">,
      dayKey: "2026-04-01",
      outcome: "success",
      tokenValidityStatus: "valid",
      latencyMs: 200,
    });

    await recordIntegrationHealthEventInDb(db as never, {
      provider: "spotify",
      userId: MEMBER_ID,
      integrationId: "integration_member_spotify_001" as Id<"integrations">,
      dayKey: "2026-04-02",
      outcome: "error",
      tokenValidityStatus: "expired",
      error: "x".repeat(300),
      latencyMs: 300,
    });

    expect(db.getTable("integrationProviderHealth")).toHaveLength(1);
    expect(db.getTable("integrationHealthEvents")).toHaveLength(2);
    expect(db.getTable("platformAuditEvents")).toHaveLength(1);

    const listIntegrationProviderHealth = handler<
      { limit?: number; status?: "connected" | "degraded" | "failed" },
      Array<{ provider: string; status: string }>
    >(integrationHealthModule.listIntegrationProviderHealth);

    const allHealth = await listIntegrationProviderHealth(
      createAuthCtx(db, "clerk_admin_001"),
      { limit: 10 },
    );
    expect(allHealth[0]?.provider).toBe("spotify");

    const failedOnly = await listIntegrationProviderHealth(
      createAuthCtx(db, "clerk_admin_001"),
      { status: "failed", limit: 10 },
    );
    expect(failedOnly).toHaveLength(1);

    const listIntegrationProviderHealthPaginated = handler<
      {
        paginationOpts: { numItems: number; cursor: string | null };
        status?: "connected" | "degraded" | "failed";
      },
      { page: Array<{ provider: string }> }
    >(integrationHealthModule.listIntegrationProviderHealthPaginated);

    const page = await listIntegrationProviderHealthPaginated(
      createAuthCtx(db, "clerk_admin_001"),
      {
        paginationOpts: { numItems: 5, cursor: null },
      },
    );
    expect(page.page).toHaveLength(1);

    const getIntegrationHealthSummary = handler<
      Record<string, never>,
      {
        connected: number;
        degraded: number;
        failed: number;
        totalProviders: number;
      }
    >(integrationHealthModule.getIntegrationHealthSummary);

    const summary = await getIntegrationHealthSummary(
      createAuthCtx(db, "clerk_admin_001"),
      {},
    );
    expect(summary.totalProviders).toBe(1);
    expect(summary.failed).toBe(1);

    const listIntegrationHealthEventsForProvider = handler<
      {
        provider: string;
        paginationOpts: { numItems: number; cursor: string | null };
      },
      { page: Array<{ provider: string }> }
    >(integrationHealthModule.listIntegrationHealthEventsForProvider);

    const events = await listIntegrationHealthEventsForProvider(
      createAuthCtx(db, "clerk_admin_001"),
      {
        provider: "spotify",
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(events.page).toHaveLength(2);

    const listMyIntegrationHealth = handler<
      Record<string, never>,
      Array<{ provider: string; health: unknown }>
    >(integrationHealthModule.listMyIntegrationHealth);

    const myHealth = await listMyIntegrationHealth(
      createAuthCtx(db, "clerk_member_001"),
      {},
    );
    expect(myHealth[0]?.provider).toBe("spotify");
    expect(myHealth[0]?.health).toBeTruthy();
  });
});
