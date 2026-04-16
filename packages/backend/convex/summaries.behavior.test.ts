import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as summariesModule from "./summaries";

const originalSummaryDailyLimit = process.env.SUMMARY_DAILY_GENERATION_LIMIT;
const originalExportJobsRetentionDays = process.env.RETENTION_EXPORT_JOBS_DAYS;
const originalRestoreJobsRetentionDays =
  process.env.RETENTION_RESTORE_JOBS_DAYS;
const originalClerkWebhookSecret = process.env.CLERK_WEBHOOK_SECRET;
const originalExportSigningSecret = process.env.EXPORT_SIGNING_SECRET;

beforeEach(() => {
  process.env.CLERK_WEBHOOK_SECRET =
    process.env.CLERK_WEBHOOK_SECRET ?? "whsec_test_restore_signing_secret";
  process.env.EXPORT_SIGNING_SECRET =
    process.env.EXPORT_SIGNING_SECRET ?? "test_export_signing_secret";
});

afterEach(() => {
  if (originalSummaryDailyLimit === undefined) {
    delete process.env.SUMMARY_DAILY_GENERATION_LIMIT;
  } else {
    process.env.SUMMARY_DAILY_GENERATION_LIMIT = originalSummaryDailyLimit;
  }

  if (originalExportJobsRetentionDays === undefined) {
    delete process.env.RETENTION_EXPORT_JOBS_DAYS;
  } else {
    process.env.RETENTION_EXPORT_JOBS_DAYS = originalExportJobsRetentionDays;
  }

  if (originalRestoreJobsRetentionDays === undefined) {
    delete process.env.RETENTION_RESTORE_JOBS_DAYS;
  } else {
    process.env.RETENTION_RESTORE_JOBS_DAYS = originalRestoreJobsRetentionDays;
  }

  if (originalClerkWebhookSecret === undefined) {
    delete process.env.CLERK_WEBHOOK_SECRET;
  } else {
    process.env.CLERK_WEBHOOK_SECRET = originalClerkWebhookSecret;
  }

  if (originalExportSigningSecret === undefined) {
    delete process.env.EXPORT_SIGNING_SECRET;
  } else {
    process.env.EXPORT_SIGNING_SECRET = originalExportSigningSecret;
  }

  vi.restoreAllMocks();
});

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const USER_ID = "user_member_001" as Id<"user">;
const OTHER_USER_ID = "user_other_001" as Id<"user">;

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
      {
        _id: OTHER_USER_ID,
        _creationTime: 2,
        clerkUserId: "clerk_other_001",
        email: "other@example.com",
        isAdmin: false,
      },
    ],
  });
}

async function buildSignedRestorePayloadText(): Promise<string> {
  return buildSignedRestorePayloadTextWithRows();
}

type RestorePayloadRowOverrides = {
  summaries?: unknown[];
  memories?: unknown[];
  days?: unknown[];
  integrationDailyData?: unknown[];
};

async function buildSignedRestorePayloadTextWithRows(
  overrides?: RestorePayloadRowOverrides,
): Promise<string> {
  let signedPayloadText = "";

  const summariesRows = overrides?.summaries ?? [
    {
      dayKey: "2026-04-02",
      story: "A good day",
      highlights: ["shipping"],
      sourcesUsed: ["Memories"],
      generatedAt: 100,
    },
  ];
  const memoriesRows = overrides?.memories ?? [
    {
      dayKey: "2026-04-02",
      title: "Memory",
      happenedAt: 100,
    },
  ];
  const daysRows = overrides?.days ?? [
    {
      dayKey: "2026-04-02",
      manualNotes: [],
      peopleTags: [],
    },
  ];
  const integrationRows = overrides?.integrationDailyData ?? [
    {
      provider: "spotify",
      dayKey: "2026-04-02",
      syncedAt: 100,
      signals: ["music"],
    },
  ];

  const runQuery = vi.fn(
    async (_ref: unknown, args: Record<string, unknown>) => {
      if (Object.keys(args).length === 0) {
        return {
          userId: USER_ID,
          clerkUserId: "clerk_member_001",
        };
      }

      const dataset = args.dataset as
        | "summaries"
        | "memories"
        | "days"
        | "integrationDailyData";

      if (dataset === "summaries") {
        return {
          exportedAt: 1,
          dataset,
          page: summariesRows,
          continueCursor: null,
          isDone: true,
        };
      }

      if (dataset === "memories") {
        return {
          exportedAt: 1,
          dataset,
          page: memoriesRows,
          continueCursor: null,
          isDone: true,
        };
      }

      if (dataset === "days") {
        return {
          exportedAt: 1,
          dataset,
          page: daysRows,
          continueCursor: null,
          isDone: true,
        };
      }

      return {
        exportedAt: 1,
        dataset,
        page: integrationRows,
        continueCursor: null,
        isDone: true,
      };
    },
  );

  await summariesModule.prepareDiaryExportArtifactImpl(
    {
      runQuery,
      storage: {
        store: async (blob: Blob) => {
          signedPayloadText = await blob.text();
          return "storage_restore_signed_payload_for_tests";
        },
        getUrl: async (storageId: string) =>
          `https://cdn.example.com/${storageId}`,
      },
    } as any,
    {
      format: "json",
      includeLocationSignals: false,
    },
  );

  return signedPayloadText;
}

describe("summaries behavior", () => {
  it("supports get/upsert/list/delete flows with ownership checks", async () => {
    const db = seededDb();

    const upsertSummary = handler<
      {
        dayKey: string;
        story: string;
        highlights: string[];
        metrics?: {
          steps?: number;
        };
        sourcesUsed: string[];
      },
      { _id: Id<"daySummaries">; story: string; generatedAt: number } | null
    >(summariesModule.upsertSummary);
    const getSummaryByDay = handler<
      { dayKey: string },
      { _id: Id<"daySummaries"> } | null
    >(summariesModule.getSummaryByDay);
    const getSummaryById = handler<
      { summaryId: Id<"daySummaries"> },
      { _id: Id<"daySummaries">; story: string }
    >(summariesModule.getSummaryById);
    const listRecentSummaries = handler<
      { limit?: number },
      Array<{ _id: Id<"daySummaries">; dayKey: string }>
    >(summariesModule.listRecentSummaries);
    const deleteSummary = handler<
      { summaryId: Id<"daySummaries"> },
      { success: boolean }
    >(summariesModule.deleteSummary);

    const ctx = createAuthCtx(db, "clerk_member_001");

    const created = await upsertSummary(ctx, {
      dayKey: "2026-04-02",
      story: "A productive day",
      highlights: ["finished tasks"],
      metrics: { steps: 4000 },
      sourcesUsed: ["Memories"],
    });

    const summaryId = created?._id as Id<"daySummaries">;
    expect(created?.story).toBe("A productive day");

    const byDay = await getSummaryByDay(ctx, { dayKey: "2026-04-02" });
    expect(byDay?._id).toBe(summaryId);

    const byId = await getSummaryById(ctx, { summaryId });
    expect(byId.story).toBe("A productive day");

    const listed = await listRecentSummaries(ctx, { limit: 10 });
    expect(listed).toHaveLength(1);

    await expect(
      getSummaryById(createAuthCtx(db, "clerk_other_001"), { summaryId }),
    ).rejects.toThrow("Forbidden");

    const deleted = await deleteSummary(ctx, { summaryId });
    expect(deleted.success).toBe(true);
    expect(db.getTable("daySummaries")).toHaveLength(0);
  });

  it("reserves and reports daily quota usage", async () => {
    const db = seededDb();

    process.env.SUMMARY_DAILY_GENERATION_LIMIT = "2";

    const reserveSummaryGenerationSlot = handler<
      Record<string, never>,
      { used: number; limit: number; remaining: number }
    >(summariesModule.reserveSummaryGenerationSlot);
    const getSummaryQuotaForDay = handler<
      Record<string, never>,
      { used: number; limit: number; remaining: number }
    >(summariesModule.getSummaryQuotaForDay);
    const getSummaryGenerationIdentity = handler<
      Record<string, never>,
      { userId: string; clerkUserId: string }
    >(summariesModule.getSummaryGenerationIdentity);

    const ctx = createAuthCtx(db, "clerk_member_001");

    const first = await reserveSummaryGenerationSlot(ctx, {});
    expect(first.used).toBe(1);
    expect(first.remaining).toBe(1);

    const quota = await getSummaryQuotaForDay(ctx, {});
    expect(quota.used).toBe(1);
    expect(quota.limit).toBe(2);

    const identity = await getSummaryGenerationIdentity(ctx, {});
    expect(identity.userId).toBe(USER_ID);
    expect(identity.clerkUserId).toBe("clerk_member_001");
  });

  it("exports diary data and optionally redacts location signals", async () => {
    const db = seededDb();

    await db.insert("daySummaries", {
      userId: USER_ID,
      dayKey: "2026-04-02",
      story: "Story",
      highlights: ["h1"],
      sourcesUsed: ["Memories"],
      generatedAt: 100,
    });

    await db.insert("memories", {
      userId: USER_ID,
      clientRequestId: "mem_export_001",
      dayKey: "2026-04-02",
      title: "Memory",
      description: "Desc",
      mood: "happy",
      happenedAt: 100,
    });

    await db.insert("days", {
      userId: USER_ID,
      dayKey: "2026-04-02",
      rating: 4,
      manualNotes: ["note"],
      peopleTags: ["Alex"],
    });

    await db.insert("integrationDailyData", {
      userId: USER_ID,
      provider: "location",
      dayKey: "2026-04-02",
      syncedAt: 100,
      signals: ["home", "gym"],
    });

    await db.insert("integrationDailyData", {
      userId: USER_ID,
      provider: "spotify",
      dayKey: "2026-04-02",
      syncedAt: 100,
      signals: ["music"],
    });

    const exportMyDiaryData = handler<
      {
        dataset: "summaries" | "memories" | "days" | "integrationDailyData";
        cursor?: string;
        pageSize?: number;
        includeLocationSignals?: boolean;
      },
      {
        dataset: string;
        page: Array<{ provider?: string; signals?: string[] }>;
        continueCursor: string | null;
        isDone: boolean;
      }
    >(summariesModule.exportMyDiaryData);

    const ctx = createAuthCtx(db, "clerk_member_001");

    const redacted = await exportMyDiaryData(ctx, {
      dataset: "integrationDailyData",
      includeLocationSignals: false,
    });

    const redactedLocation = redacted.page.find(
      (row) => row.provider === "location",
    );
    expect(redactedLocation).toBeUndefined();

    const full = await exportMyDiaryData(ctx, {
      dataset: "integrationDailyData",
      includeLocationSignals: true,
    });
    const fullLocation = full.page.find((row) => row.provider === "location");

    expect(fullLocation?.signals).toEqual(["home", "gym"]);

    const summaries = await exportMyDiaryData(ctx, {
      dataset: "summaries",
      includeLocationSignals: false,
    });
    const memories = await exportMyDiaryData(ctx, {
      dataset: "memories",
      includeLocationSignals: false,
    });
    const days = await exportMyDiaryData(ctx, {
      dataset: "days",
      includeLocationSignals: false,
    });

    expect(summaries.page).toHaveLength(1);
    expect(memories.page).toHaveLength(1);
    expect(days.page).toHaveLength(1);
    expect(
      (memories.page[0] as { clientRequestId?: string }).clientRequestId,
    ).toBe("mem_export_001");
  });

  it("builds export artifacts server-side and returns a download URL", async () => {
    const runQuery = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (Object.keys(args).length === 0) {
          return {
            userId: USER_ID,
            clerkUserId: "clerk_member_001",
          };
        }

        const dataset = args.dataset as
          | "summaries"
          | "memories"
          | "days"
          | "integrationDailyData";

        if (dataset === "summaries") {
          return {
            exportedAt: 1,
            dataset,
            page: [
              {
                dayKey: "2026-04-02",
                story: "A good day",
                highlights: ["shipping"],
                sourcesUsed: ["Memories"],
                generatedAt: 100,
              },
            ],
            continueCursor: null,
            isDone: true,
          };
        }

        if (dataset === "memories") {
          return {
            exportedAt: 1,
            dataset,
            page: [
              {
                dayKey: "2026-04-02",
                title: "Memory",
                happenedAt: 100,
              },
            ],
            continueCursor: null,
            isDone: true,
          };
        }

        if (dataset === "days") {
          return {
            exportedAt: 1,
            dataset,
            page: [
              {
                dayKey: "2026-04-02",
                manualNotes: [],
                peopleTags: [],
              },
            ],
            continueCursor: null,
            isDone: true,
          };
        }

        return {
          exportedAt: 1,
          dataset,
          page: [
            {
              provider: "spotify",
              dayKey: "2026-04-02",
              syncedAt: 100,
              signals: ["music"],
            },
          ],
          continueCursor: null,
          isDone: true,
        };
      },
    );

    const store = vi.fn(async (_blob: Blob) => "storage_export_001");
    const getUrl = vi.fn(
      async (storageId: string) => `https://cdn.example.com/${storageId}`,
    );

    const result = await summariesModule.prepareDiaryExportArtifactImpl(
      {
        runQuery,
        storage: {
          store,
          getUrl,
        },
      } as any,
      {
        format: "json",
        includeLocationSignals: false,
      },
    );

    expect(result.fileName).toMatch(/^daylog-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(result.downloadUrl).toBe(
      "https://cdn.example.com/storage_export_001",
    );
    expect(result.counts).toEqual({
      summaries: 1,
      memories: 1,
      days: 1,
      integrationDailyData: 1,
    });

    expect(store).toHaveBeenCalledTimes(1);
    const storedBlob = store.mock.calls[0]?.[0];
    expect(storedBlob).toBeInstanceOf(Blob);
    if (!(storedBlob instanceof Blob)) {
      throw new Error("Expected export payload blob to be stored");
    }

    const storedPayload = await storedBlob.text();
    expect(storedPayload).toContain('"summaries"');
    expect(storedPayload).toContain('"integrationDailyData"');

    const parsedPayload = JSON.parse(storedPayload) as {
      schemaVersion: number;
      owner?: { clerkUserId?: string };
      counts?: {
        summaries?: number;
        memories?: number;
        days?: number;
        integrationDailyData?: number;
      };
      integrity?: { algorithm?: string; signature?: string };
    };
    expect(parsedPayload.schemaVersion).toBe(2);
    expect(parsedPayload.owner?.clerkUserId).toBe("clerk_member_001");
    expect(parsedPayload.counts).toEqual({
      summaries: 1,
      memories: 1,
      days: 1,
      integrationDailyData: 1,
    });
    expect(parsedPayload.integrity?.algorithm).toBe("hmac-sha256");
    expect(typeof parsedPayload.integrity?.signature).toBe("string");
    expect((parsedPayload.integrity?.signature ?? "").length).toBeGreaterThan(
      10,
    );
  });

  it("builds multi-page text exports and includes optional fields", async () => {
    const datasetCalls = new Map<string, number>();

    const runQuery = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (Object.keys(args).length === 0) {
          return {
            userId: USER_ID,
            clerkUserId: "clerk_member_001",
          };
        }

        const dataset = args.dataset as
          | "summaries"
          | "memories"
          | "days"
          | "integrationDailyData";
        const callCount = (datasetCalls.get(dataset) ?? 0) + 1;
        datasetCalls.set(dataset, callCount);

        if (dataset === "summaries") {
          if (callCount === 1) {
            return {
              exportedAt: 1,
              dataset,
              page: [
                {
                  dayKey: "2026-04-02",
                  story: "A good day",
                  highlights: ["deep work"],
                  sourcesUsed: ["Memories"],
                  generatedAt: 100,
                },
              ],
              continueCursor: "cursor-1",
              isDone: false,
            };
          }

          return {
            exportedAt: 1,
            dataset,
            page: [
              {
                dayKey: "2026-04-01",
                story: "Another day",
                highlights: [],
                sourcesUsed: ["Days"],
                generatedAt: 90,
              },
            ],
            continueCursor: null,
            isDone: true,
          };
        }

        if (dataset === "memories") {
          return {
            exportedAt: 1,
            dataset,
            page: [
              {
                dayKey: "2026-04-02",
                title: "Memory",
                description: "  Description text  ",
                mood: "happy",
                happenedAt: 100,
              },
            ],
            continueCursor: null,
            isDone: true,
          };
        }

        if (dataset === "days") {
          return {
            exportedAt: 1,
            dataset,
            page: [
              {
                dayKey: "2026-04-02",
                rating: 4,
                manualNotes: ["note"],
                peopleTags: ["Alex"],
              },
            ],
            continueCursor: null,
            isDone: true,
          };
        }

        return {
          exportedAt: 1,
          dataset,
          page: [
            {
              provider: "spotify",
              dayKey: "2026-04-02",
              syncedAt: 100,
              summary: "Summary line",
              signals: ["music"],
            },
          ],
          continueCursor: null,
          isDone: true,
        };
      },
    );

    const store = vi.fn(async (_blob: Blob) => "storage_export_txt_001");
    const getUrl = vi.fn(
      async (storageId: string) => `https://cdn.example.com/${storageId}`,
    );

    const result = await summariesModule.prepareDiaryExportArtifactImpl(
      {
        runQuery,
        storage: {
          store,
          getUrl,
        },
      } as any,
      {
        format: "txt",
        includeLocationSignals: true,
      },
    );

    expect(datasetCalls.get("summaries")).toBe(2);
    expect(result.fileName).toMatch(/^daylog-export-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(result.artifactMimeType).toBe("text/plain; charset=utf-8");

    const storedBlob = store.mock.calls[0]?.[0];
    expect(storedBlob).toBeInstanceOf(Blob);
    if (!(storedBlob instanceof Blob)) {
      throw new Error("Expected text export blob to be stored");
    }

    const storedText = await storedBlob.text();
    expect(storedText).toContain("=== Summaries ===");
    expect(storedText).toContain("Highlights: deep work");
    expect(storedText).toContain("Description: Description text");
    expect(storedText).toContain("Summary: Summary line");
    expect(storedText).toContain("Signals: music");
  });

  it("fails artifact preparation when storage URL cannot be generated", async () => {
    const runQuery = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (Object.keys(args).length === 0) {
          return {
            userId: USER_ID,
            clerkUserId: "clerk_member_001",
          };
        }

        return {
          exportedAt: 1,
          dataset: args.dataset,
          page: [],
          continueCursor: null,
          isDone: true,
        };
      },
    );

    await expect(
      summariesModule.prepareDiaryExportArtifactImpl(
        {
          runQuery,
          storage: {
            store: vi.fn(async (_blob: Blob) => "storage_missing_url_001"),
            getUrl: vi.fn(async () => null),
          },
        } as any,
        {
          format: "json",
          includeLocationSignals: false,
        },
      ),
    ).rejects.toThrow("Unable to prepare export download URL. Please retry.");
  });

  it("requires EXPORT_SIGNING_SECRET and does not fall back to webhook secret", async () => {
    delete process.env.EXPORT_SIGNING_SECRET;
    process.env.CLERK_WEBHOOK_SECRET = "whsec_webhook_only_secret";

    const runQuery = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (Object.keys(args).length === 0) {
          return {
            userId: USER_ID,
            clerkUserId: "clerk_member_001",
          };
        }

        return {
          exportedAt: 1,
          dataset: args.dataset,
          page: [],
          continueCursor: null,
          isDone: true,
        };
      },
    );

    await expect(
      summariesModule.prepareDiaryExportArtifactImpl(
        {
          runQuery,
          storage: {
            store: vi.fn(async (_blob: Blob) => "storage_export_001"),
            getUrl: vi.fn(
              async (storageId: string) =>
                `https://cdn.example.com/${storageId}`,
            ),
          },
        } as any,
        {
          format: "json",
          includeLocationSignals: false,
        },
      ),
    ).rejects.toThrow("Configure EXPORT_SIGNING_SECRET");
  });

  it("validates restore ownership and rejects tampered backups", async () => {
    let signedPayloadText = "";

    const runQuery = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (Object.keys(args).length === 0) {
          return {
            userId: USER_ID,
            clerkUserId: "clerk_member_001",
          };
        }

        const dataset = args.dataset as
          | "summaries"
          | "memories"
          | "days"
          | "integrationDailyData";

        if (dataset === "summaries") {
          return {
            exportedAt: 1,
            dataset,
            page: [
              {
                dayKey: "2026-04-02",
                story: "A good day",
                highlights: ["shipping"],
                sourcesUsed: ["Memories"],
                generatedAt: 100,
              },
            ],
            continueCursor: null,
            isDone: true,
          };
        }

        if (dataset === "memories") {
          return {
            exportedAt: 1,
            dataset,
            page: [
              {
                dayKey: "2026-04-02",
                title: "Memory",
                happenedAt: 100,
              },
            ],
            continueCursor: null,
            isDone: true,
          };
        }

        if (dataset === "days") {
          return {
            exportedAt: 1,
            dataset,
            page: [
              {
                dayKey: "2026-04-02",
                manualNotes: [],
                peopleTags: [],
              },
            ],
            continueCursor: null,
            isDone: true,
          };
        }

        return {
          exportedAt: 1,
          dataset,
          page: [
            {
              provider: "spotify",
              dayKey: "2026-04-02",
              syncedAt: 100,
              signals: ["music"],
            },
          ],
          continueCursor: null,
          isDone: true,
        };
      },
    );

    const store = vi.fn(async (blob: Blob) => {
      signedPayloadText = await blob.text();
      return "storage_restore_signed_payload_001";
    });
    const getUrl = vi.fn(
      async (storageId: string) => `https://cdn.example.com/${storageId}`,
    );

    await summariesModule.prepareDiaryExportArtifactImpl(
      {
        runQuery,
        storage: {
          store,
          getUrl,
        },
      } as any,
      {
        format: "json",
        includeLocationSignals: false,
      },
    );

    const validateMyDiaryRestorePayload = handler<
      { payloadText: string },
      {
        valid: boolean;
        ownerClerkUserId: string;
        counts: { memories: number };
      }
    >(summariesModule.validateMyDiaryRestorePayload);

    const validation = await validateMyDiaryRestorePayload(
      {
        runQuery: vi.fn(async () => ({
          userId: USER_ID,
          clerkUserId: "clerk_member_001",
        })),
      } as any,
      {
        payloadText: signedPayloadText,
      },
    );
    expect(validation.valid).toBe(true);
    expect(validation.ownerClerkUserId).toBe("clerk_member_001");
    expect(validation.counts.memories).toBe(1);

    const tamperedPayload = signedPayloadText.replace('"Memory"', '"Changed"');
    await expect(
      validateMyDiaryRestorePayload(
        {
          runQuery: vi.fn(async () => ({
            userId: USER_ID,
            clerkUserId: "clerk_member_001",
          })),
        } as any,
        {
          payloadText: tamperedPayload,
        },
      ),
    ).rejects.toThrow("integrity check failed");

    await expect(
      validateMyDiaryRestorePayload(
        {
          runQuery: vi.fn(async () => ({
            userId: OTHER_USER_ID,
            clerkUserId: "clerk_other_001",
          })),
        } as any,
        {
          payloadText: signedPayloadText,
        },
      ),
    ).rejects.toThrow("ownership mismatch");
  });

  it("restores in idempotent batches and handles conflicts", async () => {
    const db = seededDb();
    const restoreDiaryDatasetBatchInternal = handler<
      {
        userId: Id<"user">;
        dataset: "summaries" | "memories" | "days" | "integrationDailyData";
        rows: unknown[];
        conflictMode: "skip" | "overwrite";
        allowPartial: boolean;
      },
      {
        inserted: number;
        updated: number;
        skipped: number;
        conflicts: number;
      }
    >(summariesModule.restoreDiaryDatasetBatchInternal);

    const ctx = createAuthCtx(db, null);

    const memoryRow = {
      dayKey: "2026-04-02",
      title: "Restored memory",
      description: "from backup",
      mood: "happy",
      happenedAt: 100,
    };

    const firstInsert = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "memories",
      rows: [memoryRow],
      conflictMode: "skip",
      allowPartial: false,
    });
    expect(firstInsert.inserted).toBe(1);

    const secondInsert = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "memories",
      rows: [memoryRow],
      conflictMode: "skip",
      allowPartial: false,
    });
    expect(secondInsert.skipped).toBe(1);
    expect(db.getTable("memories")).toHaveLength(1);

    await db.insert("daySummaries", {
      userId: USER_ID,
      dayKey: "2026-04-03",
      story: "Original story",
      highlights: ["h1"],
      sourcesUsed: ["Memories"],
      generatedAt: 10,
    });

    const incomingSummary = {
      dayKey: "2026-04-03",
      story: "Restored story",
      highlights: ["h2"],
      sourcesUsed: ["Days"],
      generatedAt: 20,
    };

    const skipConflict = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "summaries",
      rows: [incomingSummary],
      conflictMode: "skip",
      allowPartial: false,
    });
    expect(skipConflict.conflicts).toBe(1);
    expect(skipConflict.updated).toBe(0);

    const overwriteConflict = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "summaries",
      rows: [incomingSummary],
      conflictMode: "overwrite",
      allowPartial: false,
    });
    expect(overwriteConflict.updated).toBe(1);

    const updatedSummary = await db
      .query("daySummaries")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", USER_ID).eq("dayKey", "2026-04-03"),
      )
      .unique();
    expect(updatedSummary?.story).toBe("Restored story");
  });

  it("captures row failures when partial restore is enabled", async () => {
    const db = seededDb();
    const restoreDiaryDatasetBatchInternal = handler<
      {
        userId: Id<"user">;
        dataset: "summaries" | "memories" | "days" | "integrationDailyData";
        rows: unknown[];
        conflictMode: "skip" | "overwrite";
        allowPartial: boolean;
      },
      {
        processed: number;
        inserted: number;
        updated: number;
        skipped: number;
        conflicts: number;
        failed: number;
        errorSamples: string[];
      }
    >(summariesModule.restoreDiaryDatasetBatchInternal);

    const ctx = createAuthCtx(db, null);
    vi.spyOn(ctx.db as any, "insert").mockImplementationOnce(() => {
      throw new Error("row insert failed");
    });

    const result = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "summaries",
      rows: [
        {
          dayKey: "2026-04-06",
          story: "Will fail",
          highlights: ["h1"],
          sourcesUsed: ["Memories"],
          generatedAt: 100,
        },
      ],
      conflictMode: "skip",
      allowPartial: true,
    });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errorSamples).toHaveLength(1);
    expect(result.errorSamples[0]).toContain("row insert failed");
  });

  it("runs restore action lifecycle and returns success", async () => {
    const restoreMyDiaryData = handler<
      {
        payloadText: string;
        datasets?: Array<
          "summaries" | "memories" | "days" | "integrationDailyData"
        >;
        conflictMode?: "skip" | "overwrite";
        allowPartial?: boolean;
      },
      {
        jobId: string;
        status: "success" | "partial";
        selectedDatasets: string[];
        totals: { inserted: number; failed: number };
      }
    >(summariesModule.restoreMyDiaryData);

    const payloadText = await buildSignedRestorePayloadText();

    const runMutation = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (
          "requestedAt" in args &&
          "selectedDatasets" in args &&
          !("rows" in args)
        ) {
          return {
            jobId: "restore_job_001",
            status: "running",
            requestedAt: args.requestedAt,
          };
        }

        if ("dataset" in args && "rows" in args) {
          const rows = args.rows as unknown[];
          return {
            processed: rows.length,
            inserted: rows.length,
            updated: 0,
            skipped: 0,
            conflicts: 0,
            failed: 0,
            errorSamples: [],
          };
        }

        if ("completedAt" in args && "datasetResults" in args) {
          return {
            jobId: args.jobId,
            status: args.status,
            completedAt: args.completedAt,
          };
        }

        if ("failedAt" in args && "error" in args) {
          return {
            jobId: args.jobId,
            status: "failed",
            failedAt: args.failedAt,
          };
        }

        throw new Error("Unexpected restore mutation args");
      },
    );

    const result = await restoreMyDiaryData(
      {
        runQuery: vi.fn(async () => ({
          userId: USER_ID,
          clerkUserId: "clerk_member_001",
        })),
        runMutation,
      } as any,
      {
        payloadText,
        datasets: ["memories"],
        conflictMode: "overwrite",
        allowPartial: false,
      },
    );

    expect(result.jobId).toBe("restore_job_001");
    expect(result.status).toBe("success");
    expect(result.selectedDatasets).toEqual(["memories"]);
    expect(result.totals.inserted).toBe(1);
    expect(result.totals.failed).toBe(0);

    const completedCall = runMutation.mock.calls.find(
      ([, mutationArgs]) =>
        typeof mutationArgs === "object" &&
        mutationArgs !== null &&
        "completedAt" in mutationArgs,
    );
    expect(completedCall).toBeDefined();
    expect(
      (completedCall?.[1] as { status?: "succeeded" | "partial" }).status,
    ).toBe("succeeded");
  });

  it("returns partial status when one or more restore rows fail", async () => {
    const restoreMyDiaryData = handler<
      {
        payloadText: string;
        datasets?: Array<
          "summaries" | "memories" | "days" | "integrationDailyData"
        >;
        conflictMode?: "skip" | "overwrite";
        allowPartial?: boolean;
      },
      {
        status: "success" | "partial";
        totals: { failed: number };
      }
    >(summariesModule.restoreMyDiaryData);

    const payloadText = await buildSignedRestorePayloadText();

    const runMutation = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (
          "requestedAt" in args &&
          "selectedDatasets" in args &&
          !("rows" in args)
        ) {
          return {
            jobId: "restore_job_002",
            status: "running",
            requestedAt: args.requestedAt,
          };
        }

        if ("dataset" in args && "rows" in args) {
          const rows = args.rows as unknown[];
          return {
            processed: rows.length,
            inserted: 0,
            updated: 0,
            skipped: 0,
            conflicts: 0,
            failed: rows.length,
            errorSamples: ["sample row failure"],
          };
        }

        if ("completedAt" in args && "datasetResults" in args) {
          return {
            jobId: args.jobId,
            status: args.status,
            completedAt: args.completedAt,
          };
        }

        if ("failedAt" in args && "error" in args) {
          return {
            jobId: args.jobId,
            status: "failed",
            failedAt: args.failedAt,
          };
        }

        throw new Error("Unexpected restore mutation args");
      },
    );

    const result = await restoreMyDiaryData(
      {
        runQuery: vi.fn(async () => ({
          userId: USER_ID,
          clerkUserId: "clerk_member_001",
        })),
        runMutation,
      } as any,
      {
        payloadText,
        datasets: ["memories"],
        conflictMode: "skip",
        allowPartial: true,
      },
    );

    expect(result.status).toBe("partial");
    expect(result.totals.failed).toBe(1);

    const completedCall = runMutation.mock.calls.find(
      ([, mutationArgs]) =>
        typeof mutationArgs === "object" &&
        mutationArgs !== null &&
        "completedAt" in mutationArgs,
    );
    expect(completedCall).toBeDefined();
    expect(
      (completedCall?.[1] as { status?: "succeeded" | "partial" }).status,
    ).toBe("partial");
  });

  it("restores large datasets in multiple internal batches", async () => {
    const restoreMyDiaryData = handler<
      {
        payloadText: string;
        datasets?: Array<
          "summaries" | "memories" | "days" | "integrationDailyData"
        >;
        conflictMode?: "skip" | "overwrite";
        allowPartial?: boolean;
      },
      {
        status: "success" | "partial";
        selectedDatasets: string[];
        totals: { processed: number; inserted: number; failed: number };
      }
    >(summariesModule.restoreMyDiaryData);

    const largeMemoryRows = Array.from({ length: 205 }, (_, index) => ({
      dayKey: `2026-04-${String((index % 28) + 1).padStart(2, "0")}`,
      title: `Memory ${index}`,
      description: `desc ${index}`,
      mood: "focused",
      happenedAt: 1_000 + index,
    }));

    const payloadText = await buildSignedRestorePayloadTextWithRows({
      summaries: [],
      memories: largeMemoryRows,
      days: [],
      integrationDailyData: [],
    });

    const runMutation = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (
          "requestedAt" in args &&
          "selectedDatasets" in args &&
          !("rows" in args)
        ) {
          return {
            jobId: "restore_job_large_001",
            status: "running",
            requestedAt: args.requestedAt,
          };
        }

        if ("dataset" in args && "rows" in args) {
          const rows = args.rows as unknown[];
          return {
            processed: rows.length,
            inserted: rows.length,
            updated: 0,
            skipped: 0,
            conflicts: 0,
            failed: 0,
            errorSamples: [],
          };
        }

        if ("completedAt" in args && "datasetResults" in args) {
          return {
            jobId: args.jobId,
            status: args.status,
            completedAt: args.completedAt,
          };
        }

        if ("failedAt" in args && "error" in args) {
          return {
            jobId: args.jobId,
            status: "failed",
            failedAt: args.failedAt,
          };
        }

        throw new Error("Unexpected restore mutation args");
      },
    );

    const result = await restoreMyDiaryData(
      {
        runQuery: vi.fn(async () => ({
          userId: USER_ID,
          clerkUserId: "clerk_member_001",
        })),
        runMutation,
      } as any,
      {
        payloadText,
        datasets: ["memories"],
        conflictMode: "skip",
        allowPartial: false,
      },
    );

    expect(result.status).toBe("success");
    expect(result.selectedDatasets).toEqual(["memories"]);
    expect(result.totals.processed).toBe(205);
    expect(result.totals.inserted).toBe(205);
    expect(result.totals.failed).toBe(0);

    const batchCalls = runMutation.mock.calls.filter(
      ([, mutationArgs]) =>
        typeof mutationArgs === "object" &&
        mutationArgs !== null &&
        "dataset" in mutationArgs &&
        "rows" in mutationArgs,
    );

    expect(batchCalls).toHaveLength(3);
    expect((batchCalls[0]?.[1] as { rows: unknown[] }).rows).toHaveLength(100);
    expect((batchCalls[1]?.[1] as { rows: unknown[] }).rows).toHaveLength(100);
    expect((batchCalls[2]?.[1] as { rows: unknown[] }).rows).toHaveLength(5);

    const completedCall = runMutation.mock.calls.find(
      ([, mutationArgs]) =>
        typeof mutationArgs === "object" &&
        mutationArgs !== null &&
        "completedAt" in mutationArgs,
    );

    expect(completedCall).toBeDefined();
    expect(
      (
        completedCall?.[1] as {
          totals?: { inserted?: number; processed?: number };
        }
      ).totals,
    ).toMatchObject({ inserted: 205, processed: 205 });
  });

  it("marks restore job failed and rethrows when payload parsing fails", async () => {
    const restoreMyDiaryData = handler<
      {
        payloadText: string;
        datasets?: Array<
          "summaries" | "memories" | "days" | "integrationDailyData"
        >;
      },
      unknown
    >(summariesModule.restoreMyDiaryData);

    const runMutation = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (
          "requestedAt" in args &&
          "selectedDatasets" in args &&
          !("rows" in args)
        ) {
          return {
            jobId: "restore_job_003",
            status: "running",
            requestedAt: args.requestedAt,
          };
        }

        if ("failedAt" in args && "error" in args) {
          return {
            jobId: args.jobId,
            status: "failed",
            failedAt: args.failedAt,
          };
        }

        throw new Error("Unexpected restore mutation args");
      },
    );

    await expect(
      restoreMyDiaryData(
        {
          runQuery: vi.fn(async () => ({
            userId: USER_ID,
            clerkUserId: "clerk_member_001",
          })),
          runMutation,
        } as any,
        {
          payloadText: "not-json",
          datasets: ["memories"],
        },
      ),
    ).rejects.toThrow("not valid JSON");

    const failedCall = runMutation.mock.calls.find(
      ([, mutationArgs]) =>
        typeof mutationArgs === "object" &&
        mutationArgs !== null &&
        "failedAt" in mutationArgs,
    );
    expect(failedCall).toBeDefined();
    expect((failedCall?.[1] as { error?: string }).error).toContain(
      "Restore file is not valid JSON",
    );
  });

  it("preserves original restore failure when failed-status update also throws", async () => {
    const restoreMyDiaryData = handler<
      {
        payloadText: string;
        datasets?: Array<
          "summaries" | "memories" | "days" | "integrationDailyData"
        >;
      },
      unknown
    >(summariesModule.restoreMyDiaryData);

    const runMutation = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (
          "requestedAt" in args &&
          "selectedDatasets" in args &&
          !("rows" in args)
        ) {
          return {
            jobId: "restore_job_004",
            status: "running",
            requestedAt: args.requestedAt,
          };
        }

        if ("failedAt" in args && "error" in args) {
          throw new Error("failed status write failed");
        }

        throw new Error("Unexpected restore mutation args");
      },
    );

    await expect(
      restoreMyDiaryData(
        {
          runQuery: vi.fn(async () => ({
            userId: USER_ID,
            clerkUserId: "clerk_member_001",
          })),
          runMutation,
        } as any,
        {
          payloadText: "not-json",
          datasets: ["memories"],
        },
      ),
    ).rejects.toThrow("not valid JSON");
  });

  it("restores days and integration datasets across insert, skip, conflict, and overwrite", async () => {
    const db = seededDb();
    const restoreDiaryDatasetBatchInternal = handler<
      {
        userId: Id<"user">;
        dataset: "summaries" | "memories" | "days" | "integrationDailyData";
        rows: unknown[];
        conflictMode: "skip" | "overwrite";
        allowPartial: boolean;
      },
      {
        inserted: number;
        updated: number;
        skipped: number;
        conflicts: number;
      }
    >(summariesModule.restoreDiaryDatasetBatchInternal);

    const ctx = createAuthCtx(db, null);

    const dayRow = {
      dayKey: "2026-04-07",
      rating: 3,
      manualNotes: ["n1"],
      peopleTags: ["Alex"],
    };
    const dayInserted = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "days",
      rows: [dayRow],
      conflictMode: "skip",
      allowPartial: false,
    });
    expect(dayInserted.inserted).toBe(1);

    const daySkipped = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "days",
      rows: [dayRow],
      conflictMode: "skip",
      allowPartial: false,
    });
    expect(daySkipped.skipped).toBe(1);

    const dayConflictRow = {
      ...dayRow,
      rating: 5,
      manualNotes: ["updated"],
    };
    const dayConflictSkip = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "days",
      rows: [dayConflictRow],
      conflictMode: "skip",
      allowPartial: false,
    });
    expect(dayConflictSkip.conflicts).toBe(1);
    expect(dayConflictSkip.updated).toBe(0);

    const dayConflictOverwrite = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "days",
      rows: [dayConflictRow],
      conflictMode: "overwrite",
      allowPartial: false,
    });
    expect(dayConflictOverwrite.updated).toBe(1);

    const integrationRow = {
      provider: "spotify",
      dayKey: "2026-04-08",
      syncedAt: 100,
      summary: "original",
      metrics: {
        steps: 1000,
      },
      signals: ["s1"],
      context: {
        source: "seed",
      },
    };
    const integrationInserted = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "integrationDailyData",
      rows: [integrationRow],
      conflictMode: "skip",
      allowPartial: false,
    });
    expect(integrationInserted.inserted).toBe(1);

    const integrationSkipped = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "integrationDailyData",
      rows: [integrationRow],
      conflictMode: "skip",
      allowPartial: false,
    });
    expect(integrationSkipped.skipped).toBe(1);

    const integrationConflictRow = {
      ...integrationRow,
      summary: "updated",
      signals: ["s2"],
    };
    const integrationConflictSkip = await restoreDiaryDatasetBatchInternal(
      ctx,
      {
        userId: USER_ID,
        dataset: "integrationDailyData",
        rows: [integrationConflictRow],
        conflictMode: "skip",
        allowPartial: false,
      },
    );
    expect(integrationConflictSkip.conflicts).toBe(1);
    expect(integrationConflictSkip.updated).toBe(0);

    const integrationConflictOverwrite = await restoreDiaryDatasetBatchInternal(
      ctx,
      {
        userId: USER_ID,
        dataset: "integrationDailyData",
        rows: [integrationConflictRow],
        conflictMode: "overwrite",
        allowPartial: false,
      },
    );
    expect(integrationConflictOverwrite.updated).toBe(1);
  });

  it("covers memory dedupe and conflict branches during restore", async () => {
    const db = seededDb();
    const restoreDiaryDatasetBatchInternal = handler<
      {
        userId: Id<"user">;
        dataset: "summaries" | "memories" | "days" | "integrationDailyData";
        rows: unknown[];
        conflictMode: "skip" | "overwrite";
        allowPartial: boolean;
      },
      {
        inserted: number;
        updated: number;
        skipped: number;
        conflicts: number;
      }
    >(summariesModule.restoreDiaryDatasetBatchInternal);

    const ctx = createAuthCtx(db, null);

    const exactDuplicateRow = {
      dayKey: "2026-04-09",
      title: "Duplicate",
      description: "same",
      mood: "calm",
      happenedAt: 500,
    };
    await db.insert("memories", {
      userId: USER_ID,
      clientRequestId: "manual_exact_duplicate",
      ...exactDuplicateRow,
    });

    const exactDuplicate = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "memories",
      rows: [exactDuplicateRow],
      conflictMode: "skip",
      allowPartial: false,
    });
    expect(exactDuplicate.skipped).toBe(1);

    const potentialConflictExisting = {
      dayKey: "2026-04-10",
      title: "Potential",
      description: "old",
      mood: "neutral",
      happenedAt: 600,
    };
    await db.insert("memories", {
      userId: USER_ID,
      clientRequestId: "manual_potential_conflict",
      ...potentialConflictExisting,
    });

    const potentialConflictIncoming = {
      dayKey: "2026-04-10",
      title: "Potential",
      description: "new",
      mood: "happy",
      happenedAt: 600,
    };
    const potentialConflictSkip = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "memories",
      rows: [potentialConflictIncoming],
      conflictMode: "skip",
      allowPartial: false,
    });
    expect(potentialConflictSkip.conflicts).toBe(1);

    const potentialConflictOverwrite = await restoreDiaryDatasetBatchInternal(
      ctx,
      {
        userId: USER_ID,
        dataset: "memories",
        rows: [potentialConflictIncoming],
        conflictMode: "overwrite",
        allowPartial: false,
      },
    );
    expect(potentialConflictOverwrite.updated).toBe(1);

    const byRequestIdRow = {
      dayKey: "2026-04-11",
      title: "By request id",
      description: "first",
      mood: "focused",
      happenedAt: 700,
    };
    const byRequestIdInserted = await restoreDiaryDatasetBatchInternal(ctx, {
      userId: USER_ID,
      dataset: "memories",
      rows: [byRequestIdRow],
      conflictMode: "skip",
      allowPartial: false,
    });
    expect(byRequestIdInserted.inserted).toBe(1);

    const insertedMemory = db
      .getTable("memories")
      .find(
        (row) => row.dayKey === "2026-04-11" && row.title === "By request id",
      );
    expect(insertedMemory?._id).toBeDefined();

    await db.patch(insertedMemory!._id, {
      description: "mutated-existing-row",
    });

    const byRequestIdConflictSkip = await restoreDiaryDatasetBatchInternal(
      ctx,
      {
        userId: USER_ID,
        dataset: "memories",
        rows: [byRequestIdRow],
        conflictMode: "skip",
        allowPartial: false,
      },
    );
    expect(byRequestIdConflictSkip.conflicts).toBe(1);

    const byRequestIdConflictOverwrite = await restoreDiaryDatasetBatchInternal(
      ctx,
      {
        userId: USER_ID,
        dataset: "memories",
        rows: [byRequestIdRow],
        conflictMode: "overwrite",
        allowPartial: false,
      },
    );
    expect(byRequestIdConflictOverwrite.updated).toBe(1);

    const explicitClientRequestIdRow = {
      clientRequestId: "imported_memory_req_001",
      dayKey: "2026-04-12",
      title: "Explicit request id",
      description: "from export",
      mood: "curious",
      happenedAt: 720,
    };

    const explicitClientRequestIdInserted =
      await restoreDiaryDatasetBatchInternal(ctx, {
        userId: USER_ID,
        dataset: "memories",
        rows: [explicitClientRequestIdRow],
        conflictMode: "skip",
        allowPartial: false,
      });

    expect(explicitClientRequestIdInserted.inserted).toBe(1);
    const explicitClientRequestMemory = db
      .getTable("memories")
      .find((row) => row.clientRequestId === "imported_memory_req_001");
    expect(explicitClientRequestMemory?._id).toBeDefined();
  });

  it("rethrows row errors when partial restore is disabled", async () => {
    const db = seededDb();
    const restoreDiaryDatasetBatchInternal = handler<
      {
        userId: Id<"user">;
        dataset: "summaries" | "memories" | "days" | "integrationDailyData";
        rows: unknown[];
        conflictMode: "skip" | "overwrite";
        allowPartial: boolean;
      },
      unknown
    >(summariesModule.restoreDiaryDatasetBatchInternal);

    const ctx = createAuthCtx(db, null);
    vi.spyOn(ctx.db as any, "insert").mockImplementationOnce(() => {
      throw new Error("hard row insert failure");
    });

    await expect(
      restoreDiaryDatasetBatchInternal(ctx, {
        userId: USER_ID,
        dataset: "summaries",
        rows: [
          {
            dayKey: "2026-04-12",
            story: "Will throw",
            highlights: ["h1"],
            sourcesUsed: ["Memories"],
            generatedAt: 120,
          },
        ],
        conflictMode: "skip",
        allowPartial: false,
      }),
    ).rejects.toThrow("hard row insert failure");
  });

  it("fails restore when signed payload owner does not match caller identity", async () => {
    const restoreMyDiaryData = handler<
      {
        payloadText: string;
        datasets?: Array<
          "summaries" | "memories" | "days" | "integrationDailyData"
        >;
      },
      unknown
    >(summariesModule.restoreMyDiaryData);

    const payloadText = await buildSignedRestorePayloadText();

    const runMutation = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (
          "requestedAt" in args &&
          "selectedDatasets" in args &&
          !("rows" in args)
        ) {
          return {
            jobId: "restore_job_005",
            status: "running",
            requestedAt: args.requestedAt,
          };
        }

        if ("failedAt" in args && "error" in args) {
          return {
            jobId: args.jobId,
            status: "failed",
            failedAt: args.failedAt,
          };
        }

        throw new Error("Unexpected restore mutation args");
      },
    );

    await expect(
      restoreMyDiaryData(
        {
          runQuery: vi.fn(async () => ({
            userId: OTHER_USER_ID,
            clerkUserId: "clerk_other_001",
          })),
          runMutation,
        } as any,
        {
          payloadText,
          datasets: ["memories"],
        },
      ),
    ).rejects.toThrow("ownership mismatch");
  });

  it("tracks export job status history and provides re-download links", async () => {
    const db = seededDb();

    const createExportJobInternal = handler<
      {
        userId: Id<"user">;
        format: "json" | "txt";
        includeLocationSignals: boolean;
        requestedAt: number;
        expiresAt: number;
      },
      {
        jobId: string;
        status: "queued";
        requestedAt: number;
        expiresAt: number;
      }
    >(summariesModule.createExportJobInternal);
    const markExportJobRunningInternal = handler<
      { jobId: string; startedAt: number },
      { jobId: string; status: "running"; startedAt: number }
    >(summariesModule.markExportJobRunningInternal);
    const markExportJobReadyInternal = handler<
      {
        jobId: string;
        completedAt: number;
        storageId: string;
        fileName: string;
        artifactMimeType: string;
        artifactSizeBytes: number;
        counts: {
          summaries: number;
          memories: number;
          days: number;
          integrationDailyData: number;
        };
      },
      { jobId: string; status: "ready"; completedAt: number }
    >(summariesModule.markExportJobReadyInternal);
    const listMyExportJobsPaginated = handler<
      { paginationOpts: { numItems: number; cursor: string | null } },
      {
        page: Array<{
          status: string;
          downloadUrl: string | null;
          fileName: string | null;
        }>;
      }
    >(summariesModule.listMyExportJobsPaginated);
    const getMyExportJobDownloadUrl = handler<
      { jobId: string },
      { status: string; fileName: string | null; downloadUrl: string }
    >(summariesModule.getMyExportJobDownloadUrl);

    const now = Date.parse("2026-04-03T12:00:00.000Z");
    const created = await createExportJobInternal(createAuthCtx(db, null), {
      userId: USER_ID,
      format: "json",
      includeLocationSignals: false,
      requestedAt: now,
      expiresAt: now + 14 * 24 * 60 * 60 * 1000,
    });

    await markExportJobRunningInternal(createAuthCtx(db, null), {
      jobId: created.jobId,
      startedAt: now + 100,
    });
    await markExportJobReadyInternal(createAuthCtx(db, null), {
      jobId: created.jobId,
      completedAt: now + 300,
      storageId: "storage_export_001",
      fileName: "daylog-export-2026-04-03.json",
      artifactMimeType: "application/json; charset=utf-8",
      artifactSizeBytes: 1024,
      counts: {
        summaries: 1,
        memories: 2,
        days: 1,
        integrationDailyData: 3,
      },
    });

    const memberQueryCtx = {
      ...createAuthCtx(db, "clerk_member_001"),
      storage: {
        getUrl: vi.fn(
          async (storageId: string) => `https://cdn.example.com/${storageId}`,
        ),
      },
    };

    const page = await listMyExportJobsPaginated(memberQueryCtx, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toHaveLength(1);
    expect(page.page[0]?.status).toBe("ready");
    expect(page.page[0]?.fileName).toBe("daylog-export-2026-04-03.json");
    expect(page.page[0]?.downloadUrl).toBe(
      "https://cdn.example.com/storage_export_001",
    );

    const download = await getMyExportJobDownloadUrl(memberQueryCtx, {
      jobId: created.jobId,
    });
    expect(download.status).toBe("ready");
    expect(download.fileName).toBe("daylog-export-2026-04-03.json");

    await expect(
      getMyExportJobDownloadUrl(
        {
          ...createAuthCtx(db, "clerk_other_001"),
          storage: memberQueryCtx.storage,
        },
        { jobId: created.jobId },
      ),
    ).rejects.toThrow("Forbidden");
  });

  it("tracks restore job status history for recent restore panel", async () => {
    const db = seededDb();

    const createRestoreJobInternal = handler<
      {
        userId: Id<"user">;
        requestedAt: number;
        conflictMode: "skip" | "overwrite";
        allowPartial: boolean;
        selectedDatasets: Array<
          "summaries" | "memories" | "days" | "integrationDailyData"
        >;
      },
      { jobId: string; status: "running"; requestedAt: number }
    >(summariesModule.createRestoreJobInternal);
    const markRestoreJobCompletedInternal = handler<
      {
        jobId: string;
        status: "succeeded" | "partial";
        completedAt: number;
        exportedAt: string;
        sourceCounts: {
          summaries: number;
          memories: number;
          days: number;
          integrationDailyData: number;
        };
        totals: {
          processed: number;
          inserted: number;
          updated: number;
          skipped: number;
          conflicts: number;
          failed: number;
          errorSamples: string[];
        };
        datasetResults: {
          summaries: {
            processed: number;
            inserted: number;
            updated: number;
            skipped: number;
            conflicts: number;
            failed: number;
            errorSamples: string[];
          };
          memories: {
            processed: number;
            inserted: number;
            updated: number;
            skipped: number;
            conflicts: number;
            failed: number;
            errorSamples: string[];
          };
          days: {
            processed: number;
            inserted: number;
            updated: number;
            skipped: number;
            conflicts: number;
            failed: number;
            errorSamples: string[];
          };
          integrationDailyData: {
            processed: number;
            inserted: number;
            updated: number;
            skipped: number;
            conflicts: number;
            failed: number;
            errorSamples: string[];
          };
        };
      },
      { jobId: string; status: "succeeded" | "partial"; completedAt: number }
    >(summariesModule.markRestoreJobCompletedInternal);
    const markRestoreJobFailedInternal = handler<
      { jobId: string; failedAt: number; error: string },
      { jobId: string; status: "failed"; failedAt: number }
    >(summariesModule.markRestoreJobFailedInternal);
    const listMyRestoreJobsPaginated = handler<
      { paginationOpts: { numItems: number; cursor: string | null } },
      {
        page: Array<{
          status: string;
          error: string | null;
          selectedDatasets: string[];
          totals: { inserted: number } | null;
        }>;
      }
    >(summariesModule.listMyRestoreJobsPaginated);

    const now = Date.parse("2026-04-04T10:00:00.000Z");
    const first = await createRestoreJobInternal(createAuthCtx(db, null), {
      userId: USER_ID,
      requestedAt: now,
      conflictMode: "skip",
      allowPartial: true,
      selectedDatasets: ["summaries", "memories"],
    });

    const sharedStats = {
      processed: 2,
      inserted: 1,
      updated: 0,
      skipped: 1,
      conflicts: 0,
      failed: 0,
      errorSamples: [],
    };

    await markRestoreJobCompletedInternal(createAuthCtx(db, null), {
      jobId: first.jobId,
      status: "succeeded",
      completedAt: now + 200,
      exportedAt: "2026-04-04T09:00:00.000Z",
      sourceCounts: {
        summaries: 1,
        memories: 1,
        days: 0,
        integrationDailyData: 0,
      },
      totals: sharedStats,
      datasetResults: {
        summaries: sharedStats,
        memories: sharedStats,
        days: {
          processed: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          conflicts: 0,
          failed: 0,
          errorSamples: [],
        },
        integrationDailyData: {
          processed: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          conflicts: 0,
          failed: 0,
          errorSamples: [],
        },
      },
    });

    const second = await createRestoreJobInternal(createAuthCtx(db, null), {
      userId: USER_ID,
      requestedAt: now + 500,
      conflictMode: "overwrite",
      allowPartial: false,
      selectedDatasets: ["days"],
    });
    await markRestoreJobFailedInternal(createAuthCtx(db, null), {
      jobId: second.jobId,
      failedAt: now + 650,
      error: "Backup integrity check failed",
    });

    const memberPage = await listMyRestoreJobsPaginated(
      createAuthCtx(db, "clerk_member_001"),
      {
        paginationOpts: { numItems: 10, cursor: null },
      },
    );

    expect(memberPage.page).toHaveLength(2);
    expect(memberPage.page[0]?.status).toBe("failed");
    expect(memberPage.page[0]?.error).toBe("Backup integrity check failed");
    expect(memberPage.page[0]?.selectedDatasets).toEqual(["days"]);
    expect(memberPage.page[1]?.status).toBe("succeeded");
    expect(memberPage.page[1]?.totals?.inserted).toBe(1);

    const otherPage = await listMyRestoreJobsPaginated(
      createAuthCtx(db, "clerk_other_001"),
      {
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(otherPage.page).toHaveLength(0);
  });

  it("returns clear errors for invalid export job state and missing artifacts", async () => {
    const db = seededDb();

    const getMyExportJobDownloadUrl = handler<
      { jobId: string },
      { status: string; fileName: string | null; downloadUrl: string }
    >(summariesModule.getMyExportJobDownloadUrl);

    const queuedJobId = await db.insert("exportJobs", {
      userId: USER_ID,
      status: "queued",
      format: "json",
      includeLocationSignals: false,
      requestedAt: 100,
      updatedAt: 100,
      expiresAt: 200,
    });

    const readyJobId = await db.insert("exportJobs", {
      userId: USER_ID,
      status: "ready",
      format: "json",
      includeLocationSignals: false,
      requestedAt: 110,
      updatedAt: 120,
      completedAt: 120,
      expiresAt: 220,
      artifactStorageId: "storage_missing_link_001",
      artifactFileName: "daylog-export-2026-04-03.json",
      artifactMimeType: "application/json; charset=utf-8",
      artifactSizeBytes: 1024,
    });

    const ctx = {
      ...createAuthCtx(db, "clerk_member_001"),
      storage: {
        getUrl: vi.fn(async () => null),
      },
    };

    await expect(
      getMyExportJobDownloadUrl(ctx, {
        jobId: "job_missing_001",
      }),
    ).rejects.toThrow("Export job not found");

    await expect(
      getMyExportJobDownloadUrl(ctx, {
        jobId: String(queuedJobId),
      }),
    ).rejects.toThrow("Export is not ready for download yet.");

    await expect(
      getMyExportJobDownloadUrl(ctx, {
        jobId: String(readyJobId),
      }),
    ).rejects.toThrow("Export artifact is no longer available.");
  });

  it("fails internal export job mutations for unknown job ids", async () => {
    const db = seededDb();

    const markExportJobRunningInternal = handler<
      { jobId: string; startedAt: number },
      { jobId: string; status: "running"; startedAt: number }
    >(summariesModule.markExportJobRunningInternal);
    const markExportJobReadyInternal = handler<
      {
        jobId: string;
        completedAt: number;
        storageId: string;
        fileName: string;
        artifactMimeType: string;
        artifactSizeBytes: number;
        counts: {
          summaries: number;
          memories: number;
          days: number;
          integrationDailyData: number;
        };
      },
      { jobId: string; status: "ready"; completedAt: number }
    >(summariesModule.markExportJobReadyInternal);
    const markExportJobFailedInternal = handler<
      { jobId: string; failedAt: number; error: string },
      { jobId: string; status: "failed"; failedAt: number }
    >(summariesModule.markExportJobFailedInternal);

    const ctx = createAuthCtx(db, null);

    await expect(
      markExportJobRunningInternal(ctx, {
        jobId: "job_missing_001",
        startedAt: 100,
      }),
    ).rejects.toThrow("Export job not found");

    await expect(
      markExportJobReadyInternal(ctx, {
        jobId: "job_missing_001",
        completedAt: 110,
        storageId: "storage_001",
        fileName: "daylog-export.json",
        artifactMimeType: "application/json; charset=utf-8",
        artifactSizeBytes: 10,
        counts: {
          summaries: 0,
          memories: 0,
          days: 0,
          integrationDailyData: 0,
        },
      }),
    ).rejects.toThrow("Export job not found");

    await expect(
      markExportJobFailedInternal(ctx, {
        jobId: "job_missing_001",
        failedAt: 120,
        error: "failed",
      }),
    ).rejects.toThrow("Export job not found");
  });

  it("purges stale export jobs and artifacts during scheduled cleanup", async () => {
    process.env.RETENTION_EXPORT_JOBS_DAYS = "14";

    const now = Date.parse("2026-04-10T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);

    const db = seededDb();
    await db.insert("exportJobs", {
      userId: USER_ID,
      status: "ready",
      format: "json",
      includeLocationSignals: false,
      requestedAt: now - 30 * 24 * 60 * 60 * 1000,
      updatedAt: now - 30 * 24 * 60 * 60 * 1000,
      completedAt: now - 30 * 24 * 60 * 60 * 1000,
      expiresAt: now - 16 * 24 * 60 * 60 * 1000,
      artifactStorageId: "storage_old_export",
      artifactFileName: "old-export.json",
    });
    await db.insert("exportJobs", {
      userId: USER_ID,
      status: "ready",
      format: "json",
      includeLocationSignals: false,
      requestedAt: now - 2 * 24 * 60 * 60 * 1000,
      updatedAt: now - 2 * 24 * 60 * 60 * 1000,
      completedAt: now - 2 * 24 * 60 * 60 * 1000,
      expiresAt: now + 10 * 24 * 60 * 60 * 1000,
      artifactStorageId: "storage_fresh_export",
      artifactFileName: "fresh-export.json",
    });

    const runScheduledExportJobRetentionCleanupInternal = handler<
      { maxDeletes?: number },
      { deletedJobs: number; deletedArtifacts: number; retentionDays: number }
    >(summariesModule.runScheduledExportJobRetentionCleanupInternal);

    const cleanupCtx = {
      ...createAuthCtx(db, null),
      storage: {
        delete: vi.fn(async () => undefined),
      },
    };

    const cleanup = await runScheduledExportJobRetentionCleanupInternal(
      cleanupCtx,
      {
        maxDeletes: 10,
      },
    );

    expect(cleanup.retentionDays).toBe(14);
    expect(cleanup.deletedJobs).toBe(1);
    expect(cleanup.deletedArtifacts).toBe(1);
    expect(cleanupCtx.storage.delete).toHaveBeenCalledWith(
      "storage_old_export",
    );

    const remainingJobs = db.getTable("exportJobs");
    expect(remainingJobs).toHaveLength(1);
    expect(remainingJobs[0]?.artifactStorageId).toBe("storage_fresh_export");
  });

  it("uses default retention batch size and tolerates artifact delete failures", async () => {
    process.env.RETENTION_EXPORT_JOBS_DAYS = "14";

    const now = Date.parse("2026-04-10T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);

    const db = seededDb();
    await db.insert("exportJobs", {
      userId: USER_ID,
      status: "ready",
      format: "json",
      includeLocationSignals: false,
      requestedAt: now - 30 * 24 * 60 * 60 * 1000,
      updatedAt: now - 30 * 24 * 60 * 60 * 1000,
      completedAt: now - 30 * 24 * 60 * 60 * 1000,
      expiresAt: now - 16 * 24 * 60 * 60 * 1000,
      artifactStorageId: "storage_old_export_delete_fails",
      artifactFileName: "old-export.json",
    });

    const runScheduledExportJobRetentionCleanupInternal = handler<
      { maxDeletes?: number },
      { deletedJobs: number; deletedArtifacts: number; retentionDays: number }
    >(summariesModule.runScheduledExportJobRetentionCleanupInternal);

    const cleanupCtx = {
      ...createAuthCtx(db, null),
      storage: {
        delete: vi.fn(async () => {
          throw new Error("already deleted");
        }),
      },
    };

    const cleanup = await runScheduledExportJobRetentionCleanupInternal(
      cleanupCtx,
      {},
    );

    expect(cleanup.retentionDays).toBe(14);
    expect(cleanup.deletedJobs).toBe(1);
    expect(cleanup.deletedArtifacts).toBe(0);
    expect(cleanupCtx.storage.delete).toHaveBeenCalledWith(
      "storage_old_export_delete_fails",
    );
    expect(db.getTable("exportJobs")).toHaveLength(0);
  });

  it("purges stale restore jobs during scheduled cleanup", async () => {
    process.env.RETENTION_RESTORE_JOBS_DAYS = "14";

    const now = Date.parse("2026-04-10T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);

    const db = seededDb();
    await db.insert("restoreJobs", {
      userId: USER_ID,
      status: "succeeded",
      requestedAt: now - 30 * 24 * 60 * 60 * 1000,
      completedAt: now - 30 * 24 * 60 * 60 * 1000,
      updatedAt: now - 30 * 24 * 60 * 60 * 1000,
      conflictMode: "skip",
      allowPartial: true,
      selectedDatasets: ["summaries"],
      exportedAt: "2026-03-11T12:00:00.000Z",
    });
    await db.insert("restoreJobs", {
      userId: USER_ID,
      status: "failed",
      requestedAt: now - 2 * 24 * 60 * 60 * 1000,
      failedAt: now - 2 * 24 * 60 * 60 * 1000,
      updatedAt: now - 2 * 24 * 60 * 60 * 1000,
      conflictMode: "overwrite",
      allowPartial: false,
      selectedDatasets: ["days"],
      error: "Integrity mismatch",
    });

    const runScheduledRestoreJobRetentionCleanupInternal = handler<
      { maxDeletes?: number },
      { deletedJobs: number; retentionDays: number }
    >(summariesModule.runScheduledRestoreJobRetentionCleanupInternal);

    const cleanup = await runScheduledRestoreJobRetentionCleanupInternal(
      createAuthCtx(db, null),
      {
        maxDeletes: 10,
      },
    );

    expect(cleanup.retentionDays).toBe(14);
    expect(cleanup.deletedJobs).toBe(1);

    const remainingJobs = db.getTable("restoreJobs");
    expect(remainingJobs).toHaveLength(1);
    expect(remainingJobs[0]?.status).toBe("failed");
  });

  it("uses fallback batch size when restore cleanup maxDeletes is invalid", async () => {
    process.env.RETENTION_RESTORE_JOBS_DAYS = "14";

    const now = Date.parse("2026-04-10T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);

    const db = seededDb();
    await db.insert("restoreJobs", {
      userId: USER_ID,
      status: "succeeded",
      requestedAt: now - 40 * 24 * 60 * 60 * 1000,
      completedAt: now - 40 * 24 * 60 * 60 * 1000,
      updatedAt: now - 40 * 24 * 60 * 60 * 1000,
      conflictMode: "skip",
      allowPartial: true,
      selectedDatasets: ["summaries"],
      exportedAt: "2026-03-01T12:00:00.000Z",
    });
    await db.insert("restoreJobs", {
      userId: USER_ID,
      status: "partial",
      requestedAt: now - 35 * 24 * 60 * 60 * 1000,
      completedAt: now - 35 * 24 * 60 * 60 * 1000,
      updatedAt: now - 35 * 24 * 60 * 60 * 1000,
      conflictMode: "skip",
      allowPartial: true,
      selectedDatasets: ["memories"],
      exportedAt: "2026-03-06T12:00:00.000Z",
    });

    const runScheduledRestoreJobRetentionCleanupInternal = handler<
      { maxDeletes?: number },
      { deletedJobs: number }
    >(summariesModule.runScheduledRestoreJobRetentionCleanupInternal);

    const cleanup = await runScheduledRestoreJobRetentionCleanupInternal(
      createAuthCtx(db, null),
      {
        maxDeletes: 0,
      },
    );

    expect(cleanup.deletedJobs).toBe(2);
    expect(db.getTable("restoreJobs")).toHaveLength(0);
  });

  it("runs export action lifecycle and marks jobs failed when generation throws", async () => {
    process.env.RETENTION_EXPORT_JOBS_DAYS = "14";

    const prepareMyDiaryExportArtifact = handler<
      { format?: "json" | "txt"; includeLocationSignals?: boolean },
      {
        jobId: string;
        status: "ready";
        requestedAt: number;
        expiresAt: number;
        completedAt: number;
      }
    >(summariesModule.prepareMyDiaryExportArtifact);

    const runQuery = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (Object.keys(args).length === 0) {
          return {
            userId: USER_ID,
            clerkUserId: "clerk_member_001",
          };
        }

        return {
          exportedAt: 1,
          dataset: args.dataset,
          page: [],
          continueCursor: null,
          isDone: true,
        };
      },
    );

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        jobId: "job_001",
        status: "queued",
        requestedAt: Date.parse("2026-04-10T12:00:00.000Z"),
        expiresAt: Date.parse("2026-04-24T12:00:00.000Z"),
      })
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValueOnce({ status: "ready" });

    const result = await prepareMyDiaryExportArtifact(
      {
        runQuery,
        runMutation,
        storage: {
          store: vi.fn(async (_blob: Blob) => "storage_export_001"),
          getUrl: vi.fn(
            async (storageId: string) => `https://cdn.example.com/${storageId}`,
          ),
        },
      } as any,
      {
        format: "json",
        includeLocationSignals: false,
      },
    );

    expect(result.jobId).toBe("job_001");
    expect(result.status).toBe("ready");
    expect(runMutation).toHaveBeenCalledTimes(3);

    const failingRunMutation = vi
      .fn()
      .mockResolvedValueOnce({
        jobId: "job_002",
        status: "queued",
        requestedAt: Date.parse("2026-04-10T12:00:00.000Z"),
        expiresAt: Date.parse("2026-04-24T12:00:00.000Z"),
      })
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValueOnce({ status: "failed" });

    await expect(
      prepareMyDiaryExportArtifact(
        {
          runQuery,
          runMutation: failingRunMutation,
          storage: {
            store: vi.fn(async () => {
              throw new Error("plain failure");
            }),
            getUrl: vi.fn(async () => null),
          },
        } as any,
        {},
      ),
    ).rejects.toThrow("plain failure");

    expect(failingRunMutation).toHaveBeenCalledTimes(3);
    const failedCallArgs = failingRunMutation.mock.calls[2]?.[1] as
      | { error?: string }
      | undefined;
    expect(failedCallArgs?.error).toBe("plain failure");
  });
});
