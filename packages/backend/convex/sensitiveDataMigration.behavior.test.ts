import { afterEach, describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import { isSensitiveDataEnvelope } from "./sensitiveDataCrypto";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as migrationModule from "./sensitiveDataMigration";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const ADMIN_USER_ID = "user_admin_001" as Id<"user">;
const MEMBER_USER_ID = "user_member_001" as Id<"user">;

const ORIGINAL_KEYRING_ENV = process.env.SENSITIVE_DATA_KEYRING_JSON;
const ORIGINAL_ACTIVE_KEY_ENV = process.env.SENSITIVE_DATA_ACTIVE_KEY_ID;

function setKeyring(activeKeyId: string, entries: Record<string, string>) {
  process.env.SENSITIVE_DATA_KEYRING_JSON = JSON.stringify(entries);
  process.env.SENSITIVE_DATA_ACTIVE_KEY_ID = activeKeyId;
}

function fakeEnvelope(seed: string) {
  return {
    version: 1,
    algorithm: "AES-256-GCM" as const,
    keyId: `sd-key-${seed}`,
    keyVersion: 1,
    ciphertext: "Y2lwaGVydGV4dA",
    iv: "aXY",
    createdAt: 1_747_000_000,
  };
}

function seededDb() {
  return createInMemoryDb({
    user: [
      {
        _id: ADMIN_USER_ID,
        _creationTime: 1,
        clerkUserId: "clerk_admin_001",
        email: "admin@example.com",
        isAdmin: true,
      },
      {
        _id: MEMBER_USER_ID,
        _creationTime: 2,
        clerkUserId: "clerk_member_001",
        email: "member@example.com",
        isAdmin: false,
      },
    ],
    memories: [
      {
        _id: "memory_001",
        _creationTime: 3,
        userId: MEMBER_USER_ID,
        dayKey: "2026-05-01",
        title: "Morning run",
        description: "Felt strong after 5km",
        mood: "energized",
        happenedAt: 1_747_000_001,
      },
    ],
    days: [
      {
        _id: "day_001",
        _creationTime: 4,
        userId: MEMBER_USER_ID,
        dayKey: "2026-05-01",
        rating: 4,
        manualNotes: ["deep work", "call with team"],
        peopleTags: ["Alex", "Sam"],
      },
    ],
    daySummaries: [
      {
        _id: "summary_001",
        _creationTime: 5,
        userId: MEMBER_USER_ID,
        dayKey: "2026-05-01",
        story: "Strong momentum across work and health.",
        highlights: ["shipped feature", "ran 5km"],
        generatedAt: 1_747_000_002,
        sourcesUsed: ["memories", "days"],
      },
    ],
    integrationDailyData: [
      {
        _id: "integration_daily_001",
        _creationTime: 6,
        userId: MEMBER_USER_ID,
        provider: "google_fit",
        dayKey: "2026-05-01",
        summary: "Daily activity looked healthy",
        signals: ["5km run", "high step count"],
        context: {
          location: {
            places: ["city park"],
            durationMinutesByPlace: {
              "city park": 45,
            },
          },
          activitySummary: {
            steps: 10500,
            activeMinutes: 62,
            mood: "focused",
          },
        },
        syncedAt: 1_747_000_003,
      },
    ],
  });
}

afterEach(() => {
  if (ORIGINAL_KEYRING_ENV === undefined) {
    delete process.env.SENSITIVE_DATA_KEYRING_JSON;
  } else {
    process.env.SENSITIVE_DATA_KEYRING_JSON = ORIGINAL_KEYRING_ENV;
  }

  if (ORIGINAL_ACTIVE_KEY_ENV === undefined) {
    delete process.env.SENSITIVE_DATA_ACTIVE_KEY_ID;
  } else {
    process.env.SENSITIVE_DATA_ACTIVE_KEY_ID = ORIGINAL_ACTIVE_KEY_ENV;
  }
});

describe("sensitive data migration", () => {
  it("detects plaintext rows in dry-run mode without mutating records", async () => {
    const keyV1 = Buffer.alloc(32, 9).toString("base64url");
    setKeyring("sd-key-v1", { "sd-key-v1": keyV1 });

    const db = seededDb();
    const migrateBatch = handler<
      {
        table: "memories";
        batchSize?: number;
        cursor?: string;
        dryRun?: boolean;
      },
      {
        table: string;
        scanned: number;
        migrated: number;
        plaintextDetected: number;
        done: boolean;
      }
    >(migrationModule.adminMigrateSensitiveDataBatch);

    const result = await migrateBatch(createAuthCtx(db, "clerk_admin_001"), {
      table: "memories",
      batchSize: 10,
      dryRun: true,
    });

    expect(result.table).toBe("memories");
    expect(result.scanned).toBe(1);
    expect(result.migrated).toBe(1);
    expect(result.plaintextDetected).toBe(1);
    expect(result.done).toBe(true);

    const row = (await db.get("memory_001")) as Record<string, unknown>;
    expect(row.title).toBe("Morning run");
    expect(row.titleEncrypted).toBeUndefined();
    expect(row.sensitiveDataMigratedAt).toBeUndefined();
  });

  it("encrypts all targeted tables and clears plaintext fields", async () => {
    const keyV1 = Buffer.alloc(32, 10).toString("base64url");
    setKeyring("sd-key-v1", { "sd-key-v1": keyV1 });

    const db = seededDb();
    const migrateAll = handler<
      {
        batchSize?: number;
        maxBatchesPerTable?: number;
        dryRun?: boolean;
      },
      {
        totals: {
          migrated: number;
          plaintextDetected: number;
          failed: number;
        };
      }
    >(migrationModule.adminMigrateAllSensitiveData);

    const firstRun = await migrateAll(createAuthCtx(db, "clerk_admin_001"), {
      batchSize: 10,
      maxBatchesPerTable: 5,
    });

    expect(firstRun.totals.migrated).toBe(4);
    expect(firstRun.totals.plaintextDetected).toBe(4);
    expect(firstRun.totals.failed).toBe(0);

    const memory = (await db.get("memory_001")) as Record<string, unknown>;
    expect(isSensitiveDataEnvelope(memory.titleEncrypted)).toBe(true);
    expect(isSensitiveDataEnvelope(memory.descriptionEncrypted)).toBe(true);
    expect(isSensitiveDataEnvelope(memory.moodEncrypted)).toBe(true);
    expect(memory.title).toBeUndefined();
    expect(memory.description).toBeUndefined();
    expect(memory.mood).toBeUndefined();
    expect(typeof memory.sensitiveDataNonce).toBe("string");
    expect(typeof memory.sensitiveDataMigratedAt).toBe("number");

    const day = (await db.get("day_001")) as Record<string, unknown>;
    expect(isSensitiveDataEnvelope(day.manualNotesEncrypted)).toBe(true);
    expect(isSensitiveDataEnvelope(day.peopleTagsEncrypted)).toBe(true);
    expect(day.manualNotes).toBeUndefined();
    expect(day.peopleTags).toBeUndefined();
    expect(typeof day.sensitiveDataNonce).toBe("string");
    expect(typeof day.sensitiveDataMigratedAt).toBe("number");

    const summary = (await db.get("summary_001")) as Record<string, unknown>;
    expect(isSensitiveDataEnvelope(summary.storyEncrypted)).toBe(true);
    expect(isSensitiveDataEnvelope(summary.highlightsEncrypted)).toBe(true);
    expect(summary.story).toBeUndefined();
    expect(summary.highlights).toBeUndefined();
    expect(typeof summary.sensitiveDataNonce).toBe("string");
    expect(typeof summary.sensitiveDataMigratedAt).toBe("number");

    const integrationDaily = (await db.get("integration_daily_001")) as Record<
      string,
      unknown
    >;
    expect(isSensitiveDataEnvelope(integrationDaily.summaryEncrypted)).toBe(
      true,
    );
    expect(isSensitiveDataEnvelope(integrationDaily.signalsEncrypted)).toBe(
      true,
    );
    expect(isSensitiveDataEnvelope(integrationDaily.contextEncrypted)).toBe(
      true,
    );
    expect(integrationDaily.summary).toBeUndefined();
    expect(integrationDaily.signals).toBeUndefined();
    expect(integrationDaily.context).toBeUndefined();
    expect(typeof integrationDaily.sensitiveDataNonce).toBe("string");
    expect(typeof integrationDaily.sensitiveDataMigratedAt).toBe("number");

    const secondRun = await migrateAll(createAuthCtx(db, "clerk_admin_001"), {
      batchSize: 10,
      maxBatchesPerTable: 5,
    });

    expect(secondRun.totals.migrated).toBe(0);
    expect(secondRun.totals.failed).toBe(0);
  });

  it("blocks non-admin callers", async () => {
    const keyV1 = Buffer.alloc(32, 11).toString("base64url");
    setKeyring("sd-key-v1", { "sd-key-v1": keyV1 });

    const db = seededDb();
    const migrateBatch = handler<
      {
        table: "memories";
        batchSize?: number;
        cursor?: string;
        dryRun?: boolean;
      },
      unknown
    >(migrationModule.adminMigrateSensitiveDataBatch);

    await expect(
      migrateBatch(createAuthCtx(db, "clerk_member_001"), {
        table: "memories",
      }),
    ).rejects.toThrow("Forbidden: admin access required");
  });

  it("audits validation-reject-risk rows across all sensitive tables", async () => {
    const keyV1 = Buffer.alloc(32, 12).toString("base64url");
    setKeyring("sd-key-v1", { "sd-key-v1": keyV1 });

    const db = createInMemoryDb({
      user: [
        {
          _id: ADMIN_USER_ID,
          _creationTime: 1,
          clerkUserId: "clerk_admin_001",
          email: "admin@example.com",
          isAdmin: true,
        },
        {
          _id: MEMBER_USER_ID,
          _creationTime: 2,
          clerkUserId: "clerk_member_001",
          email: "member@example.com",
          isAdmin: false,
        },
      ],
      memories: [
        {
          _id: "memory_risk_001",
          _creationTime: 3,
          userId: MEMBER_USER_ID,
          dayKey: "2026-05-01",
          happenedAt: 1_747_000_001,
          titleEncrypted: fakeEnvelope("mem_title"),
          descriptionEncrypted: fakeEnvelope("mem_desc"),
          moodEncrypted: fakeEnvelope("mem_mood"),
          sensitiveDataMigratedAt: 1_747_000_010,
        },
      ],
      days: [
        {
          _id: "day_risk_001",
          _creationTime: 4,
          userId: MEMBER_USER_ID,
          dayKey: "2026-05-01",
          rating: 4,
          manualNotesEncrypted: fakeEnvelope("day_notes"),
          peopleTagsEncrypted: fakeEnvelope("day_tags"),
          sensitiveDataMigratedAt: 1_747_000_011,
        },
      ],
      daySummaries: [
        {
          _id: "summary_risk_001",
          _creationTime: 5,
          userId: MEMBER_USER_ID,
          dayKey: "2026-05-01",
          generatedAt: 1_747_000_002,
          sourcesUsed: ["memories"],
          storyEncrypted: fakeEnvelope("sum_story"),
          highlightsEncrypted: fakeEnvelope("sum_highlights"),
          sensitiveDataMigratedAt: 1_747_000_012,
        },
      ],
      integrationDailyData: [
        {
          _id: "integration_risk_001",
          _creationTime: 6,
          userId: MEMBER_USER_ID,
          provider: "google_fit",
          dayKey: "2026-05-01",
          syncedAt: 1_747_000_003,
          summaryEncrypted: fakeEnvelope("int_summary"),
          signalsEncrypted: fakeEnvelope("int_signals"),
          contextEncrypted: fakeEnvelope("int_context"),
          sensitiveDataMigratedAt: 1_747_000_013,
        },
      ],
    });

    const auditTable = handler<
      {
        table: "memories" | "days" | "daySummaries" | "integrationDailyData";
        batchSize?: number;
        cursor?: string;
      },
      {
        table: string;
        scanned: number;
        missingNonceRows: number;
        missingNonceRejectRiskRows: number;
        validationRejectRiskRows: number;
        done: boolean;
      }
    >(migrationModule.adminAuditSensitiveDataTableStatus);

    for (const table of [
      "memories",
      "days",
      "daySummaries",
      "integrationDailyData",
    ] as const) {
      const result = await auditTable(createAuthCtx(db, "clerk_admin_001"), {
        table,
        batchSize: 10,
      });

      expect(result.table).toBe(table);
      expect(result.scanned).toBe(1);
      expect(result.missingNonceRows).toBe(1);
      expect(result.missingNonceRejectRiskRows).toBe(1);
      expect(result.validationRejectRiskRows).toBe(1);
      expect(result.done).toBe(true);
    }
  });

  it("supports cursor-based migration pagination for string and number cursors", async () => {
    const keyV1 = Buffer.alloc(32, 13).toString("base64url");
    setKeyring("sd-key-v1", { "sd-key-v1": keyV1 });

    const db = createInMemoryDb({
      user: [
        {
          _id: ADMIN_USER_ID,
          _creationTime: 1,
          clerkUserId: "clerk_admin_001",
          email: "admin@example.com",
          isAdmin: true,
        },
        {
          _id: MEMBER_USER_ID,
          _creationTime: 2,
          clerkUserId: "clerk_member_001",
          email: "member@example.com",
          isAdmin: false,
        },
      ],
      days: [
        {
          _id: "day_page_001",
          _creationTime: 3,
          userId: MEMBER_USER_ID,
          dayKey: "2026-05-01",
          rating: 3,
          manualNotes: ["one"],
          peopleTags: ["A"],
        },
        {
          _id: "day_page_002",
          _creationTime: 4,
          userId: MEMBER_USER_ID,
          dayKey: "2026-05-02",
          rating: 4,
          manualNotes: ["two"],
          peopleTags: ["B"],
        },
      ],
      integrationDailyData: [
        {
          _id: "integration_page_001",
          _creationTime: 5,
          userId: MEMBER_USER_ID,
          provider: "google_fit",
          dayKey: "2026-05-01",
          summary: "first",
          signals: ["s1"],
          syncedAt: 1_747_000_001,
        },
        {
          _id: "integration_page_002",
          _creationTime: 6,
          userId: MEMBER_USER_ID,
          provider: "google_fit",
          dayKey: "2026-05-02",
          summary: "second",
          signals: ["s2"],
          syncedAt: 1_747_000_002,
        },
      ],
    });

    const migrateBatch = handler<
      {
        table: "days" | "integrationDailyData";
        batchSize?: number;
        cursor?: string;
        dryRun?: boolean;
      },
      {
        scanned: number;
        done: boolean;
        nextCursor?: string;
      }
    >(migrationModule.adminMigrateSensitiveDataBatch);

    const dayFirstPage = await migrateBatch(
      createAuthCtx(db, "clerk_admin_001"),
      {
        table: "days",
        batchSize: 1,
        dryRun: true,
      },
    );

    expect(dayFirstPage.scanned).toBe(1);
    expect(dayFirstPage.done).toBe(false);
    expect(dayFirstPage.nextCursor).toBeDefined();

    const daySecondPage = await migrateBatch(
      createAuthCtx(db, "clerk_admin_001"),
      {
        table: "days",
        batchSize: 1,
        dryRun: true,
        cursor: dayFirstPage.nextCursor,
      },
    );

    expect(daySecondPage.scanned).toBe(1);
    expect(daySecondPage.done).toBe(true);

    const integrationFirstPage = await migrateBatch(
      createAuthCtx(db, "clerk_admin_001"),
      {
        table: "integrationDailyData",
        batchSize: 1,
        dryRun: true,
      },
    );

    expect(integrationFirstPage.scanned).toBe(1);
    expect(integrationFirstPage.done).toBe(false);
    expect(integrationFirstPage.nextCursor).toBeDefined();

    const integrationSecondPage = await migrateBatch(
      createAuthCtx(db, "clerk_admin_001"),
      {
        table: "integrationDailyData",
        batchSize: 1,
        dryRun: true,
        cursor: integrationFirstPage.nextCursor,
      },
    );

    expect(integrationSecondPage.scanned).toBe(1);
    expect(integrationSecondPage.done).toBe(true);
  });

  it("rejects invalid migration cursors", async () => {
    const keyV1 = Buffer.alloc(32, 14).toString("base64url");
    setKeyring("sd-key-v1", { "sd-key-v1": keyV1 });

    const db = seededDb();
    const auditTable = handler<
      {
        table: "memories" | "days";
        batchSize?: number;
        cursor?: string;
      },
      unknown
    >(migrationModule.adminAuditSensitiveDataTableStatus);

    await expect(
      auditTable(createAuthCtx(db, "clerk_admin_001"), {
        table: "memories",
        cursor: "invalid",
      }),
    ).rejects.toThrow("Invalid migration cursor format");

    await expect(
      auditTable(createAuthCtx(db, "clerk_admin_001"), {
        table: "days",
        cursor: "::",
      }),
    ).rejects.toThrow("Invalid migration cursor format");
  });
});
