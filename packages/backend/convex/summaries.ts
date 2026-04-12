import { v } from "convex/values";
import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { requireUser, requireOwnership } from "./authz";
import { validateDayKey, clampLimit } from "./validators";
import {
  getExportJobRetentionDays,
  getRetentionDeleteBatchSize,
  getSummaryDailyGenerationLimit,
} from "./runtimeConfig";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { applyDashboardMetricsDelta } from "./dashboardMetrics";

export function getUtcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

type SummaryDb = MutationCtx["db"];

type UpsertSummaryInput = {
  dayKey: string;
  story: string;
  highlights: string[];
  metrics?: {
    steps?: number;
    sleepMinutes?: number;
    screenTimeMinutes?: number;
    spendingTotal?: number;
  };
  sourcesUsed: string[];
};

export async function upsertSummaryForUserDay(
  db: SummaryDb,
  userId: Id<"user">,
  args: UpsertSummaryInput,
  now: number,
) {
  const existing = await db
    .query("daySummaries")
    .withIndex("by_user_day", (q) =>
      q.eq("userId", userId).eq("dayKey", args.dayKey),
    )
    .unique();

  if (existing) {
    await db.patch(existing._id, {
      story: args.story,
      highlights: args.highlights,
      metrics: args.metrics,
      sourcesUsed: args.sourcesUsed,
      generatedAt: now,
    });

    return await db.get(existing._id);
  }

  const id = await db.insert("daySummaries", {
    userId,
    dayKey: args.dayKey,
    story: args.story,
    highlights: args.highlights,
    metrics: args.metrics,
    sourcesUsed: args.sourcesUsed,
    generatedAt: now,
  });

  await applyDashboardMetricsDelta(db, {
    totalSummaries: 1,
  });

  return await db.get(id);
}

export async function reserveSummaryGenerationSlotForUser(
  db: SummaryDb,
  userId: Id<"user">,
  now: number,
  limit: number,
) {
  const quotaDayKey = getUtcDayKey(now);

  const existing = await db
    .query("summaryGenerationQuotas")
    .withIndex("by_user_day", (q) =>
      q.eq("userId", userId).eq("quotaDayKey", quotaDayKey),
    )
    .unique();

  const used = existing?.used ?? 0;
  if (used >= limit) {
    throw new Error(
      `Daily summary limit reached (${limit}/day). Please try again tomorrow.`,
    );
  }

  if (existing) {
    await db.patch(existing._id, {
      used: used + 1,
      updatedAt: now,
    });
  } else {
    await db.insert("summaryGenerationQuotas", {
      userId,
      quotaDayKey,
      used: 1,
      updatedAt: now,
    });
  }

  return {
    quotaDayKey,
    used: used + 1,
    limit,
    remaining: Math.max(limit - (used + 1), 0),
  };
}

// ── Get summary for a specific day ──────────────────────────
export const getSummaryByDay = query({
  args: {
    dayKey: v.string(),
    refreshToken: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    return await ctx.db
      .query("daySummaries")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .unique();
  },
});

// ── Get summary by document ID ──────────────────────────────
export const getSummaryById = query({
  args: { summaryId: v.id("daySummaries") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const summary = await ctx.db.get(args.summaryId);

    if (!summary) {
      throw new Error("Summary not found");
    }

    requireOwnership(user, summary.userId);
    return summary;
  },
});

// ── List recent summaries ───────────────────────────────────
export const listRecentSummaries = query({
  args: {
    limit: v.optional(v.number()),
    refreshToken: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const limit = clampLimit(args.limit ?? 7);

    return await ctx.db
      .query("daySummaries")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
  },
});

// ── Create or replace a day summary (typically called by a
//    backend action after AI generation) ─────────────────────
export const upsertSummary = mutation({
  args: {
    dayKey: v.string(),
    story: v.string(),
    highlights: v.array(v.string()),
    metrics: v.optional(
      v.object({
        steps: v.optional(v.number()),
        sleepMinutes: v.optional(v.number()),
        screenTimeMinutes: v.optional(v.number()),
        spendingTotal: v.optional(v.number()),
      }),
    ),
    sourcesUsed: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    validateDayKey(args.dayKey);
    const now = Date.now();
    return await upsertSummaryForUserDay(ctx.db, user._id, args, now);
  },
});

// ── Delete a summary ────────────────────────────────────────
export const deleteSummary = mutation({
  args: { summaryId: v.id("daySummaries") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const summary = await ctx.db.get(args.summaryId);

    if (!summary) {
      throw new Error("Summary not found");
    }

    requireOwnership(user, summary.userId);

    await ctx.db.delete(args.summaryId);

    await applyDashboardMetricsDelta(ctx.db, {
      totalSummaries: -1,
    });

    return { success: true };
  },
});

// ── Get current authenticated user's generation quota usage for today (UTC) ──
export const getSummaryQuotaForDay = query({
  args: {
    refreshToken: v.optional(v.number()),
  },
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const quotaDayKey = getUtcDayKey(Date.now());
    const limit = getSummaryDailyGenerationLimit();

    const quota = await ctx.db
      .query("summaryGenerationQuotas")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("quotaDayKey", quotaDayKey),
      )
      .unique();

    const used = quota?.used ?? 0;
    return {
      quotaDayKey,
      used,
      limit,
      remaining: Math.max(limit - used, 0),
    };
  },
});

// ── Reserve one generation slot for today (UTC). Throws when quota exceeded. ──
export const reserveSummaryGenerationSlot = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    const limit = getSummaryDailyGenerationLimit();

    return await reserveSummaryGenerationSlotForUser(
      ctx.db,
      user._id,
      now,
      limit,
    );
  },
});

export const getSummaryGenerationIdentity = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return {
      userId: user._id,
      clerkUserId: user.clerkUserId,
    };
  },
});

const exportDatasetValidator = v.union(
  v.literal("summaries"),
  v.literal("memories"),
  v.literal("days"),
  v.literal("integrationDailyData"),
);

const EXPORT_PAGE_SIZE_DEFAULT = 200;
const EXPORT_PAGE_SIZE_MAX = 500;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const exportFormatValidator = v.union(v.literal("json"), v.literal("txt"));

type ExportDataset = "summaries" | "memories" | "days" | "integrationDailyData";
type ExportFormat = "json" | "txt";
type ExportJobStatus = "queued" | "running" | "ready" | "failed";

type ExportSummaryRow = {
  dayKey: string;
  story: string;
  highlights: string[];
  metrics?: {
    steps?: number;
    sleepMinutes?: number;
    screenTimeMinutes?: number;
    spendingTotal?: number;
  };
  sourcesUsed: string[];
  generatedAt: number;
};

type ExportMemoryRow = {
  dayKey: string;
  title: string;
  description?: string;
  mood?: string;
  happenedAt: number;
};

type ExportDayRow = {
  dayKey: string;
  rating?: number;
  manualNotes: string[];
  peopleTags: string[];
};

type ExportIntegrationRow = {
  provider: string;
  dayKey: string;
  syncedAt: number;
  summary?: string;
  metrics?: {
    steps?: number;
    sleepMinutes?: number;
    screenTimeMinutes?: number;
    spendingTotal?: number;
  };
  signals?: string[];
  context?: unknown;
};

type ExportPageResponse<TItem> = {
  exportedAt: number;
  dataset: ExportDataset;
  page: TItem[];
  continueCursor: string | null;
  isDone: boolean;
};

type DiaryExportPayload = {
  exportedAt: number;
  summaries: ExportSummaryRow[];
  memories: ExportMemoryRow[];
  days: ExportDayRow[];
  integrationDailyData: ExportIntegrationRow[];
};

function sanitizeExportErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 220);
  }

  return "Export generation failed.";
}

const exportMyDiaryDataRef = makeFunctionReference<"query">(
  "summaries:exportMyDiaryData",
);
const getSummaryGenerationIdentityRef = makeFunctionReference<"query">(
  "summaries:getSummaryGenerationIdentity",
);
const createExportJobInternalRef = makeFunctionReference<"mutation">(
  "summaries:createExportJobInternal",
);
const markExportJobRunningInternalRef = makeFunctionReference<"mutation">(
  "summaries:markExportJobRunningInternal",
);
const markExportJobReadyInternalRef = makeFunctionReference<"mutation">(
  "summaries:markExportJobReadyInternal",
);
const markExportJobFailedInternalRef = makeFunctionReference<"mutation">(
  "summaries:markExportJobFailedInternal",
);

function toTextExport(data: DiaryExportPayload): string {
  const parts: string[] = [];
  parts.push("DayLog Export");
  parts.push(`Exported at: ${new Date(data.exportedAt).toISOString()}`);
  parts.push("");

  parts.push("=== Days ===");
  for (const day of data.days) {
    parts.push(`- ${day.dayKey}`);
    parts.push(`  Rating: ${day.rating ?? "-"}`);
    parts.push(`  Notes: ${day.manualNotes.length}`);
    parts.push(`  People tags: ${day.peopleTags.length}`);
  }
  parts.push("");

  parts.push("=== Memories ===");
  for (const memory of data.memories) {
    parts.push(`- [${memory.dayKey}] ${memory.title}`);
    parts.push(`  Mood: ${memory.mood ?? "-"}`);
    parts.push(`  Time: ${new Date(memory.happenedAt).toISOString()}`);
    if (memory.description?.trim()) {
      parts.push(`  Description: ${memory.description.trim()}`);
    }
  }
  parts.push("");

  parts.push("=== Summaries ===");
  for (const summary of data.summaries) {
    parts.push(`- [${summary.dayKey}]`);
    parts.push(`  Story: ${summary.story}`);
    if (summary.highlights.length > 0) {
      parts.push(`  Highlights: ${summary.highlights.join(" | ")}`);
    }
  }
  parts.push("");

  parts.push("=== Integration Daily Data ===");
  for (const item of data.integrationDailyData) {
    parts.push(`- [${item.dayKey}] ${item.provider}`);
    if (item.summary) {
      parts.push(`  Summary: ${item.summary}`);
    }
    if ((item.signals?.length ?? 0) > 0) {
      parts.push(`  Signals: ${(item.signals ?? []).join(" | ")}`);
    }
  }

  return parts.join("\n");
}

async function collectDatasetPages<TItem>(
  ctx: Pick<ActionCtx, "runQuery">,
  args: {
    dataset: ExportDataset;
    includeLocationSignals: boolean;
  },
): Promise<TItem[]> {
  const rows: TItem[] = [];
  let cursor: string | undefined;

  while (true) {
    const response = (await ctx.runQuery(exportMyDiaryDataRef, {
      dataset: args.dataset,
      cursor,
      pageSize: EXPORT_PAGE_SIZE_MAX,
      includeLocationSignals: args.includeLocationSignals,
    })) as ExportPageResponse<TItem>;

    rows.push(...response.page);

    if (response.isDone || !response.continueCursor) {
      break;
    }

    cursor = response.continueCursor;
  }

  return rows;
}

export async function prepareDiaryExportArtifactImpl(
  ctx: Pick<ActionCtx, "runQuery" | "storage">,
  args: {
    format: ExportFormat;
    includeLocationSignals: boolean;
  },
) {
  await ctx.runQuery(getSummaryGenerationIdentityRef, {});

  const summaries = await collectDatasetPages<ExportSummaryRow>(ctx, {
    dataset: "summaries",
    includeLocationSignals: args.includeLocationSignals,
  });
  const memories = await collectDatasetPages<ExportMemoryRow>(ctx, {
    dataset: "memories",
    includeLocationSignals: args.includeLocationSignals,
  });
  const days = await collectDatasetPages<ExportDayRow>(ctx, {
    dataset: "days",
    includeLocationSignals: args.includeLocationSignals,
  });
  const integrationDailyData = await collectDatasetPages<ExportIntegrationRow>(
    ctx,
    {
      dataset: "integrationDailyData",
      includeLocationSignals: args.includeLocationSignals,
    },
  );

  const exportData: DiaryExportPayload = {
    exportedAt: Date.now(),
    summaries,
    memories,
    days,
    integrationDailyData,
  };

  const payloadText =
    args.format === "json"
      ? JSON.stringify(
          {
            ...exportData,
            exportedAt: new Date(exportData.exportedAt).toISOString(),
          },
          null,
          2,
        )
      : toTextExport(exportData);
  const artifactMimeType =
    args.format === "json"
      ? "application/json; charset=utf-8"
      : "text/plain; charset=utf-8";
  const artifactSizeBytes = new TextEncoder().encode(payloadText).length;

  const storageId = await ctx.storage.store(
    new Blob([payloadText], {
      type: artifactMimeType,
    }),
  );
  const downloadUrl = await ctx.storage.getUrl(storageId);

  if (!downloadUrl) {
    throw new Error("Unable to prepare export download URL. Please retry.");
  }

  const datePart = new Date(exportData.exportedAt).toISOString().split("T")[0];
  const fileName = `daylog-export-${datePart}.${args.format}`;

  return {
    exportedAt: exportData.exportedAt,
    format: args.format,
    fileName,
    storageId,
    downloadUrl,
    artifactMimeType,
    artifactSizeBytes,
    counts: {
      summaries: summaries.length,
      memories: memories.length,
      days: days.length,
      integrationDailyData: integrationDailyData.length,
    },
  };
}

export const exportMyDiaryData = query({
  args: {
    dataset: exportDatasetValidator,
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
    includeLocationSignals: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const includeLocationSignals = args.includeLocationSignals ?? false;
    const cursor = args.cursor ?? null;
    const pageSize = clampLimit(
      args.pageSize ?? EXPORT_PAGE_SIZE_DEFAULT,
      EXPORT_PAGE_SIZE_MAX,
    );

    if (args.dataset === "summaries") {
      const page = await ctx.db
        .query("daySummaries")
        .withIndex("by_user_generatedAt", (q) => q.eq("userId", user._id))
        .order("desc")
        .paginate({
          numItems: pageSize,
          cursor,
        });

      return {
        exportedAt: Date.now(),
        dataset: args.dataset,
        page: page.page.map((summary) => ({
          dayKey: summary.dayKey,
          story: summary.story,
          highlights: summary.highlights,
          metrics: summary.metrics,
          sourcesUsed: summary.sourcesUsed,
          generatedAt: summary.generatedAt,
        })),
        continueCursor: page.continueCursor,
        isDone: page.isDone,
      };
    }

    if (args.dataset === "memories") {
      const page = await ctx.db
        .query("memories")
        .withIndex("by_user_happenedAt", (q) => q.eq("userId", user._id))
        .order("desc")
        .paginate({
          numItems: pageSize,
          cursor,
        });

      return {
        exportedAt: Date.now(),
        dataset: args.dataset,
        page: page.page.map((memory) => ({
          dayKey: memory.dayKey,
          title: memory.title,
          description: memory.description,
          mood: memory.mood,
          happenedAt: memory.happenedAt,
        })),
        continueCursor: page.continueCursor,
        isDone: page.isDone,
      };
    }

    if (args.dataset === "days") {
      const page = await ctx.db
        .query("days")
        .withIndex("by_user_day", (q) => q.eq("userId", user._id))
        .order("desc")
        .paginate({
          numItems: pageSize,
          cursor,
        });

      return {
        exportedAt: Date.now(),
        dataset: args.dataset,
        page: page.page.map((day) => ({
          dayKey: day.dayKey,
          rating: day.rating,
          manualNotes: day.manualNotes ?? [],
          peopleTags: day.peopleTags ?? [],
        })),
        continueCursor: page.continueCursor,
        isDone: page.isDone,
      };
    }

    const integrationPage = await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate({
        numItems: pageSize,
        cursor,
      });

    const mappedIntegrationPage = integrationPage.page
      .filter((item) => includeLocationSignals || item.provider !== "location")
      .map((item) => ({
        provider: item.provider,
        dayKey: item.dayKey,
        syncedAt: item.syncedAt,
        summary: item.summary,
        metrics: item.metrics,
        signals: item.signals ?? [],
        context: item.context,
      }));

    return {
      exportedAt: Date.now(),
      dataset: args.dataset,
      page: mappedIntegrationPage,
      continueCursor: integrationPage.continueCursor,
      isDone: integrationPage.isDone,
    };
  },
});

export const createExportJobInternal = internalMutation({
  args: {
    userId: v.id("user"),
    format: exportFormatValidator,
    includeLocationSignals: v.boolean(),
    requestedAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const exportJobsDb = ctx.db as any;
    const jobId = await exportJobsDb.insert("exportJobs", {
      userId: args.userId,
      status: "queued" satisfies ExportJobStatus,
      format: args.format,
      includeLocationSignals: args.includeLocationSignals,
      requestedAt: args.requestedAt,
      updatedAt: args.requestedAt,
      expiresAt: args.expiresAt,
    });

    return {
      jobId: String(jobId),
      status: "queued" as ExportJobStatus,
      requestedAt: args.requestedAt,
      expiresAt: args.expiresAt,
    };
  },
});

export const markExportJobRunningInternal = internalMutation({
  args: {
    jobId: v.string(),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const exportJobsDb = ctx.db as any;
    const job = await exportJobsDb.get(args.jobId);
    if (!job) {
      throw new Error("Export job not found");
    }

    await exportJobsDb.patch(job._id, {
      status: "running",
      startedAt: args.startedAt,
      updatedAt: args.startedAt,
    });

    return {
      jobId: String(job._id),
      status: "running" as ExportJobStatus,
      startedAt: args.startedAt,
    };
  },
});

export const markExportJobReadyInternal = internalMutation({
  args: {
    jobId: v.string(),
    completedAt: v.number(),
    storageId: v.string(),
    fileName: v.string(),
    artifactMimeType: v.string(),
    artifactSizeBytes: v.number(),
    counts: v.object({
      summaries: v.number(),
      memories: v.number(),
      days: v.number(),
      integrationDailyData: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const exportJobsDb = ctx.db as any;
    const job = await exportJobsDb.get(args.jobId);
    if (!job) {
      throw new Error("Export job not found");
    }

    await exportJobsDb.patch(job._id, {
      status: "ready",
      completedAt: args.completedAt,
      updatedAt: args.completedAt,
      artifactStorageId: args.storageId,
      artifactFileName: args.fileName,
      artifactMimeType: args.artifactMimeType,
      artifactSizeBytes: args.artifactSizeBytes,
      counts: args.counts,
    });

    return {
      jobId: String(job._id),
      status: "ready" as ExportJobStatus,
      completedAt: args.completedAt,
    };
  },
});

export const markExportJobFailedInternal = internalMutation({
  args: {
    jobId: v.string(),
    failedAt: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const exportJobsDb = ctx.db as any;
    const job = await exportJobsDb.get(args.jobId);
    if (!job) {
      throw new Error("Export job not found");
    }

    await exportJobsDb.patch(job._id, {
      status: "failed",
      failedAt: args.failedAt,
      updatedAt: args.failedAt,
      error: args.error,
    });

    return {
      jobId: String(job._id),
      status: "failed" as ExportJobStatus,
      failedAt: args.failedAt,
    };
  },
});

export const listMyExportJobsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const exportJobsDb = ctx.db as any;
    const page = await exportJobsDb
      .query("exportJobs")
      .withIndex("by_user_requestedAt", (q: any) => q.eq("userId", user._id))
      .order("desc")
      .paginate(args.paginationOpts);

    const mappedPage = await Promise.all(
      page.page.map(async (job: any) => {
        const downloadUrl =
          job.status === "ready" && typeof job.artifactStorageId === "string"
            ? await ctx.storage.getUrl(job.artifactStorageId)
            : null;

        return {
          jobId: String(job._id),
          status: job.status,
          format: job.format,
          includeLocationSignals: Boolean(job.includeLocationSignals),
          requestedAt: job.requestedAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          failedAt: job.failedAt,
          updatedAt: job.updatedAt,
          error: job.error,
          expiresAt: job.expiresAt,
          counts: job.counts ?? null,
          fileName: job.artifactFileName ?? null,
          artifactMimeType: job.artifactMimeType ?? null,
          artifactSizeBytes:
            typeof job.artifactSizeBytes === "number"
              ? job.artifactSizeBytes
              : null,
          downloadUrl,
        };
      }),
    );

    return {
      ...page,
      page: mappedPage,
    };
  },
});

export const getMyExportJobDownloadUrl = query({
  args: {
    jobId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const exportJobsDb = ctx.db as any;
    const job = await exportJobsDb.get(args.jobId);

    if (!job) {
      throw new Error("Export job not found");
    }

    requireOwnership(user, job.userId);

    if (job.status !== "ready" || typeof job.artifactStorageId !== "string") {
      throw new Error("Export is not ready for download yet.");
    }

    const downloadUrl = await ctx.storage.getUrl(job.artifactStorageId);
    if (!downloadUrl) {
      throw new Error("Export artifact is no longer available.");
    }

    return {
      jobId: String(job._id),
      status: job.status,
      format: job.format,
      fileName: job.artifactFileName ?? null,
      artifactMimeType: job.artifactMimeType ?? null,
      artifactSizeBytes:
        typeof job.artifactSizeBytes === "number"
          ? job.artifactSizeBytes
          : null,
      downloadUrl,
      expiresAt: job.expiresAt,
    };
  },
});

export const runScheduledExportJobRetentionCleanupInternal = internalMutation({
  args: {
    maxDeletes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxDeletes =
      typeof args.maxDeletes === "number" &&
      Number.isFinite(args.maxDeletes) &&
      args.maxDeletes > 0
        ? Math.min(Math.floor(args.maxDeletes), 5000)
        : getRetentionDeleteBatchSize();

    const now = Date.now();
    const retentionDays = getExportJobRetentionDays();
    const cutoff = now - retentionDays * MS_PER_DAY;

    const exportJobsDb = ctx.db as any;
    const staleJobs = await exportJobsDb
      .query("exportJobs")
      .withIndex("by_requestedAt", (q: any) => q.lt("requestedAt", cutoff))
      .order("asc")
      .take(maxDeletes);

    let deletedArtifacts = 0;
    let deletedJobs = 0;

    for (const job of staleJobs) {
      if (typeof job.artifactStorageId === "string" && job.artifactStorageId) {
        try {
          await ctx.storage.delete(job.artifactStorageId);
          deletedArtifacts += 1;
        } catch {
          // Ignore missing or already-deleted artifacts during cleanup.
        }
      }

      await exportJobsDb.delete(job._id);
      deletedJobs += 1;
    }

    return {
      retentionDays,
      cutoff,
      deletedJobs,
      deletedArtifacts,
    };
  },
});

export const prepareMyDiaryExportArtifact = action({
  args: {
    format: v.optional(exportFormatValidator),
    includeLocationSignals: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = (await ctx.runQuery(
      getSummaryGenerationIdentityRef,
      {},
    )) as {
      userId: Id<"user">;
      clerkUserId: string;
    };
    const format = args.format ?? "json";
    const includeLocationSignals = args.includeLocationSignals ?? false;
    const requestedAt = Date.now();
    const expiresAt = requestedAt + getExportJobRetentionDays() * MS_PER_DAY;

    const createdJob = (await ctx.runMutation(createExportJobInternalRef, {
      userId: identity.userId,
      format,
      includeLocationSignals,
      requestedAt,
      expiresAt,
    })) as {
      jobId: string;
      status: ExportJobStatus;
      requestedAt: number;
      expiresAt: number;
    };

    try {
      await ctx.runMutation(markExportJobRunningInternalRef, {
        jobId: createdJob.jobId,
        startedAt: Date.now(),
      });

      const preparedExport = await prepareDiaryExportArtifactImpl(ctx, {
        format,
        includeLocationSignals,
      });
      const completedAt = Date.now();

      await ctx.runMutation(markExportJobReadyInternalRef, {
        jobId: createdJob.jobId,
        completedAt,
        storageId: String(preparedExport.storageId),
        fileName: preparedExport.fileName,
        artifactMimeType: preparedExport.artifactMimeType,
        artifactSizeBytes: preparedExport.artifactSizeBytes,
        counts: preparedExport.counts,
      });

      return {
        ...preparedExport,
        jobId: createdJob.jobId,
        status: "ready" as ExportJobStatus,
        requestedAt: createdJob.requestedAt,
        expiresAt: createdJob.expiresAt,
        completedAt,
      };
    } catch (error) {
      try {
        await ctx.runMutation(markExportJobFailedInternalRef, {
          jobId: createdJob.jobId,
          failedAt: Date.now(),
          error: sanitizeExportErrorMessage(error),
        });
      } catch {
        // Preserve original export failure when state update fails.
      }

      throw error;
    }
  },
});
