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
  context?: unknown;
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
  rows: unknown[];
  conflictMode: RestoreConflictMode;
  allowPartial: boolean;
};

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

    const rawContext = item.context;
    if (
      rawContext !== undefined &&
      rawContext !== null &&
      !isRecord(rawContext)
    ) {
      throw new Error(`Invalid integrationDailyData[${index}].context`);
    }

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
      context: rawContext ?? undefined,
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

function getRestoreSigningSecret(): string {
  const explicitRestoreSecret =
    process.env.EXPORT_RESTORE_SIGNING_SECRET?.trim();
  if (explicitRestoreSecret) {
    return explicitRestoreSecret;
  }

  const clerkWebhookSecret = process.env.CLERK_WEBHOOK_SECRET?.trim();
  if (clerkWebhookSecret) {
    return clerkWebhookSecret;
  }

  throw new Error(
    "Missing restore signing secret. Configure EXPORT_RESTORE_SIGNING_SECRET or CLERK_WEBHOOK_SECRET.",
  );
}

async function computeSignedPayloadSignature(
  payload: SignedDiaryExportPayload,
): Promise<string> {
  const signerKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getRestoreSigningSecret()),
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

function memoryRowEquivalent(row: ExportMemoryRow, existing: any): boolean {
  return (
    existing.dayKey === row.dayKey &&
    existing.happenedAt === row.happenedAt &&
    existing.title === row.title &&
    optionalStringEqual(existing.description, row.description) &&
    optionalStringEqual(existing.mood, row.mood)
  );
}

function summaryRowEquivalent(row: ExportSummaryRow, existing: any): boolean {
  return (
    existing.dayKey === row.dayKey &&
    existing.story === row.story &&
    stringArrayEqual(existing.highlights ?? [], row.highlights) &&
    stringArrayEqual(existing.sourcesUsed ?? [], row.sourcesUsed) &&
    existing.generatedAt === row.generatedAt &&
    metricsEqual(existing.metrics, row.metrics)
  );
}

function dayRowEquivalent(row: ExportDayRow, existing: any): boolean {
  return (
    existing.dayKey === row.dayKey &&
    optionalNumberEqual(existing.rating, row.rating) &&
    stringArrayEqual(existing.manualNotes ?? [], row.manualNotes) &&
    stringArrayEqual(existing.peopleTags ?? [], row.peopleTags)
  );
}

function integrationRowEquivalent(
  row: ExportIntegrationRow,
  existing: any,
): boolean {
  return (
    existing.provider === row.provider &&
    existing.dayKey === row.dayKey &&
    existing.syncedAt === row.syncedAt &&
    optionalStringEqual(existing.summary, row.summary) &&
    metricsEqual(existing.metrics, row.metrics) &&
    stringArrayEqual(existing.signals ?? [], row.signals ?? []) &&
    jsonEquivalent(existing.context, row.context)
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

export const createRestoreJobInternal = internalMutation({
  args: {
    userId: v.id("user"),
    requestedAt: v.number(),
    conflictMode: restoreConflictModeValidator,
    allowPartial: v.boolean(),
    selectedDatasets: v.array(exportDatasetValidator),
  },
  handler: async (ctx, args) => {
    const restoreJobsDb = ctx.db as any;
    const jobId = await restoreJobsDb.insert("restoreJobs", {
      userId: args.userId,
      status: "running" satisfies RestoreJobStatus,
      requestedAt: args.requestedAt,
      updatedAt: args.requestedAt,
      conflictMode: args.conflictMode,
      allowPartial: args.allowPartial,
      selectedDatasets: args.selectedDatasets,
    });

    return {
      jobId: String(jobId),
      status: "running" as RestoreJobStatus,
      requestedAt: args.requestedAt,
    };
  },
});

export const markRestoreJobCompletedInternal = internalMutation({
  args: {
    jobId: v.string(),
    status: v.union(v.literal("succeeded"), v.literal("partial")),
    completedAt: v.number(),
    exportedAt: v.string(),
    sourceCounts: exportCountsObjectValidator,
    totals: restoreBatchResultObjectValidator,
    datasetResults: restoreDatasetResultsValidator,
  },
  handler: async (ctx, args) => {
    const restoreJobsDb = ctx.db as any;
    const job = await restoreJobsDb.get(args.jobId);

    if (!job) {
      throw new Error("Restore job not found");
    }

    await restoreJobsDb.patch(job._id, {
      status: args.status,
      completedAt: args.completedAt,
      updatedAt: args.completedAt,
      exportedAt: args.exportedAt,
      sourceCounts: args.sourceCounts,
      totals: args.totals,
      datasetResults: args.datasetResults,
    });

    return {
      jobId: String(job._id),
      status: args.status,
      completedAt: args.completedAt,
    };
  },
});

export const markRestoreJobFailedInternal = internalMutation({
  args: {
    jobId: v.string(),
    failedAt: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const restoreJobsDb = ctx.db as any;
    const job = await restoreJobsDb.get(args.jobId);

    if (!job) {
      throw new Error("Restore job not found");
    }

    await restoreJobsDb.patch(job._id, {
      status: "failed",
      failedAt: args.failedAt,
      updatedAt: args.failedAt,
      error: args.error,
    });

    return {
      jobId: String(job._id),
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
    const restoreJobsDb = ctx.db as any;
    const page = await restoreJobsDb
      .query("restoreJobs")
      .withIndex("by_user_requestedAt", (q: any) => q.eq("userId", user._id))
      .order("desc")
      .paginate(args.paginationOpts);

    const mappedPage = page.page.map((job: any) => ({
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

    const restoreJobsDb = ctx.db as any;
    const staleJobs = await restoreJobsDb
      .query("restoreJobs")
      .withIndex("by_requestedAt", (q: any) => q.lt("requestedAt", cutoff))
      .order("asc")
      .take(maxDeletes);

    let deletedJobs = 0;

    for (const job of staleJobs) {
      await restoreJobsDb.delete(job._id);
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
    rows: v.array(v.any()),
    conflictMode: restoreConflictModeValidator,
    allowPartial: v.boolean(),
  },
  handler: async (ctx, args: RestoreBatchDatasetArgs) => {
    const db = ctx.db as any;
    const result = createEmptyRestoreBatchResult();

    for (const rawRow of args.rows) {
      result.processed += 1;

      try {
        if (args.dataset === "summaries") {
          const row = rawRow as ExportSummaryRow;
          const existing = await db
            .query("daySummaries")
            .withIndex("by_user_day", (q: any) =>
              q.eq("userId", args.userId).eq("dayKey", row.dayKey),
            )
            .unique();

          if (!existing) {
            await db.insert("daySummaries", {
              userId: args.userId,
              dayKey: row.dayKey,
              story: row.story,
              highlights: row.highlights,
              metrics: row.metrics,
              sourcesUsed: row.sourcesUsed,
              generatedAt: row.generatedAt,
            });
            result.inserted += 1;
            continue;
          }

          if (summaryRowEquivalent(row, existing)) {
            result.skipped += 1;
            continue;
          }

          if (args.conflictMode === "overwrite") {
            await db.patch(existing._id, {
              story: row.story,
              highlights: row.highlights,
              metrics: row.metrics,
              sourcesUsed: row.sourcesUsed,
              generatedAt: row.generatedAt,
            });
            result.updated += 1;
            continue;
          }

          result.conflicts += 1;
          result.skipped += 1;
          continue;
        }

        if (args.dataset === "days") {
          const row = rawRow as ExportDayRow;
          const existing = await db
            .query("days")
            .withIndex("by_user_day", (q: any) =>
              q.eq("userId", args.userId).eq("dayKey", row.dayKey),
            )
            .unique();

          if (!existing) {
            await db.insert("days", {
              userId: args.userId,
              dayKey: row.dayKey,
              rating: row.rating,
              manualNotes: row.manualNotes,
              peopleTags: row.peopleTags,
            });
            result.inserted += 1;
            continue;
          }

          if (dayRowEquivalent(row, existing)) {
            result.skipped += 1;
            continue;
          }

          if (args.conflictMode === "overwrite") {
            await db.patch(existing._id, {
              rating: row.rating,
              manualNotes: row.manualNotes,
              peopleTags: row.peopleTags,
            });
            result.updated += 1;
            continue;
          }

          result.conflicts += 1;
          result.skipped += 1;
          continue;
        }

        if (args.dataset === "integrationDailyData") {
          const row = rawRow as ExportIntegrationRow;
          const existing = await db
            .query("integrationDailyData")
            .withIndex("by_user_provider_day", (q: any) =>
              q
                .eq("userId", args.userId)
                .eq("provider", row.provider)
                .eq("dayKey", row.dayKey),
            )
            .unique();

          if (!existing) {
            await db.insert("integrationDailyData", {
              userId: args.userId,
              provider: row.provider,
              dayKey: row.dayKey,
              syncedAt: row.syncedAt,
              summary: row.summary,
              metrics: row.metrics,
              signals: row.signals,
              context: row.context,
            });
            result.inserted += 1;
            continue;
          }

          if (integrationRowEquivalent(row, existing)) {
            result.skipped += 1;
            continue;
          }

          if (args.conflictMode === "overwrite") {
            await db.patch(existing._id, {
              syncedAt: row.syncedAt,
              summary: row.summary,
              metrics: row.metrics,
              signals: row.signals,
              context: row.context,
            });
            result.updated += 1;
            continue;
          }

          result.conflicts += 1;
          result.skipped += 1;
          continue;
        }

        const row = rawRow as ExportMemoryRow;
        const restoreClientRequestId = buildRestoreMemoryClientRequestId(row);

        const existingByRestoreRequestId = await db
          .query("memories")
          .withIndex("by_user_clientRequestId", (q: any) =>
            q
              .eq("userId", args.userId)
              .eq("clientRequestId", restoreClientRequestId),
          )
          .unique();

        if (existingByRestoreRequestId) {
          if (memoryRowEquivalent(row, existingByRestoreRequestId)) {
            result.skipped += 1;
            continue;
          }

          if (args.conflictMode === "overwrite") {
            await db.patch(existingByRestoreRequestId._id, {
              dayKey: row.dayKey,
              title: row.title,
              description: row.description,
              mood: row.mood,
              happenedAt: row.happenedAt,
            });
            result.updated += 1;
            continue;
          }

          result.conflicts += 1;
          result.skipped += 1;
          continue;
        }

        const rowsByTimestamp = await db
          .query("memories")
          .withIndex("by_user_happenedAt", (q: any) =>
            q.eq("userId", args.userId).eq("happenedAt", row.happenedAt),
          )
          .collect();

        const exactDuplicate = rowsByTimestamp.find((existing: any) =>
          memoryRowEquivalent(row, existing),
        );

        if (exactDuplicate) {
          result.skipped += 1;
          continue;
        }

        const potentialConflict = rowsByTimestamp.find(
          (existing: any) =>
            existing.dayKey === row.dayKey && existing.title === row.title,
        );

        if (potentialConflict) {
          if (args.conflictMode === "overwrite") {
            await db.patch(potentialConflict._id, {
              dayKey: row.dayKey,
              title: row.title,
              description: row.description,
              mood: row.mood,
              happenedAt: row.happenedAt,
            });
            result.updated += 1;
            continue;
          }

          result.conflicts += 1;
          result.skipped += 1;
          continue;
        }

        await db.insert("memories", {
          userId: args.userId,
          clientRequestId: restoreClientRequestId,
          dayKey: row.dayKey,
          title: row.title,
          description: row.description,
          mood: row.mood,
          happenedAt: row.happenedAt,
        });
        result.inserted += 1;
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
