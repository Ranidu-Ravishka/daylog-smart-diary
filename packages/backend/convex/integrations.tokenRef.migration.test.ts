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
const EMPTY_TOKEN_REF_INTEGRATION_ID = "integration_empty_token_ref_001";
const WHITESPACE_TOKEN_REF_INTEGRATION_ID =
  "integration_whitespace_token_ref_001";
const NON_STRING_TOKEN_REF_INTEGRATION_ID =
  "integration_non_string_token_ref_001";
const ALREADY_MIGRATED_INTEGRATION_ID = "integration_opaque_001";
const MISSING_TOKEN_REF_INTEGRATION_ID = "integration_missing_token_ref_001";

const LEGACY_SPOTIFY_TOKEN_REF = "legacy_spotify_access_token_value_001";
const LEGACY_GOOGLE_FIT_MALFORMED_TOKEN_REF = "tokreflegacy_without_underscore";
const PREEXISTING_GOOGLE_FIT_OPAQUE_REF = "tokref_preexisting_google_fit_001";
const EXISTING_OPAQUE_TOKEN_REF = "tokref_existing_opaque_001";

type IntegrationDoc = {
  _id: string;
  userId: string;
  provider: string;
  status: "connected" | "disconnected" | "error";
  tokenRef?: unknown;
};

type IntegrationSecretDoc = {
  _id: string;
  userId: string;
  provider: string;
  tokenRef: string;
  encryptedAccessToken?: unknown;
};

type AuditLogDoc = {
  action: string;
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
        tokenRef: LEGACY_GOOGLE_FIT_MALFORMED_TOKEN_REF,
      },
      {
        _id: EMPTY_TOKEN_REF_INTEGRATION_ID,
        _creationTime: 12,
        userId: USER_ALPHA_ID,
        provider: "google_fit",
        status: "disconnected",
        tokenRef: "",
      },
      {
        _id: WHITESPACE_TOKEN_REF_INTEGRATION_ID,
        _creationTime: 13,
        userId: USER_ALPHA_ID,
        provider: "spotify",
        status: "disconnected",
        tokenRef: "   ",
      },
      {
        _id: NON_STRING_TOKEN_REF_INTEGRATION_ID,
        _creationTime: 14,
        userId: USER_BETA_ID,
        provider: "spotify",
        status: "disconnected",
        tokenRef: 42,
      },
      {
        _id: ALREADY_MIGRATED_INTEGRATION_ID,
        _creationTime: 15,
        userId: USER_ALPHA_ID,
        provider: "google_calendar",
        status: "connected",
        tokenRef: EXISTING_OPAQUE_TOKEN_REF,
      },
      {
        _id: MISSING_TOKEN_REF_INTEGRATION_ID,
        _creationTime: 16,
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
      {
        _id: "integration_secret_google_calendar_001",
        _creationTime: 21,
        userId: USER_ALPHA_ID,
        provider: "google_calendar",
        tokenRef: EXISTING_OPAQUE_TOKEN_REF,
        createdAt: 1_700_000_000_456,
        updatedAt: 1_700_000_000_789,
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

describe("integrations tokenRef migration regression suite", () => {
  it("detects non-opaque tokenRef rows while classifying empty and malformed values", async () => {
    const { ctx } = seedMigrationDb();

    const audit = await adminAuditLegacyIntegrationTokenRefsImpl(ctx as never, {
      pageSize: 2,
      maxPages: 10,
      maxRows: 10,
    });

    expect(audit.totalRows).toBe(7);
    expect(audit.nonOpaqueCount).toBe(2);
    expect(audit.opaqueCount).toBe(1);
    expect(audit.missingTokenRefRows).toBe(4);
    expect(audit.rowsTruncated).toBe(false);

    expect(audit.rows.map((row) => row.integrationId).sort()).toEqual(
      [LEGACY_GOOGLE_FIT_INTEGRATION_ID, LEGACY_SPOTIFY_INTEGRATION_ID].sort(),
    );

    expect(audit.opaqueTokenRefDefinition).toContain("tokref_");
  });

  it("migrates legacy tokenRefs to opaque references and preserves secret integrity", async () => {
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
    const alreadyMigrated = findIntegration(
      db,
      ALREADY_MIGRATED_INTEGRATION_ID,
    );

    expect(typeof spotifyIntegration.tokenRef).toBe("string");
    expect(String(spotifyIntegration.tokenRef)).toMatch(/^tokref_/);
    expect(spotifyIntegration.tokenRef).not.toBe(LEGACY_SPOTIFY_TOKEN_REF);

    expect(googleFitIntegration.tokenRef).toBe(
      PREEXISTING_GOOGLE_FIT_OPAQUE_REF,
    );
    expect(alreadyMigrated.tokenRef).toBe(EXISTING_OPAQUE_TOKEN_REF);

    const secrets = db.getTable(
      "integrationSecrets",
    ) as unknown as IntegrationSecretDoc[];

    const spotifySecret = secrets.find(
      (row) => row.userId === USER_ALPHA_ID && row.provider === "spotify",
    );
    expect(spotifySecret?.tokenRef).toBe(spotifyIntegration.tokenRef);
    expect(spotifySecret?.encryptedAccessToken).toBeDefined();
    expect(spotifySecret ? "accessToken" in spotifySecret : false).toBe(false);

    const googleFitSecret = secrets.find(
      (row) => row.userId === USER_BETA_ID && row.provider === "google_fit",
    );
    expect(googleFitSecret?.tokenRef).toBe(PREEXISTING_GOOGLE_FIT_OPAQUE_REF);
    expect(googleFitSecret?.encryptedAccessToken).toBeDefined();

    expect(
      secrets.some(
        (row) =>
          row.tokenRef === LEGACY_SPOTIFY_TOKEN_REF ||
          row.tokenRef === LEGACY_GOOGLE_FIT_MALFORMED_TOKEN_REF,
      ),
    ).toBe(false);
  });

  it("is idempotent when rerun and does not duplicate rows or audit logs", async () => {
    const { db, ctx } = seedMigrationDb();

    await adminMigrateLegacyIntegrationTokenRefsAllImpl(ctx as never, {
      pageSize: 10,
      maxPages: 5,
    });

    const firstSecretsCount = (
      db.getTable("integrationSecrets") as unknown as IntegrationSecretDoc[]
    ).length;
    const firstAuditLogCount = (
      db.getTable("auditLogs") as unknown as AuditLogDoc[]
    ).filter(
      (row) => row.action === "migrate_legacy_integration_token_ref",
    ).length;
    const firstSpotifyTokenRef = findIntegration(
      db,
      LEGACY_SPOTIFY_INTEGRATION_ID,
    ).tokenRef;

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

    const secondSecretsCount = (
      db.getTable("integrationSecrets") as unknown as IntegrationSecretDoc[]
    ).length;
    const secondAuditLogCount = (
      db.getTable("auditLogs") as unknown as AuditLogDoc[]
    ).filter(
      (row) => row.action === "migrate_legacy_integration_token_ref",
    ).length;
    const secondSpotifyTokenRef = findIntegration(
      db,
      LEGACY_SPOTIFY_INTEGRATION_ID,
    ).tokenRef;

    expect(secondSecretsCount).toBe(firstSecretsCount);
    expect(secondAuditLogCount).toBe(firstAuditLogCount);
    expect(secondSpotifyTokenRef).toBe(firstSpotifyTokenRef);
  });

  it("post-check returns zero invalid rows after successful migration", async () => {
    const { ctx } = seedMigrationDb();

    await adminMigrateLegacyIntegrationTokenRefsAllImpl(ctx as never, {
      pageSize: 10,
      maxPages: 5,
    });

    const postAudit = await adminAuditLegacyIntegrationTokenRefsImpl(
      ctx as never,
      {
        pageSize: 10,
        maxPages: 5,
        maxRows: 10,
      },
    );

    expect(postAudit.nonOpaqueCount).toBe(0);
    expect(postAudit.rows).toHaveLength(0);

    const verification =
      await adminCountLegacyNonOpaqueIntegrationTokenRefsImpl(ctx as never, {});
    expect(verification.nonOpaqueCount).toBe(0);
  });

  it("leaves empty tokenRef, whitespace tokenRef, and non-string tokenRef rows untouched", async () => {
    const { db, ctx } = seedMigrationDb();

    await adminMigrateLegacyIntegrationTokenRefsAllImpl(ctx as never, {
      pageSize: 10,
      maxPages: 5,
    });

    expect(findIntegration(db, EMPTY_TOKEN_REF_INTEGRATION_ID).tokenRef).toBe(
      "",
    );
    expect(
      findIntegration(db, WHITESPACE_TOKEN_REF_INTEGRATION_ID).tokenRef,
    ).toBe("   ");
    expect(
      findIntegration(db, NON_STRING_TOKEN_REF_INTEGRATION_ID).tokenRef,
    ).toBe(42);
    expect(findIntegration(db, MISSING_TOKEN_REF_INTEGRATION_ID).tokenRef).toBe(
      undefined,
    );
  });
});
