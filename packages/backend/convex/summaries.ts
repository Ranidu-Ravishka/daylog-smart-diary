import { v } from "convex/values";
import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { requireUser, requireOwnership } from "./authz";
import { validateDayKey, clampLimit } from "./validators";
import {
  getExportJobRetentionDays,
  getRestoreJobRetentionDays,
  getRetentionDeleteBatchSize,
  getSummaryDailyGenerationLimit,
} from "./runtimeConfig";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { applyDashboardMetricsDelta } from "./dashboardMetrics";
import { captureException, logInfo } from "./observability";
import type { IntegrationDailyContext } from "./integrations.dailyData";
import {
  buildDaySensitiveWritePayload,
  buildIntegrationDailySensitiveWritePayload,
  buildMemorySensitiveWritePayload,
  buildSummarySensitiveWritePayload,
  readDaySensitiveFields,
  readIntegrationDailySensitiveFields,
  readMemorySensitiveFields,
  readSummarySensitiveFields,
  withSummarySensitiveFields,
  type SummarySensitiveRecord,
} from "./sensitiveDataFields";

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

type SummaryDocRecord = Doc<"daySummaries"> & SummarySensitiveRecord;

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

  const encryptedPayload = await buildSummarySensitiveWritePayload({
    userId,
    story: args.story,
    highlights: args.highlights,
    sensitiveDataNonce: existing?.sensitiveDataNonce,
    now,
  });

  if (existing) {
    await db.patch(existing._id, {
      ...encryptedPayload,
      metrics: args.metrics,
      sourcesUsed: args.sourcesUsed,
      generatedAt: now,
    });

    return await withSummarySensitiveFields(
      (await db.get(existing._id)) as SummaryDocRecord,
    );
  }

  const id = await db.insert("daySummaries", {
    userId,
    dayKey: args.dayKey,
    ...encryptedPayload,
    metrics: args.metrics,
    sourcesUsed: args.sourcesUsed,
    generatedAt: now,
  });

  await applyDashboardMetricsDelta(db, {
    totalSummaries: 1,
  });

  return await withSummarySensitiveFields(
    (await db.get(id)) as SummaryDocRecord,
  );
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

    const summary = await ctx.db
      .query("daySummaries")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .unique();

    if (!summary) {
      return null;
    }

    return await withSummarySensitiveFields(summary as SummaryDocRecord);
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
    return await withSummarySensitiveFields(summary as SummaryDocRecord);
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

    const summaries = await ctx.db
      .query("daySummaries")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    return await Promise.all(
      summaries.map(
        async (summary) =>
          await withSummarySensitiveFields(summary as SummaryDocRecord),
      ),
    );
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
    const startedAt = Date.now();

    logInfo("deletion.summary.started", {
      status: "started",
      userId: user._id,
      summaryId: args.summaryId,
    });

    try {
      const summary = await ctx.db.get(args.summaryId);

      if (!summary) {
        throw new Error("Summary not found");
      }

      requireOwnership(user, summary.userId);

      await ctx.db.delete(args.summaryId);

      await applyDashboardMetricsDelta(ctx.db, {
        totalSummaries: -1,
      });

      logInfo("deletion.summary.succeeded", {
        status: "succeeded",
        userId: user._id,
        summaryId: args.summaryId,
        dayKey: summary.dayKey,
        durationMs: Date.now() - startedAt,
      });

      return { success: true };
    } catch (error) {
      captureException("deletion.summary.failed", error, {
        status: "failed",
        userId: user._id,
        summaryId: args.summaryId,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
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
const RESTORE_SCHEMA_VERSION = 2;
const RESTORE_SIGNING_ALGORITHM = "hmac-sha256";
const RESTORE_MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
const RESTORE_BATCH_SIZE = 100;

const exportFormatValidator = v.union(v.literal("json"), v.literal("txt"));
const restoreConflictModeValidator = v.union(
  v.literal("skip"),
  v.literal("overwrite"),
);
const restoreBatchResultObjectValidator = v.object({
  processed: v.number(),
  inserted: v.number(),
  updated: v.number(),
  skipped: v.number(),
  conflicts: v.number(),
  failed: v.number(),
  errorSamples: v.array(v.string()),
});
const restoreDatasetResultsValidator = v.object({
  summaries: restoreBatchResultObjectValidator,
  memories: restoreBatchResultObjectValidator,
  days: restoreBatchResultObjectValidator,
  integrationDailyData: restoreBatchResultObjectValidator,
});
const exportCountsObjectValidator = v.object({
  summaries: v.number(),
  memories: v.number(),
  days: v.number(),
  integrationDailyData: v.number(),
});
const exportMetricsObjectValidator = v.object({
  steps: v.optional(v.number()),
  sleepMinutes: v.optional(v.number()),
  screenTimeMinutes: v.optional(v.number()),
  spendingTotal: v.optional(v.number()),
});
const integrationLocationStayPointObjectValidator = v.object({
  label: v.string(),
  startedAt: v.number(),
  endedAt: v.number(),
  durationMinutes: v.number(),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  radiusMeters: v.optional(v.number()),
});
const integrationDailyContextObjectValidator = v.object({
  schemaVersion: v.optional(v.number()),
  location: v.optional(
    v.object({
      mode: v.union(
        v.literal("foreground"),
        v.literal("background_controlled"),
      ),
      totalTrackedMinutes: v.optional(v.number()),
      totalDistanceMeters: v.optional(v.number()),
      stayPoints: v.optional(
        v.array(integrationLocationStayPointObjectValidator),
      ),
    }),
  ),
  fitness: v.optional(
    v.object({
      steps: v.optional(v.number()),
      distanceMeters: v.optional(v.number()),
      activeMinutes: v.optional(v.number()),
      idleMinutes: v.optional(v.number()),
      source: v.optional(v.string()),
    }),
  ),
  calendar: v.optional(
    v.object({
      meetingsCount: v.optional(v.number()),
      busyMinutes: v.optional(v.number()),
      remindersCount: v.optional(v.number()),
      eventTitles: v.optional(v.array(v.string())),
    }),
  ),
  activitySummary: v.optional(
    v.object({
      callsCount: v.optional(v.number()),
      callDurationMinutes: v.optional(v.number()),
      mood: v.optional(v.string()),
      moodConfidence: v.optional(v.number()),
      activityLevel: v.optional(
        v.union(v.literal("active"), v.literal("mixed"), v.literal("idle")),
      ),
    }),
  ),
});
const exportSummaryRowObjectValidator = v.object({
  dayKey: v.string(),
  story: v.string(),
  highlights: v.array(v.string()),
  metrics: v.optional(exportMetricsObjectValidator),
  sourcesUsed: v.array(v.string()),
  generatedAt: v.number(),
});
const exportMemoryRowObjectValidator = v.object({
  clientRequestId: v.optional(v.string()),
  dayKey: v.string(),
  title: v.string(),
  description: v.optional(v.string()),
  mood: v.optional(v.string()),
  happenedAt: v.number(),
});
const exportDayRowObjectValidator = v.object({
  dayKey: v.string(),
  rating: v.optional(v.number()),
  manualNotes: v.array(v.string()),
  peopleTags: v.array(v.string()),
});
const exportIntegrationRowObjectValidator = v.object({
  provider: v.string(),
  dayKey: v.string(),
  syncedAt: v.number(),
  summary: v.optional(v.string()),
  metrics: v.optional(exportMetricsObjectValidator),
  signals: v.optional(v.array(v.string())),
  context: v.optional(integrationDailyContextObjectValidator),
});
const restoreRowObjectValidator = v.union(
  exportSummaryRowObjectValidator,
  exportMemoryRowObjectValidator,
  exportDayRowObjectValidator,
  exportIntegrationRowObjectValidator,
);

type ExportDataset = "summaries" | "memories" | "days" | "integrationDailyData";
type ExportFormat = "json" | "txt";
type ExportJobStatus = "queued" | "running" | "ready" | "failed";
type RestoreJobStatus = "running" | "succeeded" | "partial" | "failed";
type RestoreConflictMode = "skip" | "overwrite";

type ExportMetrics = {
  steps?: number;
  sleepMinutes?: number;
  screenTimeMinutes?: number;
  spendingTotal?: number;
};

type ExportSummaryRow = {
  dayKey: string;
  story: string;
  highlights: string[];
  metrics?: ExportMetrics;
  sourcesUsed: string[];
  generatedAt: number;
};

type ExportMemoryRow = {
  clientRequestId?: string;
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
  metrics?: ExportMetrics;
  signals?: string[];
  context?: IntegrationDailyContext;
};

type ExportCounts = {
  summaries: number;
  memories: number;
  days: number;
  integrationDailyData: number;
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

type SignedDiaryExportPayload = {
  schemaVersion: typeof RESTORE_SCHEMA_VERSION;
  exportedAt: string;
  owner: {
    clerkUserId: string;
  };
  counts: ExportCounts;
  summaries: ExportSummaryRow[];
  memories: ExportMemoryRow[];
  days: ExportDayRow[];
  integrationDailyData: ExportIntegrationRow[];
};

type SignedDiaryExportPayloadWithIntegrity = SignedDiaryExportPayload & {
  integrity: {
    algorithm: typeof RESTORE_SIGNING_ALGORITHM;
    signature: string;
  };
};

type RestoreBatchResult = {
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  conflicts: number;
  failed: number;
  errorSamples: string[];
};

type RestoreBatchDatasetArgs = {
  userId: Id<"user">;
  dataset: ExportDataset;
  rows: RestoreImportRow[];
  conflictMode: RestoreConflictMode;
  allowPartial: boolean;
};

type RestoreImportRow =
  | ExportSummaryRow
  | ExportMemoryRow
  | ExportDayRow
  | ExportIntegrationRow;

function createEmptyRestoreBatchResult(): RestoreBatchResult {
  return {
    processed: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    conflicts: 0,
    failed: 0,
    errorSamples: [],
  };
}

function mergeRestoreBatchResults(
  target: RestoreBatchResult,
  next: RestoreBatchResult,
): RestoreBatchResult {
  target.processed += next.processed;
  target.inserted += next.inserted;
  target.updated += next.updated;
  target.skipped += next.skipped;
  target.conflicts += next.conflicts;
  target.failed += next.failed;

  for (const error of next.errorSamples) {
    if (target.errorSamples.length >= 10) {
      break;
    }
    target.errorSamples.push(error);
  }

  return target;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${fieldName}: expected string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${fieldName}: cannot be empty`);
  }

  return trimmed;
}

function parseOptionalString(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Invalid ${fieldName}: expected string`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ${fieldName}: expected finite number`);
  }

  return value;
}

function parseOptionalFiniteNumber(
  value: unknown,
  fieldName: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return parseFiniteNumber(value, fieldName);
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${fieldName}: expected array`);
  }

  return value.map((item, index) =>
    assertNonEmptyString(item, `${fieldName}[${index}]`),
  );
}

function parseOptionalMetrics(
  value: unknown,
  fieldName: string,
): ExportMetrics | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid ${fieldName}: expected object`);
  }

  const parsed: ExportMetrics = {};
  parsed.steps = parseOptionalFiniteNumber(value.steps, `${fieldName}.steps`);
  parsed.sleepMinutes = parseOptionalFiniteNumber(
    value.sleepMinutes,
    `${fieldName}.sleepMinutes`,
  );
  parsed.screenTimeMinutes = parseOptionalFiniteNumber(
    value.screenTimeMinutes,
    `${fieldName}.screenTimeMinutes`,
  );
  parsed.spendingTotal = parseOptionalFiniteNumber(
    value.spendingTotal,
    `${fieldName}.spendingTotal`,
  );

  const hasValues = Object.values(parsed).some((item) => item !== undefined);
  return hasValues ? parsed : undefined;
}

function parseLocationMode(
  value: unknown,
  fieldName: string,
): "foreground" | "background_controlled" {
  if (value === "foreground" || value === "background_controlled") {
    return value;
  }

  throw new Error(
    `Invalid ${fieldName}: expected "foreground" or "background_controlled"`,
  );
}

function parseIntegrationStayPoint(
  value: unknown,
  fieldName: string,
): NonNullable<
  NonNullable<IntegrationDailyContext["location"]>["stayPoints"]
>[number] {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${fieldName}: expected object`);
  }

  return {
    label: assertNonEmptyString(value.label, `${fieldName}.label`),
    startedAt: parseFiniteNumber(value.startedAt, `${fieldName}.startedAt`),
    endedAt: parseFiniteNumber(value.endedAt, `${fieldName}.endedAt`),
    durationMinutes: parseFiniteNumber(
      value.durationMinutes,
      `${fieldName}.durationMinutes`,
    ),
    latitude: parseOptionalFiniteNumber(
      value.latitude,
      `${fieldName}.latitude`,
    ),
    longitude: parseOptionalFiniteNumber(
      value.longitude,
      `${fieldName}.longitude`,
    ),
    radiusMeters: parseOptionalFiniteNumber(
      value.radiusMeters,
      `${fieldName}.radiusMeters`,
    ),
  };
}

function parseOptionalIntegrationLocation(
  value: unknown,
  fieldName: string,
): IntegrationDailyContext["location"] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid ${fieldName}: expected object`);
  }

  const rawStayPoints = value.stayPoints;
  const stayPoints =
    rawStayPoints === undefined
      ? undefined
      : Array.isArray(rawStayPoints)
        ? rawStayPoints.map((item, index) =>
            parseIntegrationStayPoint(
              item,
              `${fieldName}.stayPoints[${index}]`,
            ),
          )
        : (() => {
            throw new Error(`Invalid ${fieldName}.stayPoints: expected array`);
          })();

  return {
    mode: parseLocationMode(value.mode, `${fieldName}.mode`),
    totalTrackedMinutes: parseOptionalFiniteNumber(
      value.totalTrackedMinutes,
      `${fieldName}.totalTrackedMinutes`,
    ),
    totalDistanceMeters: parseOptionalFiniteNumber(
      value.totalDistanceMeters,
      `${fieldName}.totalDistanceMeters`,
    ),
    stayPoints,
  };
}

function parseOptionalIntegrationFitness(
  value: unknown,
  fieldName: string,
): IntegrationDailyContext["fitness"] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid ${fieldName}: expected object`);
  }

  return {
    steps: parseOptionalFiniteNumber(value.steps, `${fieldName}.steps`),
    distanceMeters: parseOptionalFiniteNumber(
      value.distanceMeters,
      `${fieldName}.distanceMeters`,
    ),
    activeMinutes: parseOptionalFiniteNumber(
      value.activeMinutes,
      `${fieldName}.activeMinutes`,
    ),
    idleMinutes: parseOptionalFiniteNumber(
      value.idleMinutes,
      `${fieldName}.idleMinutes`,
    ),
    source: parseOptionalString(value.source, `${fieldName}.source`),
  };
}

function parseOptionalIntegrationCalendar(
  value: unknown,
  fieldName: string,
): IntegrationDailyContext["calendar"] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid ${fieldName}: expected object`);
  }

  return {
    meetingsCount: parseOptionalFiniteNumber(
      value.meetingsCount,
      `${fieldName}.meetingsCount`,
    ),
    busyMinutes: parseOptionalFiniteNumber(
      value.busyMinutes,
      `${fieldName}.busyMinutes`,
    ),
    remindersCount: parseOptionalFiniteNumber(
      value.remindersCount,
      `${fieldName}.remindersCount`,
    ),
    eventTitles:
      value.eventTitles === undefined
        ? undefined
        : parseStringArray(value.eventTitles, `${fieldName}.eventTitles`),
  };
}

function parseActivityLevel(
  value: unknown,
  fieldName: string,
): "active" | "mixed" | "idle" | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value === "active" || value === "mixed" || value === "idle") {
    return value;
  }

  throw new Error(
    `Invalid ${fieldName}: expected "active", "mixed", or "idle"`,
  );
}

function parseOptionalIntegrationActivitySummary(
  value: unknown,
  fieldName: string,
): IntegrationDailyContext["activitySummary"] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid ${fieldName}: expected object`);
  }

  return {
    callsCount: parseOptionalFiniteNumber(
      value.callsCount,
      `${fieldName}.callsCount`,
    ),
    callDurationMinutes: parseOptionalFiniteNumber(
      value.callDurationMinutes,
      `${fieldName}.callDurationMinutes`,
    ),
    mood: parseOptionalString(value.mood, `${fieldName}.mood`),
    moodConfidence: parseOptionalFiniteNumber(
      value.moodConfidence,
      `${fieldName}.moodConfidence`,
    ),
    activityLevel: parseActivityLevel(
      value.activityLevel,
      `${fieldName}.activityLevel`,
    ),
  };
}

function parseOptionalIntegrationContext(
  value: unknown,
  fieldName: string,
): IntegrationDailyContext | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid ${fieldName}: expected object`);
  }

  const parsed: IntegrationDailyContext = {
    schemaVersion: parseOptionalFiniteNumber(
      value.schemaVersion,
      `${fieldName}.schemaVersion`,
    ),
    location: parseOptionalIntegrationLocation(
      value.location,
      `${fieldName}.location`,
    ),
    fitness: parseOptionalIntegrationFitness(
      value.fitness,
      `${fieldName}.fitness`,
    ),
    calendar: parseOptionalIntegrationCalendar(
      value.calendar,
      `${fieldName}.calendar`,
    ),
    activitySummary: parseOptionalIntegrationActivitySummary(
      value.activitySummary,
      `${fieldName}.activitySummary`,
    ),
  };

  const hasValues = Object.values(parsed).some((item) => item !== undefined);
  return hasValues ? parsed : undefined;
}

function parseSummaryRows(value: unknown): ExportSummaryRow[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid summaries: expected array");
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Invalid summaries[${index}]: expected object`);
    }

    const dayKey = assertNonEmptyString(
      item.dayKey,
      `summaries[${index}].dayKey`,
    );
    validateDayKey(dayKey);

    return {
      dayKey,
      story: assertNonEmptyString(item.story, `summaries[${index}].story`),
      highlights: parseStringArray(
        item.highlights,
        `summaries[${index}].highlights`,
      ),
      metrics: parseOptionalMetrics(
        item.metrics,
        `summaries[${index}].metrics`,
      ),
      sourcesUsed: parseStringArray(
        item.sourcesUsed,
        `summaries[${index}].sourcesUsed`,
      ),
      generatedAt: parseFiniteNumber(
        item.generatedAt,
        `summaries[${index}].generatedAt`,
      ),
    };
  });
}

function parseMemoryRows(value: unknown): ExportMemoryRow[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid memories: expected array");
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Invalid memories[${index}]: expected object`);
    }

    const dayKey = assertNonEmptyString(
      item.dayKey,
      `memories[${index}].dayKey`,
    );
    validateDayKey(dayKey);

    return {
      clientRequestId: parseOptionalString(
        item.clientRequestId,
        `memories[${index}].clientRequestId`,
      ),
      dayKey,
      title: assertNonEmptyString(item.title, `memories[${index}].title`),
      description: parseOptionalString(
        item.description,
        `memories[${index}].description`,
      ),
      mood: parseOptionalString(item.mood, `memories[${index}].mood`),
      happenedAt: parseFiniteNumber(
        item.happenedAt,
        `memories[${index}].happenedAt`,
      ),
    };
  });
}

function parseDayRows(value: unknown): ExportDayRow[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid days: expected array");
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Invalid days[${index}]: expected object`);
    }

    const dayKey = assertNonEmptyString(item.dayKey, `days[${index}].dayKey`);
    validateDayKey(dayKey);

    return {
      dayKey,
      rating: parseOptionalFiniteNumber(item.rating, `days[${index}].rating`),
      manualNotes: parseStringArray(
        item.manualNotes,
        `days[${index}].manualNotes`,
      ),
      peopleTags: parseStringArray(
        item.peopleTags,
        `days[${index}].peopleTags`,
      ),
    };
  });
}

function parseIntegrationRows(value: unknown): ExportIntegrationRow[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid integrationDailyData: expected array");
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(
        `Invalid integrationDailyData[${index}]: expected object`,
      );
    }

    const dayKey = assertNonEmptyString(
      item.dayKey,
      `integrationDailyData[${index}].dayKey`,
    );
    validateDayKey(dayKey);

    const rawSignals = item.signals;
    const parsedSignals =
      rawSignals === undefined
        ? undefined
        : parseStringArray(
            rawSignals,
            `integrationDailyData[${index}].signals`,
          );

    return {
      provider: assertNonEmptyString(
        item.provider,
        `integrationDailyData[${index}].provider`,
      ),
      dayKey,
      syncedAt: parseFiniteNumber(
        item.syncedAt,
        `integrationDailyData[${index}].syncedAt`,
      ),
      summary: parseOptionalString(
        item.summary,
        `integrationDailyData[${index}].summary`,
      ),
      metrics: parseOptionalMetrics(
        item.metrics,
        `integrationDailyData[${index}].metrics`,
      ),
      signals: parsedSignals,
      context: parseOptionalIntegrationContext(
        item.context,
        `integrationDailyData[${index}].context`,
      ),
    };
  });
}

function parseExportCounts(value: unknown): ExportCounts {
  if (!isRecord(value)) {
    throw new Error("Invalid counts: expected object");
  }

  return {
    summaries: parseFiniteNumber(value.summaries, "counts.summaries"),
    memories: parseFiniteNumber(value.memories, "counts.memories"),
    days: parseFiniteNumber(value.days, "counts.days"),
    integrationDailyData: parseFiniteNumber(
      value.integrationDailyData,
      "counts.integrationDailyData",
    ),
  };
}

function sortObjectForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectForStableJson(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const sortedEntries = Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => [key, sortObjectForStableJson(nested)] as const);

  return Object.fromEntries(sortedEntries);
}

function normalizeSignedExportPayloadForSigning(
  payload: SignedDiaryExportPayload,
): string {
  return JSON.stringify(sortObjectForStableJson(payload));
}

function isProductionEnvironment(): boolean {
  const envCandidates = [
    process.env.DAYLOG_APP_ENV,
    process.env.APP_ENV,
    process.env.DEPLOY_ENV,
    process.env.VERCEL_ENV,
    process.env.NODE_ENV,
  ];

  return envCandidates.some((value) => {
    const normalized = value?.trim().toLowerCase();
    return normalized === "production" || normalized === "prod";
  });
}

function ensureExportSigningSecretConfiguredInProduction(): void {
  if (!isProductionEnvironment()) {
    return;
  }

  if (process.env.EXPORT_SIGNING_SECRET?.trim()) {
    return;
  }

  throw new Error(
    "Missing export signing secret in production. Configure EXPORT_SIGNING_SECRET.",
  );
}

function getExportSigningSecret(): string {
  const exportSigningSecret = process.env.EXPORT_SIGNING_SECRET?.trim();
  if (exportSigningSecret) {
    return exportSigningSecret;
  }

  throw new Error(
    "Missing export signing secret. Configure EXPORT_SIGNING_SECRET.",
  );
}

ensureExportSigningSecretConfiguredInProduction();

async function computeSignedPayloadSignature(
  payload: SignedDiaryExportPayload,
): Promise<string> {
  const signerKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getExportSigningSecret()),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const encodedPayload = new TextEncoder().encode(
    normalizeSignedExportPayloadForSigning(payload),
  );
  const signature = await crypto.subtle.sign("HMAC", signerKey, encodedPayload);

  return toHex(new Uint8Array(signature));
}

function signaturesEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function ensurePayloadSizeLimit(payloadText: string): void {
  const sizeBytes = new TextEncoder().encode(payloadText).length;
  if (sizeBytes > RESTORE_MAX_PAYLOAD_BYTES) {
    throw new Error(
      `Backup file is too large (${sizeBytes} bytes). Maximum supported size is ${RESTORE_MAX_PAYLOAD_BYTES} bytes.`,
    );
  }
}

async function parseAndVerifyRestorePayload(
  payloadText: string,
): Promise<SignedDiaryExportPayloadWithIntegrity> {
  ensurePayloadSizeLimit(payloadText);

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(payloadText) as unknown;
  } catch {
    throw new Error("Restore file is not valid JSON.");
  }

  if (!isRecord(parsedRaw)) {
    throw new Error("Restore file has invalid shape.");
  }

  if (parsedRaw.schemaVersion !== RESTORE_SCHEMA_VERSION) {
    throw new Error(
      "Unsupported backup format. Please create a new export using the latest version.",
    );
  }

  const exportedAt = assertNonEmptyString(parsedRaw.exportedAt, "exportedAt");
  if (!Number.isFinite(Date.parse(exportedAt))) {
    throw new Error("Invalid exportedAt timestamp in restore file.");
  }

  if (!isRecord(parsedRaw.owner)) {
    throw new Error("Restore file is missing owner metadata.");
  }

  const owner = {
    clerkUserId: assertNonEmptyString(
      parsedRaw.owner.clerkUserId,
      "owner.clerkUserId",
    ),
  };

  if (!isRecord(parsedRaw.integrity)) {
    throw new Error("Restore file is missing integrity metadata.");
  }

  const integrityAlgorithm = assertNonEmptyString(
    parsedRaw.integrity.algorithm,
    "integrity.algorithm",
  );
  const integritySignature = assertNonEmptyString(
    parsedRaw.integrity.signature,
    "integrity.signature",
  );

  if (integrityAlgorithm !== RESTORE_SIGNING_ALGORITHM) {
    throw new Error("Unsupported backup signature algorithm.");
  }

  const summaries = parseSummaryRows(parsedRaw.summaries);
  const memories = parseMemoryRows(parsedRaw.memories);
  const days = parseDayRows(parsedRaw.days);
  const integrationDailyData = parseIntegrationRows(
    parsedRaw.integrationDailyData,
  );

  const parsedCounts = parseExportCounts(parsedRaw.counts);
  if (parsedCounts.summaries !== summaries.length) {
    throw new Error("Restore file count mismatch for summaries.");
  }
  if (parsedCounts.memories !== memories.length) {
    throw new Error("Restore file count mismatch for memories.");
  }
  if (parsedCounts.days !== days.length) {
    throw new Error("Restore file count mismatch for days.");
  }
  if (parsedCounts.integrationDailyData !== integrationDailyData.length) {
    throw new Error("Restore file count mismatch for integration daily data.");
  }

  const signedPayload: SignedDiaryExportPayload = {
    schemaVersion: RESTORE_SCHEMA_VERSION,
    exportedAt,
    owner,
    counts: parsedCounts,
    summaries,
    memories,
    days,
    integrationDailyData,
  };

  const expectedSignature = await computeSignedPayloadSignature(signedPayload);
  if (!signaturesEqual(expectedSignature, integritySignature)) {
    throw new Error(
      "Restore file integrity check failed. The backup may be tampered.",
    );
  }

  return {
    ...signedPayload,
    integrity: {
      algorithm: RESTORE_SIGNING_ALGORITHM,
      signature: integritySignature,
    },
  };
}

function buildSignedExportPayload(input: {
  exportedAt: number;
  clerkUserId: string;
  summaries: ExportSummaryRow[];
  memories: ExportMemoryRow[];
  days: ExportDayRow[];
  integrationDailyData: ExportIntegrationRow[];
}): SignedDiaryExportPayload {
  return {
    schemaVersion: RESTORE_SCHEMA_VERSION,
    exportedAt: new Date(input.exportedAt).toISOString(),
    owner: {
      clerkUserId: input.clerkUserId,
    },
    counts: {
      summaries: input.summaries.length,
      memories: input.memories.length,
      days: input.days.length,
      integrationDailyData: input.integrationDailyData.length,
    },
    summaries: input.summaries,
    memories: input.memories,
    days: input.days,
    integrationDailyData: input.integrationDailyData,
  };
}

function buildRestoreMemoryClientRequestId(row: ExportMemoryRow): string {
  const importedClientRequestId = row.clientRequestId?.trim();
  if (importedClientRequestId) {
    return importedClientRequestId;
  }

  const source = `${row.dayKey}|${row.happenedAt}|${row.title}|${row.description ?? ""}|${row.mood ?? ""}`;
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `restore:${(hash >>> 0).toString(16)}`;
}

function stringArrayEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function optionalStringEqual(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return (left ?? "") === (right ?? "");
}

function optionalNumberEqual(
  left: number | undefined,
  right: number | undefined,
): boolean {
  return left === right || (left === undefined && right === undefined);
}

function jsonEquivalent(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(sortObjectForStableJson(left)) ===
    JSON.stringify(sortObjectForStableJson(right))
  );
}

function metricsEqual(
  left: ExportMetrics | undefined,
  right: ExportMetrics | undefined,
): boolean {
  return (
    optionalNumberEqual(left?.steps, right?.steps) &&
    optionalNumberEqual(left?.sleepMinutes, right?.sleepMinutes) &&
    optionalNumberEqual(left?.screenTimeMinutes, right?.screenTimeMinutes) &&
    optionalNumberEqual(left?.spendingTotal, right?.spendingTotal)
  );
}

async function memoryRowEquivalent(
  row: ExportMemoryRow,
  existing: Doc<"memories">,
): Promise<boolean> {
  const existingSensitive = await readMemorySensitiveFields(existing);

  return (
    existing.dayKey === row.dayKey &&
    existing.happenedAt === row.happenedAt &&
    existingSensitive.title === row.title &&
    optionalStringEqual(existingSensitive.description, row.description) &&
    optionalStringEqual(existingSensitive.mood, row.mood)
  );
}

async function summaryRowEquivalent(
  row: ExportSummaryRow,
  existing: Doc<"daySummaries">,
): Promise<boolean> {
  const existingSensitive = await readSummarySensitiveFields(existing);

  return (
    existing.dayKey === row.dayKey &&
    existingSensitive.story === row.story &&
    stringArrayEqual(existingSensitive.highlights ?? [], row.highlights) &&
    stringArrayEqual(existing.sourcesUsed ?? [], row.sourcesUsed) &&
    existing.generatedAt === row.generatedAt &&
    metricsEqual(existing.metrics, row.metrics)
  );
}

async function dayRowEquivalent(
  row: ExportDayRow,
  existing: Doc<"days">,
): Promise<boolean> {
  const existingSensitive = await readDaySensitiveFields(existing);

  return (
    existing.dayKey === row.dayKey &&
    optionalNumberEqual(existing.rating, row.rating) &&
    stringArrayEqual(existingSensitive.manualNotes ?? [], row.manualNotes) &&
    stringArrayEqual(existingSensitive.peopleTags ?? [], row.peopleTags)
  );
}

async function integrationRowEquivalent(
  row: ExportIntegrationRow,
  existing: Doc<"integrationDailyData">,
): Promise<boolean> {
  const existingSensitive = await readIntegrationDailySensitiveFields(existing);

  return (
    existing.provider === row.provider &&
    existing.dayKey === row.dayKey &&
    existing.syncedAt === row.syncedAt &&
    optionalStringEqual(existingSensitive.summary, row.summary) &&
    metricsEqual(existing.metrics, row.metrics) &&
    stringArrayEqual(existingSensitive.signals ?? [], row.signals ?? []) &&
    jsonEquivalent(existingSensitive.context, row.context)
  );
}

function splitIntoBatches<TItem>(items: TItem[], batchSize: number): TItem[][] {
  if (items.length === 0) {
    return [];
  }

  const batches: TItem[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }

  return batches;
}

function selectedRestoreDatasets(input?: ExportDataset[]): ExportDataset[] {
  const defaults: ExportDataset[] = [
    "summaries",
    "memories",
    "days",
    "integrationDailyData",
  ];

  if (!input || input.length === 0) {
    return defaults;
  }

  const unique = new Set<ExportDataset>();
  for (const dataset of input) {
    unique.add(dataset);
  }

  return defaults.filter((dataset) => unique.has(dataset));
}

function sanitizeExportErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 220);
  }

  return "Export generation failed.";
}

function sanitizeRestoreErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 220);
  }

  return "Restore failed for one or more rows.";
}

type IdNormalizer = {
  normalizeId<TTableName extends TableNames>(
    tableName: TTableName,
    id: string,
  ): Id<TTableName> | null;
};

function requireNormalizedId<TTableName extends TableNames>(
  db: IdNormalizer,
  tableName: TTableName,
  rawId: string,
  errorMessage: string,
): Id<TTableName> {
  const normalized = db.normalizeId(tableName, rawId);
  if (!normalized) {
    throw new Error(errorMessage);
  }

  return normalized;
}

function requireSingleParsedRow<TItem>(
  rows: TItem[],
  errorMessage: string,
): TItem {
  const row = rows[0];
  if (!row) {
    throw new Error(errorMessage);
  }

  return row;
}

function parseSummaryRestoreRow(rawRow: unknown): ExportSummaryRow {
  return requireSingleParsedRow(
    parseSummaryRows([rawRow]),
    "Invalid summary restore row payload.",
  );
}

function parseMemoryRestoreRow(rawRow: unknown): ExportMemoryRow {
  return requireSingleParsedRow(
    parseMemoryRows([rawRow]),
    "Invalid memory restore row payload.",
  );
}

function parseDayRestoreRow(rawRow: unknown): ExportDayRow {
  return requireSingleParsedRow(
    parseDayRows([rawRow]),
    "Invalid day restore row payload.",
  );
}

function parseIntegrationRestoreRow(rawRow: unknown): ExportIntegrationRow {
  return requireSingleParsedRow(
    parseIntegrationRows([rawRow]),
    "Invalid integration restore row payload.",
  );
}

type RestoreRowOutcome = "inserted" | "updated" | "skipped" | "conflict";

function applyRestoreOutcome(
  result: RestoreBatchResult,
  outcome: RestoreRowOutcome,
): void {
  if (outcome === "inserted") {
    result.inserted += 1;
    return;
  }

  if (outcome === "updated") {
    result.updated += 1;
    return;
  }

  if (outcome === "skipped") {
    result.skipped += 1;
    return;
  }

  result.conflicts += 1;
  result.skipped += 1;
}

async function restoreSummaryDatasetRow(
  db: MutationCtx["db"],
  args: {
    userId: Id<"user">;
    row: ExportSummaryRow;
    conflictMode: RestoreConflictMode;
  },
): Promise<RestoreRowOutcome> {
  const existing = await db
    .query("daySummaries")
    .withIndex("by_user_day", (q) =>
      q.eq("userId", args.userId).eq("dayKey", args.row.dayKey),
    )
    .unique();

  const encryptedPayload = await buildSummarySensitiveWritePayload({
    userId: args.userId,
    story: args.row.story,
    highlights: args.row.highlights,
    sensitiveDataNonce: existing?.sensitiveDataNonce,
  });

  if (!existing) {
    await db.insert("daySummaries", {
      userId: args.userId,
      dayKey: args.row.dayKey,
      ...encryptedPayload,
      metrics: args.row.metrics,
      sourcesUsed: args.row.sourcesUsed,
      generatedAt: args.row.generatedAt,
    });
    return "inserted";
  }

  if (await summaryRowEquivalent(args.row, existing)) {
    return "skipped";
  }

  if (args.conflictMode === "overwrite") {
    await db.patch(existing._id, {
      ...encryptedPayload,
      metrics: args.row.metrics,
      sourcesUsed: args.row.sourcesUsed,
      generatedAt: args.row.generatedAt,
    });
    return "updated";
  }

  return "conflict";
}

async function restoreDayDatasetRow(
  db: MutationCtx["db"],
  args: {
    userId: Id<"user">;
    row: ExportDayRow;
    conflictMode: RestoreConflictMode;
  },
): Promise<RestoreRowOutcome> {
  const existing = await db
    .query("days")
    .withIndex("by_user_day", (q) =>
      q.eq("userId", args.userId).eq("dayKey", args.row.dayKey),
    )
    .unique();

  const encryptedPayload = await buildDaySensitiveWritePayload({
    userId: args.userId,
    manualNotes: args.row.manualNotes,
    peopleTags: args.row.peopleTags,
    sensitiveDataNonce: existing?.sensitiveDataNonce,
  });

  if (!existing) {
    await db.insert("days", {
      userId: args.userId,
      dayKey: args.row.dayKey,
      rating: args.row.rating,
      ...encryptedPayload,
    });
    return "inserted";
  }

  if (await dayRowEquivalent(args.row, existing)) {
    return "skipped";
  }

  if (args.conflictMode === "overwrite") {
    await db.patch(existing._id, {
      rating: args.row.rating,
      ...encryptedPayload,
    });
    return "updated";
  }

  return "conflict";
}

async function restoreIntegrationDatasetRow(
  db: MutationCtx["db"],
  args: {
    userId: Id<"user">;
    row: ExportIntegrationRow;
    conflictMode: RestoreConflictMode;
  },
): Promise<RestoreRowOutcome> {
  const existing = await db
    .query("integrationDailyData")
    .withIndex("by_user_provider_day", (q) =>
      q
        .eq("userId", args.userId)
        .eq("provider", args.row.provider)
        .eq("dayKey", args.row.dayKey),
    )
    .unique();

  const encryptedPayload = await buildIntegrationDailySensitiveWritePayload({
    userId: args.userId,
    summary: args.row.summary,
    signals: args.row.signals,
    context: args.row.context,
    sensitiveDataNonce: existing?.sensitiveDataNonce,
  });

  if (!existing) {
    await db.insert("integrationDailyData", {
      userId: args.userId,
      provider: args.row.provider,
      dayKey: args.row.dayKey,
      syncedAt: args.row.syncedAt,
      ...encryptedPayload,
      metrics: args.row.metrics,
    });
    return "inserted";
  }

  if (await integrationRowEquivalent(args.row, existing)) {
    return "skipped";
  }

  if (args.conflictMode === "overwrite") {
    await db.patch(existing._id, {
      syncedAt: args.row.syncedAt,
      ...encryptedPayload,
      metrics: args.row.metrics,
    });
    return "updated";
  }

  return "conflict";
}

async function restoreMemoryDatasetRow(
  db: MutationCtx["db"],
  args: {
    userId: Id<"user">;
    row: ExportMemoryRow;
    conflictMode: RestoreConflictMode;
  },
): Promise<RestoreRowOutcome> {
  const restoreClientRequestId = buildRestoreMemoryClientRequestId(args.row);

  const existingByRestoreRequestId = await db
    .query("memories")
    .withIndex("by_user_clientRequestId", (q) =>
      q.eq("userId", args.userId).eq("clientRequestId", restoreClientRequestId),
    )
    .unique();

  if (existingByRestoreRequestId) {
    if (await memoryRowEquivalent(args.row, existingByRestoreRequestId)) {
      return "skipped";
    }

    if (args.conflictMode === "overwrite") {
      const encryptedPayload = await buildMemorySensitiveWritePayload({
        userId: args.userId,
        title: args.row.title,
        description: args.row.description,
        mood: args.row.mood,
        sensitiveDataNonce: existingByRestoreRequestId.sensitiveDataNonce,
      });

      await db.patch(existingByRestoreRequestId._id, {
        clientRequestId: restoreClientRequestId,
        dayKey: args.row.dayKey,
        ...encryptedPayload,
        happenedAt: args.row.happenedAt,
      });
      return "updated";
    }

    return "conflict";
  }

  const rowsByTimestamp = await db
    .query("memories")
    .withIndex("by_user_happenedAt", (q) =>
      q.eq("userId", args.userId).eq("happenedAt", args.row.happenedAt),
    )
    .collect();

  let exactDuplicate: Doc<"memories"> | undefined;
  let potentialConflict: Doc<"memories"> | undefined;

  for (const existing of rowsByTimestamp) {
    const existingSensitive = await readMemorySensitiveFields(existing);

    const equivalent =
      existing.dayKey === args.row.dayKey &&
      existing.happenedAt === args.row.happenedAt &&
      existingSensitive.title === args.row.title &&
      optionalStringEqual(
        existingSensitive.description,
        args.row.description,
      ) &&
      optionalStringEqual(existingSensitive.mood, args.row.mood);

    if (equivalent) {
      exactDuplicate = existing;
      break;
    }

    if (
      !potentialConflict &&
      existing.dayKey === args.row.dayKey &&
      existingSensitive.title === args.row.title
    ) {
      potentialConflict = existing;
    }
  }

  if (exactDuplicate) {
    return "skipped";
  }

  if (potentialConflict) {
    if (args.conflictMode === "overwrite") {
      const encryptedPayload = await buildMemorySensitiveWritePayload({
        userId: args.userId,
        title: args.row.title,
        description: args.row.description,
        mood: args.row.mood,
        sensitiveDataNonce: potentialConflict.sensitiveDataNonce,
      });

      await db.patch(potentialConflict._id, {
        clientRequestId: restoreClientRequestId,
        dayKey: args.row.dayKey,
        ...encryptedPayload,
        happenedAt: args.row.happenedAt,
      });
      return "updated";
    }

    return "conflict";
  }

  const encryptedPayload = await buildMemorySensitiveWritePayload({
    userId: args.userId,
    title: args.row.title,
    description: args.row.description,
    mood: args.row.mood,
  });

  await db.insert("memories", {
    userId: args.userId,
    clientRequestId: restoreClientRequestId,
    dayKey: args.row.dayKey,
    ...encryptedPayload,
    happenedAt: args.row.happenedAt,
  });

  return "inserted";
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
const restoreDiaryDatasetBatchInternalRef = makeFunctionReference<"mutation">(
  "summaries:restoreDiaryDatasetBatchInternal",
);
const createRestoreJobInternalRef = makeFunctionReference<"mutation">(
  "summaries:createRestoreJobInternal",
);
const markRestoreJobCompletedInternalRef = makeFunctionReference<"mutation">(
  "summaries:markRestoreJobCompletedInternal",
);
const markRestoreJobFailedInternalRef = makeFunctionReference<"mutation">(
  "summaries:markRestoreJobFailedInternal",
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
    if (memory.clientRequestId) {
      parts.push(`  Request ID: ${memory.clientRequestId}`);
    }
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
  const identity = (await ctx.runQuery(
    getSummaryGenerationIdentityRef,
    {},
  )) as {
    userId: Id<"user">;
    clerkUserId: string;
  };

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

  let payloadText = toTextExport(exportData);
  if (args.format === "json") {
    const signedPayload = buildSignedExportPayload({
      exportedAt: exportData.exportedAt,
      clerkUserId: identity.clerkUserId,
      summaries,
      memories,
      days,
      integrationDailyData,
    });
    const signature = await computeSignedPayloadSignature(signedPayload);

    payloadText = JSON.stringify(
      {
        ...signedPayload,
        integrity: {
          algorithm: RESTORE_SIGNING_ALGORITHM,
          signature,
        },
      } satisfies SignedDiaryExportPayloadWithIntegrity,
      null,
      2,
    );
  }

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

      const mappedPage = await Promise.all(
        page.page.map(async (summary) => {
          const sensitive = await readSummarySensitiveFields(summary);

          return {
            dayKey: summary.dayKey,
            story: sensitive.story,
            highlights: sensitive.highlights,
            metrics: summary.metrics,
            sourcesUsed: summary.sourcesUsed,
            generatedAt: summary.generatedAt,
          };
        }),
      );

      return {
        exportedAt: Date.now(),
        dataset: args.dataset,
        page: mappedPage,
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

      const mappedPage = await Promise.all(
        page.page.map(async (memory) => {
          const sensitive = await readMemorySensitiveFields(memory);

          return {
            clientRequestId: memory.clientRequestId,
            dayKey: memory.dayKey,
            title: sensitive.title,
            description: sensitive.description,
            mood: sensitive.mood,
            happenedAt: memory.happenedAt,
          };
        }),
      );

      return {
        exportedAt: Date.now(),
        dataset: args.dataset,
        page: mappedPage,
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

      const mappedPage = await Promise.all(
        page.page.map(async (day) => {
          const sensitive = await readDaySensitiveFields(day);

          return {
            dayKey: day.dayKey,
            rating: day.rating,
            manualNotes: sensitive.manualNotes,
            peopleTags: sensitive.peopleTags,
          };
        }),
      );

      return {
        exportedAt: Date.now(),
        dataset: args.dataset,
        page: mappedPage,
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

    const filteredIntegrationRows = integrationPage.page.filter(
      (item) => includeLocationSignals || item.provider !== "location",
    );

    const mappedIntegrationPage = await Promise.all(
      filteredIntegrationRows.map(async (item) => {
        const sensitive = await readIntegrationDailySensitiveFields(item);

        return {
          provider: item.provider,
          dayKey: item.dayKey,
          syncedAt: item.syncedAt,
          summary: sensitive.summary,
          metrics: item.metrics,
          signals: sensitive.signals ?? [],
          context: sensitive.context,
        };
      }),
    );

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
    const jobId = await ctx.db.insert("exportJobs", {
      userId: args.userId,
      status: "queued" satisfies ExportJobStatus,
      format: args.format,
      includeLocationSignals: args.includeLocationSignals,
      requestedAt: args.requestedAt,
      updatedAt: args.requestedAt,
      expiresAt: args.expiresAt,
    });

    return {
      jobId,
      status: "queued" as ExportJobStatus,
      requestedAt: args.requestedAt,
      expiresAt: args.expiresAt,
    };
  },
});

export const markExportJobRunningInternal = internalMutation({
  args: {
    jobId: v.id("exportJobs"),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Export job not found");
    }

    await ctx.db.patch(job._id, {
      status: "running",
      startedAt: args.startedAt,
      updatedAt: args.startedAt,
    });

    return {
      jobId: job._id,
      status: "running" as ExportJobStatus,
      startedAt: args.startedAt,
    };
  },
});

export const markExportJobReadyInternal = internalMutation({
  args: {
    jobId: v.id("exportJobs"),
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
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Export job not found");
    }

    await ctx.db.patch(job._id, {
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
      jobId: job._id,
      status: "ready" as ExportJobStatus,
      completedAt: args.completedAt,
    };
  },
});

export const markExportJobFailedInternal = internalMutation({
  args: {
    jobId: v.id("exportJobs"),
    failedAt: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Export job not found");
    }

    await ctx.db.patch(job._id, {
      status: "failed",
      failedAt: args.failedAt,
      updatedAt: args.failedAt,
      error: args.error,
    });

    return {
      jobId: job._id,
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
    const page = await ctx.db
      .query("exportJobs")
      .withIndex("by_user_requestedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate(args.paginationOpts);

    const mappedPage = await Promise.all(
      page.page.map(async (job) => {
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
    const jobId = requireNormalizedId(
      ctx.db,
      "exportJobs",
      args.jobId,
      "Export job not found",
    );
    const job = await ctx.db.get(jobId);

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

export const createRestoreJobInternal = internalMutation({
  args: {
    userId: v.id("user"),
    requestedAt: v.number(),
    conflictMode: restoreConflictModeValidator,
    allowPartial: v.boolean(),
    selectedDatasets: v.array(exportDatasetValidator),
  },
  handler: async (ctx, args) => {
    const jobId = await ctx.db.insert("restoreJobs", {
      userId: args.userId,
      status: "running" satisfies RestoreJobStatus,
      requestedAt: args.requestedAt,
      updatedAt: args.requestedAt,
      conflictMode: args.conflictMode,
      allowPartial: args.allowPartial,
      selectedDatasets: args.selectedDatasets,
    });

    return {
      jobId,
      status: "running" as RestoreJobStatus,
      requestedAt: args.requestedAt,
    };
  },
});

export const markRestoreJobCompletedInternal = internalMutation({
  args: {
    jobId: v.id("restoreJobs"),
    status: v.union(v.literal("succeeded"), v.literal("partial")),
    completedAt: v.number(),
    exportedAt: v.string(),
    sourceCounts: exportCountsObjectValidator,
    totals: restoreBatchResultObjectValidator,
    datasetResults: restoreDatasetResultsValidator,
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new Error("Restore job not found");
    }

    await ctx.db.patch(job._id, {
      status: args.status,
      completedAt: args.completedAt,
      updatedAt: args.completedAt,
      exportedAt: args.exportedAt,
      sourceCounts: args.sourceCounts,
      totals: args.totals,
      datasetResults: args.datasetResults,
    });

    return {
      jobId: job._id,
      status: args.status,
      completedAt: args.completedAt,
    };
  },
});

export const markRestoreJobFailedInternal = internalMutation({
  args: {
    jobId: v.id("restoreJobs"),
    failedAt: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new Error("Restore job not found");
    }

    await ctx.db.patch(job._id, {
      status: "failed",
      failedAt: args.failedAt,
      updatedAt: args.failedAt,
      error: args.error,
    });

    return {
      jobId: job._id,
      status: "failed" as RestoreJobStatus,
      failedAt: args.failedAt,
    };
  },
});

export const listMyRestoreJobsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const page = await ctx.db
      .query("restoreJobs")
      .withIndex("by_user_requestedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate(args.paginationOpts);

    const mappedPage = page.page.map((job) => ({
      jobId: String(job._id),
      status: job.status,
      requestedAt: job.requestedAt,
      completedAt: job.completedAt,
      failedAt: job.failedAt,
      updatedAt: job.updatedAt,
      conflictMode: job.conflictMode,
      allowPartial: Boolean(job.allowPartial),
      selectedDatasets: Array.isArray(job.selectedDatasets)
        ? job.selectedDatasets
        : [],
      exportedAt: typeof job.exportedAt === "string" ? job.exportedAt : null,
      sourceCounts: job.sourceCounts ?? null,
      totals: job.totals ?? null,
      datasetResults: job.datasetResults ?? null,
      error: typeof job.error === "string" ? job.error : null,
    }));

    return {
      ...page,
      page: mappedPage,
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

    const staleJobs = await ctx.db
      .query("exportJobs")
      .withIndex("by_requestedAt", (q) => q.lt("requestedAt", cutoff))
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

      await ctx.db.delete(job._id);
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

export const runScheduledRestoreJobRetentionCleanupInternal = internalMutation({
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
    const retentionDays = getRestoreJobRetentionDays();
    const cutoff = now - retentionDays * MS_PER_DAY;

    const staleJobs = await ctx.db
      .query("restoreJobs")
      .withIndex("by_requestedAt", (q) => q.lt("requestedAt", cutoff))
      .order("asc")
      .take(maxDeletes);

    let deletedJobs = 0;

    for (const job of staleJobs) {
      await ctx.db.delete(job._id);
      deletedJobs += 1;
    }

    return {
      retentionDays,
      cutoff,
      deletedJobs,
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

export const restoreDiaryDatasetBatchInternal = internalMutation({
  args: {
    userId: v.id("user"),
    dataset: exportDatasetValidator,
    rows: v.array(restoreRowObjectValidator),
    conflictMode: restoreConflictModeValidator,
    allowPartial: v.boolean(),
  },
  handler: async (ctx, args: RestoreBatchDatasetArgs) => {
    const result = createEmptyRestoreBatchResult();

    for (const rawRow of args.rows) {
      result.processed += 1;

      try {
        let outcome: RestoreRowOutcome;

        if (args.dataset === "summaries") {
          outcome = await restoreSummaryDatasetRow(ctx.db, {
            userId: args.userId,
            row: parseSummaryRestoreRow(rawRow),
            conflictMode: args.conflictMode,
          });
        } else if (args.dataset === "days") {
          outcome = await restoreDayDatasetRow(ctx.db, {
            userId: args.userId,
            row: parseDayRestoreRow(rawRow),
            conflictMode: args.conflictMode,
          });
        } else if (args.dataset === "integrationDailyData") {
          outcome = await restoreIntegrationDatasetRow(ctx.db, {
            userId: args.userId,
            row: parseIntegrationRestoreRow(rawRow),
            conflictMode: args.conflictMode,
          });
        } else {
          outcome = await restoreMemoryDatasetRow(ctx.db, {
            userId: args.userId,
            row: parseMemoryRestoreRow(rawRow),
            conflictMode: args.conflictMode,
          });
        }

        applyRestoreOutcome(result, outcome);
      } catch (error) {
        if (!args.allowPartial) {
          throw error;
        }

        result.failed += 1;
        if (result.errorSamples.length < 10) {
          result.errorSamples.push(sanitizeRestoreErrorMessage(error));
        }
      }
    }

    return result;
  },
});

export const validateMyDiaryRestorePayload = action({
  args: {
    payloadText: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = (await ctx.runQuery(
      getSummaryGenerationIdentityRef,
      {},
    )) as {
      userId: Id<"user">;
      clerkUserId: string;
    };

    const payload = await parseAndVerifyRestorePayload(args.payloadText);
    if (payload.owner.clerkUserId !== identity.clerkUserId) {
      throw new Error(
        "Backup ownership mismatch. You can only restore backups exported by your account.",
      );
    }

    return {
      valid: true,
      schemaVersion: payload.schemaVersion,
      exportedAt: payload.exportedAt,
      ownerClerkUserId: payload.owner.clerkUserId,
      counts: payload.counts,
    };
  },
});

export const restoreMyDiaryData = action({
  args: {
    payloadText: v.string(),
    datasets: v.optional(v.array(exportDatasetValidator)),
    conflictMode: v.optional(restoreConflictModeValidator),
    allowPartial: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = (await ctx.runQuery(
      getSummaryGenerationIdentityRef,
      {},
    )) as {
      userId: Id<"user">;
      clerkUserId: string;
    };

    const datasets = selectedRestoreDatasets(args.datasets);
    if (datasets.length === 0) {
      throw new Error("Select at least one dataset to restore.");
    }

    const conflictMode = args.conflictMode ?? "skip";
    const allowPartial = args.allowPartial ?? true;
    const requestedAt = Date.now();

    const createdJob = (await ctx.runMutation(createRestoreJobInternalRef, {
      userId: identity.userId,
      requestedAt,
      conflictMode,
      allowPartial,
      selectedDatasets: datasets,
    })) as {
      jobId: string;
      status: RestoreJobStatus;
      requestedAt: number;
    };

    try {
      const payload = await parseAndVerifyRestorePayload(args.payloadText);
      if (payload.owner.clerkUserId !== identity.clerkUserId) {
        throw new Error(
          "Backup ownership mismatch. You can only restore backups exported by your account.",
        );
      }

      const datasetResults: Record<ExportDataset, RestoreBatchResult> = {
        summaries: createEmptyRestoreBatchResult(),
        memories: createEmptyRestoreBatchResult(),
        days: createEmptyRestoreBatchResult(),
        integrationDailyData: createEmptyRestoreBatchResult(),
      };

      for (const dataset of datasets) {
        const rows = payload[dataset] as unknown[];
        const batches = splitIntoBatches(rows, RESTORE_BATCH_SIZE);

        for (const batchRows of batches) {
          const batchResult = (await ctx.runMutation(
            restoreDiaryDatasetBatchInternalRef,
            {
              userId: identity.userId,
              dataset,
              rows: batchRows,
              conflictMode,
              allowPartial,
            },
          )) as RestoreBatchResult;

          mergeRestoreBatchResults(datasetResults[dataset], batchResult);
        }
      }

      const totals = createEmptyRestoreBatchResult();
      for (const dataset of [
        "summaries",
        "memories",
        "days",
        "integrationDailyData",
      ] as const) {
        mergeRestoreBatchResults(totals, datasetResults[dataset]);
      }

      const completedAt = Date.now();
      const restoreJobStatus: RestoreJobStatus =
        totals.failed > 0 ? "partial" : "succeeded";

      await ctx.runMutation(markRestoreJobCompletedInternalRef, {
        jobId: createdJob.jobId,
        status: restoreJobStatus,
        completedAt,
        exportedAt: payload.exportedAt,
        sourceCounts: payload.counts,
        totals,
        datasetResults,
      });

      return {
        jobId: createdJob.jobId,
        status: totals.failed > 0 ? "partial" : "success",
        requestedAt: createdJob.requestedAt,
        restoredAt: completedAt,
        conflictMode,
        allowPartial,
        selectedDatasets: datasets,
        sourceCounts: payload.counts,
        totals,
        datasetResults,
      };
    } catch (error) {
      try {
        await ctx.runMutation(markRestoreJobFailedInternalRef, {
          jobId: createdJob.jobId,
          failedAt: Date.now(),
          error: sanitizeRestoreErrorMessage(error),
        });
      } catch {
        // Preserve original restore failure when status update fails.
      }

      throw error;
    }
  },
});
