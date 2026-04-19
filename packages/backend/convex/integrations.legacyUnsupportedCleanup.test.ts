import { describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import {
  adminCleanupLegacyUnsupportedIntegrationsImpl,
  adminCountLegacyUnsupportedIntegrationsImpl,
  cleanupLegacyUnsupportedIntegrationsInternal,
  listMyIntegrationsImpl,
} from "./integrations";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";

const ADMIN_USER_ID = "user_admin_legacy_cleanup_001" as Id<"user">;
const USER_ID = "user_member_legacy_cleanup_001" as Id<"user">;

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

type IntegrationDoc = {
  _id: string;
  userId: string;
  provider: string;
  status: "connected" | "disconnected" | "error";
  tokenRef?: unknown;
  scopes?: unknown;
  lastSyncAt?: unknown;
  lastError?: unknown;
  legacyUnsupported?: unknown;
};

function seedDb() {
  const db = createInMemoryDb({
    user: [
      {
        _id: ADMIN_USER_ID,
        _creationTime: 1,
        clerkUserId: "clerk_admin_legacy_cleanup_001",
        isAdmin: true,
      },
      {
        _id: USER_ID,
        _creationTime: 2,
        clerkUserId: "clerk_user_legacy_cleanup_001",
        isAdmin: false,
      },
    ],
    integrations: [
      {
        _id: "integration_slack_legacy_001",
        _creationTime: 10,
        userId: USER_ID,
        provider: "slack",
        status: "connected",
        tokenRef: "tokref_slack_secret_001",
        scopes: ["search:read"],
        lastSyncAt: 1_700_000_000_000,
      },
      {
        _id: "integration_strava_legacy_001",
        _creationTime: 11,
        userId: USER_ID,
        provider: "strava",
        status: "error",
        tokenRef: "tokref_strava_secret_001",
        lastError: "old provider error",
      },
      {
        _id: "integration_todoist_legacy_001",
        _creationTime: 12,
        userId: USER_ID,
        provider: "todoist",
        status: "disconnected",
        tokenRef: undefined,
        lastSyncAt: undefined,
        lastError:
          "This integration provider is no longer supported and has been automatically disconnected.",
        legacyUnsupported: true,
        legacyUnsupportedAt: 1_700_000_000_111,
        legacyUnsupportedReason:
          "This integration provider is no longer supported and has been automatically disconnected.",
      },
      {
        _id: "integration_spotify_supported_001",
        _creationTime: 13,
        userId: USER_ID,
        provider: "spotify",
        status: "connected",
        tokenRef: "tokref_spotify_secret_001",
      },
    ] as never,
    integrationSecrets: [
      {
        _id: "integration_secret_slack_001",
        _creationTime: 20,
        userId: USER_ID,
        provider: "slack",
        tokenRef: "tokref_slack_secret_001",
        encryptedAccessToken: {
          keyId: "test-key",
          ciphertext: "cipher",
          iv: "iv",
          authTag: "tag",
          algorithm: "aes-256-gcm",
          version: 1,
        },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "integration_secret_strava_001",
        _creationTime: 21,
        userId: USER_ID,
        provider: "strava",
        tokenRef: "tokref_strava_secret_001",
        encryptedAccessToken: {
          keyId: "test-key",
          ciphertext: "cipher",
          iv: "iv",
          authTag: "tag",
          algorithm: "aes-256-gcm",
          version: 1,
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ] as never,
    integrationSyncRuns: [
      {
        _id: "integration_sync_run_slack_001",
        _creationTime: 30,
        userId: USER_ID,
        provider: "slack",
        dayKey: "2026-04-18",
        status: "error",
        startedAt: 1,
        updatedAt: 1,
        lastError: "legacy sync failed",
      },
      {
        _id: "integration_sync_run_strava_001",
        _creationTime: 31,
        userId: USER_ID,
        provider: "strava",
        dayKey: "2026-04-18",
        status: "error",
        startedAt: 1,
        updatedAt: 1,
        lastError: "legacy sync failed",
      },
      {
        _id: "integration_sync_run_spotify_001",
        _creationTime: 32,
        userId: USER_ID,
        provider: "spotify",
        dayKey: "2026-04-18",
        status: "success",
        startedAt: 1,
        updatedAt: 1,
      },
    ] as never,
  });

  return {
    db,
    adminCtx: createAuthCtx(db, "clerk_admin_legacy_cleanup_001"),
    userCtx: createAuthCtx(db, "clerk_user_legacy_cleanup_001"),
  };
}

function getIntegrationByProvider(
  db: ReturnType<typeof createInMemoryDb>,
  provider: string,
) {
  return (
    (db.getTable("integrations") as unknown as IntegrationDoc[]).find(
      (row) => row.provider === provider,
    ) ?? null
  );
}

describe("legacy unsupported integrations cleanup", () => {
  it("reports legacy unsupported integration metrics for admin visibility", async () => {
    const { adminCtx } = seedDb();

    const counts = await adminCountLegacyUnsupportedIntegrationsImpl(
      adminCtx as never,
    );

    expect(counts.totalRows).toBe(3);
    expect(counts.pendingCleanupRows).toBe(2);
    expect(counts.softDeletedRows).toBe(1);
    expect(counts.affectedUsers).toBe(1);
    expect(counts.rowsByProvider).toEqual({
      slack: 1,
      strava: 1,
      todoist: 1,
    });
  });

  it("soft-cleans unsupported providers, removes secrets/sync metadata, and is idempotent", async () => {
    const { db, adminCtx, userCtx } = seedDb();

    const result = await adminCleanupLegacyUnsupportedIntegrationsImpl(
      adminCtx as never,
      {
        batchSizePerProvider: 1,
        maxPasses: 1,
      },
    );

    expect(result.force).toBe(false);
    expect(result.matchedRows).toBe(2);
    expect(result.softDeletedRows).toBe(2);
    expect(result.hardDeletedRows).toBe(0);
    expect(result.deletedSecretRows).toBe(2);
    expect(result.deletedSyncRunRows).toBe(2);
    expect(result.isDone).toBe(true);

    const slack = getIntegrationByProvider(db, "slack");
    const strava = getIntegrationByProvider(db, "strava");
    const spotify = getIntegrationByProvider(db, "spotify");

    expect(slack?.status).toBe("disconnected");
    expect(slack?.tokenRef).toBeUndefined();
    expect(slack?.scopes).toBeUndefined();
    expect(slack?.legacyUnsupported).toBe(true);

    expect(strava?.status).toBe("disconnected");
    expect(strava?.tokenRef).toBeUndefined();
    expect(strava?.legacyUnsupported).toBe(true);

    expect(spotify?.status).toBe("connected");
    expect(spotify?.tokenRef).toBe("tokref_spotify_secret_001");

    expect(
      (
        db.getTable("integrationSecrets") as unknown as Array<{
          provider: string;
        }>
      ).map((row) => row.provider),
    ).toEqual([]);

    expect(
      (
        db.getTable("integrationSyncRuns") as unknown as Array<{
          provider: string;
        }>
      ).map((row) => row.provider),
    ).toEqual(["spotify"]);

    const visibleIntegrations = await listMyIntegrationsImpl(userCtx as never);
    expect(visibleIntegrations.map((row) => row.provider)).toEqual(["spotify"]);

    const rerun = await adminCleanupLegacyUnsupportedIntegrationsImpl(
      adminCtx as never,
      {
        batchSizePerProvider: 1,
        maxPasses: 1,
      },
    );

    expect(rerun.matchedRows).toBe(0);
    expect(rerun.softDeletedRows).toBe(0);
    expect(rerun.deletedSecretRows).toBe(0);
    expect(rerun.deletedSyncRunRows).toBe(0);
  });

  it("hard deletes unsupported integrations when force=true", async () => {
    const { db, adminCtx } = seedDb();

    const result = await adminCleanupLegacyUnsupportedIntegrationsImpl(
      adminCtx as never,
      {
        force: true,
        batchSizePerProvider: 5,
        maxPasses: 1,
      },
    );

    expect(result.force).toBe(true);
    expect(result.hardDeletedRows).toBe(3);
    expect(result.softDeletedRows).toBe(0);

    const providers = (
      db.getTable("integrations") as unknown as Array<{
        provider: string;
      }>
    ).map((row) => row.provider);
    expect(providers).toEqual(["spotify"]);

    const countsAfter = await adminCountLegacyUnsupportedIntegrationsImpl(
      adminCtx as never,
    );

    expect(countsAfter.totalRows).toBe(0);
    expect(countsAfter.pendingCleanupRows).toBe(0);
    expect(countsAfter.rowsByProvider).toEqual({
      slack: 0,
      strava: 0,
      todoist: 0,
    });
  });

  it("supports cursor-based continuation for large provider batches", async () => {
    const { db, adminCtx } = seedDb();

    await db.insert("integrations", {
      userId: USER_ID,
      provider: "slack",
      status: "connected",
      tokenRef: "tokref_slack_secret_002",
    } as never);

    const firstRun = await adminCleanupLegacyUnsupportedIntegrationsImpl(
      adminCtx as never,
      {
        batchSizePerProvider: 1,
        maxPasses: 1,
      },
    );

    expect(firstRun.isDone).toBe(false);
    expect(firstRun.nextCursorByProvider.slack).toBeTruthy();

    const secondRun = await adminCleanupLegacyUnsupportedIntegrationsImpl(
      adminCtx as never,
      {
        batchSizePerProvider: 1,
        maxPasses: 1,
        cursorByProvider: {
          slack: firstRun.nextCursorByProvider.slack ?? undefined,
          strava: firstRun.nextCursorByProvider.strava ?? undefined,
          todoist: firstRun.nextCursorByProvider.todoist ?? undefined,
        },
      },
    );

    expect(secondRun.isDone).toBe(true);
    expect(secondRun.nextCursorByProvider.slack).toBeNull();
    expect(secondRun.matchedRows).toBeGreaterThanOrEqual(1);
  });

  it("resumes scheduled cleanup from persisted cursor state", async () => {
    const { db } = seedDb();

    const runInternalCleanup = handler<
      {
        batchSizePerProvider?: number;
        maxPasses?: number;
        force?: boolean;
        cursorByProvider?: {
          slack?: string;
          strava?: string;
          todoist?: string;
        };
      },
      {
        isDone: boolean;
        matchedRows: number;
        nextCursorByProvider: {
          slack: string | null;
          strava: string | null;
          todoist: string | null;
        };
      }
    >(cleanupLegacyUnsupportedIntegrationsInternal);

    await db.insert("integrations", {
      userId: USER_ID,
      provider: "slack",
      status: "connected",
      tokenRef: "tokref_slack_secret_002",
    } as never);

    const firstRun = await runInternalCleanup({ db } as never, {
      batchSizePerProvider: 1,
      maxPasses: 1,
      force: false,
    });

    expect(firstRun.isDone).toBe(false);
    expect(firstRun.nextCursorByProvider.slack).toBeTruthy();

    const persistedStateEvents = (
      db.getTable("platformAuditEvents") as unknown as Array<{
        action: string;
        details?: string;
      }>
    ).filter(
      (event) =>
        event.action === "cleanup_legacy_unsupported_integrations_cursor_state",
    );

    expect(persistedStateEvents.length).toBeGreaterThan(0);

    const secondRun = await runInternalCleanup({ db } as never, {
      batchSizePerProvider: 1,
      maxPasses: 1,
      force: false,
    });

    expect(secondRun.isDone).toBe(true);
    expect(secondRun.nextCursorByProvider.slack).toBeNull();
    expect(secondRun.matchedRows).toBeGreaterThanOrEqual(1);
  });
});
