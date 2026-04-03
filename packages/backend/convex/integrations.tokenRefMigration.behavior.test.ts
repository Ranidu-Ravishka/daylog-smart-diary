import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import {
  adminAuditLegacyIntegrationTokenRefsImpl,
  adminCountLegacyNonOpaqueIntegrationTokenRefsImpl,
  adminMigrateLegacyIntegrationTokenRefsAllImpl,
} from "./integrations";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";

const ORIGINAL_KEYRING_ENV = process.env.INTEGRATION_SECRETS_KEYRING_JSON;
const ORIGINAL_ACTIVE_KEY_ENV = process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID;

const ADMIN_USER_ID = "user_admin_001" as Id<"user">;
const USER_ALPHA_ID = "user_alpha_001" as Id<"user">;
const USER_BETA_ID = "user_beta_001" as Id<"user">;

const LEGACY_SPOTIFY_INTEGRATION_ID = "integration_legacy_spotify_001";
const LEGACY_GOOGLE_FIT_INTEGRATION_ID = "integration_legacy_google_fit_001";
const OPAQUE_INTEGRATION_ID = "integration_opaque_001";

const LEGACY_SPOTIFY_TOKEN_REF = "legacy_spotify_access_token_value_001";
const LEGACY_GOOGLE_FIT_TOKEN_REF = "legacy_google_fit_refresh_token_value_002";
const PREEXISTING_GOOGLE_FIT_OPAQUE_REF = "tokref_preexisting_google_fit_001";

type IntegrationDoc = {
  _id: string;
  userId: string;
  provider: string;
  status: "connected" | "disconnected" | "error";
  tokenRef?: string;
};

type IntegrationSecretDoc = {
  _id: string;
  userId: string;
  provider: string;
  tokenRef: string;
  encryptedAccessToken?: unknown;
  accessToken?: string;
};

type AuditLogDoc = {
  action: string;
};

type AdminDashboardMetricsDoc = {
  totalAuditLogs: number;
};

function seedMigrationDb() {
  const db = createInMemoryDb({
    user: [
      {
        _id: ADMIN_USER_ID,
        _creationTime: 1,
        clerkUserId: "clerk_admin_001",
        isAdmin: true,
      },
      {
        _id: USER_ALPHA_ID,
        _creationTime: 2,
        clerkUserId: "clerk_alpha_001",
        isAdmin: false,
      },
      {
        _id: USER_BETA_ID,
        _creationTime: 3,
        clerkUserId: "clerk_beta_001",
        isAdmin: false,
      },
    ],
    integrations: [
      {
        _id: LEGACY_SPOTIFY_INTEGRATION_ID,
        _creationTime: 10,
        userId: USER_ALPHA_ID,
        provider: "spotify",
        status: "connected",
        tokenRef: LEGACY_SPOTIFY_TOKEN_REF,
      },
      {
        _id: LEGACY_GOOGLE_FIT_INTEGRATION_ID,
        _creationTime: 11,
        userId: USER_BETA_ID,
        provider: "google_fit",
        status: "error",
        tokenRef: LEGACY_GOOGLE_FIT_TOKEN_REF,
      },
      {
        _id: OPAQUE_INTEGRATION_ID,
        _creationTime: 12,
        userId: USER_ALPHA_ID,
        provider: "google_calendar",
        status: "connected",
        tokenRef: "tokref_existing_opaque_001",
      },
      {
        _id: "integration_missing_token_ref_001",
        _creationTime: 13,
        userId: USER_BETA_ID,
        provider: "spotify",
        status: "disconnected",
      },
    ] as never,
    integrationSecrets: [
      {
        _id: "integration_secret_google_fit_001",
        _creationTime: 20,
        userId: USER_BETA_ID,
        provider: "google_fit",
        tokenRef: PREEXISTING_GOOGLE_FIT_OPAQUE_REF,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_123,
      },
    ] as never,
  });

  return {
    db,
    ctx: createAuthCtx(db, "clerk_admin_001"),
  };
}

function findIntegration(db: ReturnType<typeof createInMemoryDb>, id: string) {
  const row = (db.getTable("integrations") as unknown as IntegrationDoc[]).find(
    (item) => item._id === id,
  );

  if (!row) {
    throw new Error(`Missing integration row: ${id}`);
  }

  return row;
}

beforeAll(() => {
  const key = Buffer.alloc(32, 7).toString("base64url");
  process.env.INTEGRATION_SECRETS_KEYRING_JSON = JSON.stringify({
    "test-key-v1": key,
  });
  process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID = "test-key-v1";
});

afterAll(() => {
  if (ORIGINAL_KEYRING_ENV === undefined) {
    delete process.env.INTEGRATION_SECRETS_KEYRING_JSON;
  } else {
    process.env.INTEGRATION_SECRETS_KEYRING_JSON = ORIGINAL_KEYRING_ENV;
  }

  if (ORIGINAL_ACTIVE_KEY_ENV === undefined) {
    delete process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID;
  } else {
    process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID = ORIGINAL_ACTIVE_KEY_ENV;
  }
});

describe("legacy integrations.tokenRef migration behavior", () => {
  it("audits and returns non-opaque tokenRef candidates", async () => {
    const { ctx } = seedMigrationDb();

    const audit = await adminAuditLegacyIntegrationTokenRefsImpl(ctx as never, {
      pageSize: 2,
      maxPages: 10,
      maxRows: 10,
    });

    expect(audit.nonOpaqueCount).toBe(2);
    expect(audit.rows.map((row) => row.integrationId).sort()).toEqual(
      [LEGACY_GOOGLE_FIT_INTEGRATION_ID, LEGACY_SPOTIFY_INTEGRATION_ID].sort(),
    );
    expect(audit.rowsTruncated).toBe(false);
    expect(audit.opaqueTokenRefDefinition).toContain("tokref_");
  });

  it("migrates legacy tokenRefs into integrationSecrets and emits per-row audit logs", async () => {
    const { db, ctx } = seedMigrationDb();

    const before = await adminCountLegacyNonOpaqueIntegrationTokenRefsImpl(
      ctx as never,
      {},
    );
    expect(before.nonOpaqueCount).toBe(2);

    const migration = await adminMigrateLegacyIntegrationTokenRefsAllImpl(
      ctx as never,
      {
        pageSize: 10,
        maxPages: 5,
      },
    );

    expect(migration.migratedCount).toBe(2);
    expect(migration.failedCount).toBe(0);
    expect(migration.auditLogCount).toBe(2);

    const spotifyIntegration = findIntegration(
      db,
      LEGACY_SPOTIFY_INTEGRATION_ID,
    );
    const googleFitIntegration = findIntegration(
      db,
      LEGACY_GOOGLE_FIT_INTEGRATION_ID,
    );

    expect(spotifyIntegration.tokenRef).toMatch(/^tokref_/);
    expect(spotifyIntegration.tokenRef).not.toBe(LEGACY_SPOTIFY_TOKEN_REF);

    expect(googleFitIntegration.tokenRef).toBe(
      PREEXISTING_GOOGLE_FIT_OPAQUE_REF,
    );

    const secrets = db.getTable(
      "integrationSecrets",
    ) as unknown as IntegrationSecretDoc[];

    const spotifySecret = secrets.find(
      (row) => row.userId === USER_ALPHA_ID && row.provider === "spotify",
    );
    expect(spotifySecret?.tokenRef).toBe(spotifyIntegration.tokenRef);
    expect(spotifySecret?.encryptedAccessToken).toBeDefined();
    expect(spotifySecret?.accessToken).toBeUndefined();

    const googleFitSecret = secrets.find(
      (row) => row.userId === USER_BETA_ID && row.provider === "google_fit",
    );
    expect(googleFitSecret?.tokenRef).toBe(PREEXISTING_GOOGLE_FIT_OPAQUE_REF);
    expect(googleFitSecret?.encryptedAccessToken).toBeDefined();

    const auditLogs = db.getTable("auditLogs") as unknown as AuditLogDoc[];
    expect(
      auditLogs.filter(
        (row) => row.action === "migrate_legacy_integration_token_ref",
      ),
    ).toHaveLength(2);

    const metrics = db.getTable(
      "adminDashboardMetrics",
    ) as unknown as AdminDashboardMetricsDoc[];
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.totalAuditLogs).toBe(2);
  });

  it("is idempotent on rerun and verifies remaining non-opaque count is zero", async () => {
    const { db, ctx } = seedMigrationDb();

    await adminMigrateLegacyIntegrationTokenRefsAllImpl(ctx as never, {
      pageSize: 10,
      maxPages: 5,
    });

    const rerun = await adminMigrateLegacyIntegrationTokenRefsAllImpl(
      ctx as never,
      {
        pageSize: 10,
        maxPages: 5,
      },
    );

    expect(rerun.migratedCount).toBe(0);
    expect(rerun.failedCount).toBe(0);
    expect(rerun.auditLogCount).toBe(0);

    const verification =
      await adminCountLegacyNonOpaqueIntegrationTokenRefsImpl(ctx as never, {});
    expect(verification.nonOpaqueCount).toBe(0);

    const auditLogs = db.getTable("auditLogs") as unknown as AuditLogDoc[];
    expect(
      auditLogs.filter(
        (row) => row.action === "migrate_legacy_integration_token_ref",
      ),
    ).toHaveLength(2);
  });
});
