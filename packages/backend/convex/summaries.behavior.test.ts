import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as summariesModule from "./summaries";

const originalSummaryDailyLimit = process.env.SUMMARY_DAILY_GENERATION_LIMIT;
const originalExportJobsRetentionDays = process.env.RETENTION_EXPORT_JOBS_DAYS;

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
