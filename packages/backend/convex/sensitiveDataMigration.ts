import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./authz";
import {
  buildDaySensitiveWritePayload,
  buildIntegrationDailySensitiveWritePayload,
  buildMemorySensitiveWritePayload,
  buildSummarySensitiveWritePayload,
  hasLegacyDayPlaintext,
  hasLegacyIntegrationDailyPlaintext,
  hasLegacyMemoryPlaintext,
  hasLegacySummaryPlaintext,
  needsDaySensitiveMigration,
  needsIntegrationDailySensitiveMigration,
  needsMemorySensitiveMigration,
  needsSummarySensitiveMigration,
  readDaySensitiveFields,
  readIntegrationDailySensitiveFields,
  readMemorySensitiveFields,
  readSummarySensitiveFields,
  type DaySensitiveRecord,
  type IntegrationDailySensitiveRecord,
  type MemorySensitiveRecord,
  type SummarySensitiveRecord,
} from "./sensitiveDataFields";
import { isSensitiveDataEnvelope } from "./sensitiveDataCrypto";

const migrationTableValidator = v.union(
  v.literal("memories"),
  v.literal("days"),
  v.literal("daySummaries"),
  v.literal("integrationDailyData"),
);

type MigrationTable =
  | "memories"
  | "days"
  | "daySummaries"
  | "integrationDailyData";

type ParsedNumberCursor = { value: number; id: string };
type ParsedStringCursor = { value: string; id: string };

type MemoryMigrationRecord = Doc<"memories"> & MemorySensitiveRecord;
type DayMigrationRecord = Doc<"days"> & DaySensitiveRecord;
type SummaryMigrationRecord = Doc<"daySummaries"> & SummarySensitiveRecord;

type BatchResult = {
  table: MigrationTable;
  scanned: number;
  migrated: number;
  plaintextDetected: number;
  failed: number;
  done: boolean;
  nextCursor: string | undefined;
  dryRun: boolean;
};

type TableAuditResult = {
  table: MigrationTable;
  scanned: number;
  needsMigrationRows: number;
  plaintextRows: number;
  sealedRows: number;
  missingNonceRows: number;
  missingNonceRejectRiskRows: number;
  migratedRows: number;
  migratedWithPlaintextRows: number;
  validationRejectRiskRows: number;
  done: boolean;
  nextCursor: string | undefined;
};

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const TAKE_PADDING = 32;
const CURSOR_SEPARATOR = "::";

function clampBatchSize(batchSize: number | undefined): number {
  if (batchSize === undefined) return DEFAULT_BATCH_SIZE;
  if (!Number.isFinite(batchSize)) return DEFAULT_BATCH_SIZE;
  const rounded = Math.trunc(batchSize);
  if (rounded < 1) return 1;
  return Math.min(rounded, MAX_BATCH_SIZE);
}

function parseNumberCursor(
  cursor: string | undefined,
): ParsedNumberCursor | null {
  if (!cursor) return null;
  const splitIndex = cursor.lastIndexOf(CURSOR_SEPARATOR);
  if (
    splitIndex <= 0 ||
    splitIndex >= cursor.length - CURSOR_SEPARATOR.length
  ) {
    throw new Error("Invalid migration cursor format");
  }

  const valueRaw = cursor.slice(0, splitIndex);
  const id = cursor.slice(splitIndex + CURSOR_SEPARATOR.length);
  const value = Number(valueRaw);

  if (!Number.isFinite(value) || id.length === 0) {
    throw new Error("Invalid migration cursor payload");
  }

  return { value, id };
}

function parseStringCursor(
  cursor: string | undefined,
): ParsedStringCursor | null {
  if (!cursor) return null;
  const splitIndex = cursor.lastIndexOf(CURSOR_SEPARATOR);
  if (
    splitIndex <= 0 ||
    splitIndex >= cursor.length - CURSOR_SEPARATOR.length
  ) {
    throw new Error("Invalid migration cursor format");
  }

  const value = cursor.slice(0, splitIndex);
  const id = cursor.slice(splitIndex + CURSOR_SEPARATOR.length);

  if (value.length === 0 || id.length === 0) {
    throw new Error("Invalid migration cursor payload");
  }

  return { value, id };
}

function encodeCursor(value: number | string, id: string): string {
  return `${String(value)}${CURSOR_SEPARATOR}${id}`;
}

function isAfterNumberCursor(
  rowValue: number,
  rowId: string,
  cursor: ParsedNumberCursor,
): boolean {
  return (
    rowValue > cursor.value ||
    (rowValue === cursor.value && rowId.localeCompare(cursor.id) > 0)
  );
}

function isAfterStringCursor(
  rowValue: string,
  rowId: string,
  cursor: ParsedStringCursor,
): boolean {
  return (
    rowValue.localeCompare(cursor.value) > 0 ||
    (rowValue === cursor.value && rowId.localeCompare(cursor.id) > 0)
  );
}

function isDoneForBatch({
  rows,
  hasMore,
}: {
  rows: unknown[];
  hasMore: boolean;
}): boolean {
  if (rows.length === 0) return true;
  return !hasMore;
}

function hasMemoryEncryptedFields(record: MemorySensitiveRecord): boolean {
  return (
    isSensitiveDataEnvelope(record.titleEncrypted) ||
    isSensitiveDataEnvelope(record.descriptionEncrypted) ||
    isSensitiveDataEnvelope(record.moodEncrypted)
  );
}

function hasDayEncryptedFields(record: DaySensitiveRecord): boolean {
  return (
    isSensitiveDataEnvelope(record.manualNotesEncrypted) ||
    isSensitiveDataEnvelope(record.peopleTagsEncrypted)
  );
}

function hasSummaryEncryptedFields(record: SummarySensitiveRecord): boolean {
  return (
    isSensitiveDataEnvelope(record.storyEncrypted) ||
    isSensitiveDataEnvelope(record.highlightsEncrypted)
  );
}

function hasIntegrationEncryptedFields(
  record: IntegrationDailySensitiveRecord,
): boolean {
  return (
    isSensitiveDataEnvelope(record.summaryEncrypted) ||
    isSensitiveDataEnvelope(record.signalsEncrypted) ||
    isSensitiveDataEnvelope(record.contextEncrypted)
  );
}

function hasNonce(record: { sensitiveDataNonce?: string }): boolean {
  return Boolean(record.sensitiveDataNonce?.trim());
}

async function auditMemoriesBatch(
  ctx: any,
  args: {
    batchSize: number;
    cursor: string | undefined;
  },
): Promise<TableAuditResult> {
  const fetched = await fetchMemoriesBatchRows(
    ctx.db,
    args.batchSize,
    args.cursor,
  );
  const rows = fetched.rows as MemoryMigrationRecord[];

  let needsMigrationRows = 0;
  let plaintextRows = 0;
  let sealedRows = 0;
  let missingNonceRows = 0;
  let missingNonceRejectRiskRows = 0;
  let migratedRows = 0;
  let migratedWithPlaintextRows = 0;
  let validationRejectRiskRows = 0;

  for (const row of rows) {
    const hasPlaintext = hasLegacyMemoryPlaintext(row);
    const encrypted = hasMemoryEncryptedFields(row);
    const noncePresent = hasNonce(row);
    const migrated = row.sensitiveDataMigratedAt !== undefined;
    const missingNonce = encrypted && !noncePresent;
    const missingNonceRejectRisk = missingNonce && !hasPlaintext;
    const migratedWithPlaintext = migrated && hasPlaintext;
    const rejectRisk = migratedWithPlaintext || missingNonceRejectRisk;

    if (needsMemorySensitiveMigration(row)) needsMigrationRows += 1;
    if (hasPlaintext) plaintextRows += 1;
    if (migrated) migratedRows += 1;
    if (migratedWithPlaintext) migratedWithPlaintextRows += 1;
    if (missingNonce) missingNonceRows += 1;
    if (missingNonceRejectRisk) missingNonceRejectRiskRows += 1;
    if (rejectRisk) validationRejectRiskRows += 1;
    if (migrated && noncePresent && !hasPlaintext) sealedRows += 1;
  }

  const lastRow = rows[rows.length - 1];
  const done = isDoneForBatch({ rows, hasMore: fetched.hasMore });

  return {
    table: "memories",
    scanned: rows.length,
    needsMigrationRows,
    plaintextRows,
    sealedRows,
    missingNonceRows,
    missingNonceRejectRiskRows,
    migratedRows,
    migratedWithPlaintextRows,
    validationRejectRiskRows,
    done,
    nextCursor:
      done || !lastRow
        ? undefined
        : encodeCursor(lastRow.happenedAt, String(lastRow._id)),
  };
}

async function auditDaysBatch(
  ctx: any,
  args: {
    batchSize: number;
    cursor: string | undefined;
  },
): Promise<TableAuditResult> {
  const fetched = await fetchDaysBatchRows(ctx.db, args.batchSize, args.cursor);
  const rows = fetched.rows as DayMigrationRecord[];

  let needsMigrationRows = 0;
  let plaintextRows = 0;
  let sealedRows = 0;
  let missingNonceRows = 0;
  let missingNonceRejectRiskRows = 0;
  let migratedRows = 0;
  let migratedWithPlaintextRows = 0;
  let validationRejectRiskRows = 0;

  for (const row of rows) {
    const hasPlaintext = hasLegacyDayPlaintext(row);
    const encrypted = hasDayEncryptedFields(row);
    const noncePresent = hasNonce(row);
    const migrated = row.sensitiveDataMigratedAt !== undefined;
    const missingNonce = encrypted && !noncePresent;
    const missingNonceRejectRisk = missingNonce && !hasPlaintext;
    const migratedWithPlaintext = migrated && hasPlaintext;
    const rejectRisk = migratedWithPlaintext || missingNonceRejectRisk;

    if (needsDaySensitiveMigration(row)) needsMigrationRows += 1;
    if (hasPlaintext) plaintextRows += 1;
    if (migrated) migratedRows += 1;
    if (migratedWithPlaintext) migratedWithPlaintextRows += 1;
    if (missingNonce) missingNonceRows += 1;
    if (missingNonceRejectRisk) missingNonceRejectRiskRows += 1;
    if (rejectRisk) validationRejectRiskRows += 1;
    if (migrated && noncePresent && !hasPlaintext) sealedRows += 1;
  }

  const lastRow = rows[rows.length - 1];
  const done = isDoneForBatch({ rows, hasMore: fetched.hasMore });

  return {
    table: "days",
    scanned: rows.length,
    needsMigrationRows,
    plaintextRows,
    sealedRows,
    missingNonceRows,
    missingNonceRejectRiskRows,
    migratedRows,
    migratedWithPlaintextRows,
    validationRejectRiskRows,
    done,
    nextCursor:
      done || !lastRow
        ? undefined
        : encodeCursor(lastRow.dayKey, String(lastRow._id)),
  };
}

async function auditSummariesBatch(
  ctx: any,
  args: {
    batchSize: number;
    cursor: string | undefined;
  },
): Promise<TableAuditResult> {
  const fetched = await fetchSummariesBatchRows(
    ctx.db,
    args.batchSize,
    args.cursor,
  );
  const rows = fetched.rows as SummaryMigrationRecord[];

  let needsMigrationRows = 0;
  let plaintextRows = 0;
  let sealedRows = 0;
  let missingNonceRows = 0;
  let missingNonceRejectRiskRows = 0;
  let migratedRows = 0;
  let migratedWithPlaintextRows = 0;
  let validationRejectRiskRows = 0;

  for (const row of rows) {
    const hasPlaintext = hasLegacySummaryPlaintext(row);
    const encrypted = hasSummaryEncryptedFields(row);
    const noncePresent = hasNonce(row);
    const migrated = row.sensitiveDataMigratedAt !== undefined;
    const missingNonce = encrypted && !noncePresent;
    const missingNonceRejectRisk = missingNonce && !hasPlaintext;
    const migratedWithPlaintext = migrated && hasPlaintext;
    const rejectRisk = migratedWithPlaintext || missingNonceRejectRisk;

    if (needsSummarySensitiveMigration(row)) needsMigrationRows += 1;
    if (hasPlaintext) plaintextRows += 1;
    if (migrated) migratedRows += 1;
    if (migratedWithPlaintext) migratedWithPlaintextRows += 1;
    if (missingNonce) missingNonceRows += 1;
    if (missingNonceRejectRisk) missingNonceRejectRiskRows += 1;
    if (rejectRisk) validationRejectRiskRows += 1;
    if (migrated && noncePresent && !hasPlaintext) sealedRows += 1;
  }

  const lastRow = rows[rows.length - 1];
  const done = isDoneForBatch({ rows, hasMore: fetched.hasMore });

  return {
    table: "daySummaries",
    scanned: rows.length,
    needsMigrationRows,
    plaintextRows,
    sealedRows,
    missingNonceRows,
    missingNonceRejectRiskRows,
    migratedRows,
    migratedWithPlaintextRows,
    validationRejectRiskRows,
    done,
    nextCursor:
      done || !lastRow
        ? undefined
        : encodeCursor(lastRow.generatedAt, String(lastRow._id)),
  };
}

async function auditIntegrationDailyBatch(
  ctx: any,
  args: {
    batchSize: number;
    cursor: string | undefined;
  },
): Promise<TableAuditResult> {
  const fetched = await fetchIntegrationDailyBatchRows(
    ctx.db,
    args.batchSize,
    args.cursor,
  );
  const rows = fetched.rows;

  let needsMigrationRows = 0;
  let plaintextRows = 0;
  let sealedRows = 0;
  let missingNonceRows = 0;
  let missingNonceRejectRiskRows = 0;
  let migratedRows = 0;
  let migratedWithPlaintextRows = 0;
  let validationRejectRiskRows = 0;

  for (const row of rows) {
    const hasPlaintext = hasLegacyIntegrationDailyPlaintext(row);
    const encrypted = hasIntegrationEncryptedFields(row);
    const noncePresent = hasNonce(row);
    const migrated = row.sensitiveDataMigratedAt !== undefined;
    const missingNonce = encrypted && !noncePresent;
    const missingNonceRejectRisk = missingNonce && !hasPlaintext;
    const migratedWithPlaintext = migrated && hasPlaintext;
    const rejectRisk = migratedWithPlaintext || missingNonceRejectRisk;

    if (needsIntegrationDailySensitiveMigration(row)) needsMigrationRows += 1;
    if (hasPlaintext) plaintextRows += 1;
    if (migrated) migratedRows += 1;
    if (migratedWithPlaintext) migratedWithPlaintextRows += 1;
    if (missingNonce) missingNonceRows += 1;
    if (missingNonceRejectRisk) missingNonceRejectRiskRows += 1;
    if (rejectRisk) validationRejectRiskRows += 1;
    if (migrated && noncePresent && !hasPlaintext) sealedRows += 1;
  }

  const lastRow = rows[rows.length - 1];
  const done = isDoneForBatch({ rows, hasMore: fetched.hasMore });

  return {
    table: "integrationDailyData",
    scanned: rows.length,
    needsMigrationRows,
    plaintextRows,
    sealedRows,
    missingNonceRows,
    missingNonceRejectRiskRows,
    migratedRows,
    migratedWithPlaintextRows,
    validationRejectRiskRows,
    done,
    nextCursor:
      done || !lastRow
        ? undefined
        : encodeCursor(lastRow.syncedAt, String(lastRow._id)),
  };
}

async function fetchMemoriesBatchRows(
  db: any,
  batchSize: number,
  cursor: string | undefined,
): Promise<{ rows: Doc<"memories">[]; hasMore: boolean }> {
  const parsedCursor = parseNumberCursor(cursor);
  const takeSize = batchSize + TAKE_PADDING;
  const query = parsedCursor
    ? db
        .query("memories")
        .withIndex("by_happenedAt", (q: any) =>
          q.gte("happenedAt", parsedCursor.value),
        )
    : db.query("memories").withIndex("by_happenedAt");

  const candidates = (await query
    .order("asc")
    .take(takeSize)) as Doc<"memories">[];
  const filtered = parsedCursor
    ? candidates.filter((row) =>
        isAfterNumberCursor(row.happenedAt, String(row._id), parsedCursor),
      )
    : candidates;

  return {
    rows: filtered.slice(0, batchSize),
    hasMore: filtered.length > batchSize || candidates.length === takeSize,
  };
}

async function fetchDaysBatchRows(
  db: any,
  batchSize: number,
  cursor: string | undefined,
): Promise<{ rows: Doc<"days">[]; hasMore: boolean }> {
  const parsedCursor = parseStringCursor(cursor);
  const takeSize = batchSize + TAKE_PADDING;
  const query = parsedCursor
    ? db
        .query("days")
        .withIndex("by_dayKey", (q: any) => q.gte("dayKey", parsedCursor.value))
    : db.query("days").withIndex("by_dayKey");

  const candidates = (await query.order("asc").take(takeSize)) as Doc<"days">[];
  const filtered = parsedCursor
    ? candidates.filter((row) =>
        isAfterStringCursor(row.dayKey, String(row._id), parsedCursor),
      )
    : candidates;

  return {
    rows: filtered.slice(0, batchSize),
    hasMore: filtered.length > batchSize || candidates.length === takeSize,
  };
}

async function fetchSummariesBatchRows(
  db: any,
  batchSize: number,
  cursor: string | undefined,
): Promise<{ rows: Doc<"daySummaries">[]; hasMore: boolean }> {
  const parsedCursor = parseNumberCursor(cursor);
  const takeSize = batchSize + TAKE_PADDING;
  const query = parsedCursor
    ? db
        .query("daySummaries")
        .withIndex("by_generatedAt", (q: any) =>
          q.gte("generatedAt", parsedCursor.value),
        )
    : db.query("daySummaries").withIndex("by_generatedAt");

  const candidates = (await query
    .order("asc")
    .take(takeSize)) as Doc<"daySummaries">[];
  const filtered = parsedCursor
    ? candidates.filter((row) =>
        isAfterNumberCursor(row.generatedAt, String(row._id), parsedCursor),
      )
    : candidates;

  return {
    rows: filtered.slice(0, batchSize),
    hasMore: filtered.length > batchSize || candidates.length === takeSize,
  };
}

async function fetchIntegrationDailyBatchRows(
  db: any,
  batchSize: number,
  cursor: string | undefined,
): Promise<{ rows: Doc<"integrationDailyData">[]; hasMore: boolean }> {
  const parsedCursor = parseNumberCursor(cursor);
  const takeSize = batchSize + TAKE_PADDING;
  const query = parsedCursor
    ? db
        .query("integrationDailyData")
        .withIndex("by_syncedAt", (q: any) =>
          q.gte("syncedAt", parsedCursor.value),
        )
    : db.query("integrationDailyData").withIndex("by_syncedAt");

  const candidates = (await query
    .order("asc")
    .take(takeSize)) as Doc<"integrationDailyData">[];
  const filtered = parsedCursor
    ? candidates.filter((row) =>
        isAfterNumberCursor(row.syncedAt, String(row._id), parsedCursor),
      )
    : candidates;

  return {
    rows: filtered.slice(0, batchSize),
    hasMore: filtered.length > batchSize || candidates.length === takeSize,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown migration error";
}

async function migrateMemoriesBatch(
  ctx: any,
  args: {
    batchSize: number;
    cursor: string | undefined;
    dryRun: boolean;
  },
): Promise<BatchResult> {
  const fetched = await fetchMemoriesBatchRows(
    ctx.db,
    args.batchSize,
    args.cursor,
  );
  const rows = fetched.rows as MemoryMigrationRecord[];

  let migrated = 0;
  let plaintextDetected = 0;
  let failed = 0;

  for (const row of rows) {
    const hasPlaintext = hasLegacyMemoryPlaintext(row);
    if (hasPlaintext) plaintextDetected += 1;

    if (!needsMemorySensitiveMigration(row)) {
      continue;
    }

    try {
      const sensitive = await readMemorySensitiveFields(row);
      if (!args.dryRun) {
        const payload = await buildMemorySensitiveWritePayload({
          userId: row.userId,
          title: sensitive.title,
          description: sensitive.description,
          mood: sensitive.mood,
          sensitiveDataNonce: row.sensitiveDataNonce,
        });
        await ctx.db.patch(row._id, payload);
      }
      migrated += 1;
    } catch {
      failed += 1;
    }
  }

  const lastRow = rows[rows.length - 1];
  const done = isDoneForBatch({ rows, hasMore: fetched.hasMore });

  return {
    table: "memories",
    scanned: rows.length,
    migrated,
    plaintextDetected,
    failed,
    done,
    nextCursor:
      done || !lastRow
        ? undefined
        : encodeCursor(lastRow.happenedAt, String(lastRow._id)),
    dryRun: args.dryRun,
  };
}

async function migrateDaysBatch(
  ctx: any,
  args: {
    batchSize: number;
    cursor: string | undefined;
    dryRun: boolean;
  },
): Promise<BatchResult> {
  const fetched = await fetchDaysBatchRows(ctx.db, args.batchSize, args.cursor);
  const rows = fetched.rows as DayMigrationRecord[];

  let migrated = 0;
  let plaintextDetected = 0;
  let failed = 0;

  for (const row of rows) {
    const hasPlaintext = hasLegacyDayPlaintext(row);
    if (hasPlaintext) plaintextDetected += 1;

    if (!needsDaySensitiveMigration(row)) {
      continue;
    }

    try {
      const sensitive = await readDaySensitiveFields(row);
      if (!args.dryRun) {
        const payload = await buildDaySensitiveWritePayload({
          userId: row.userId,
          manualNotes: sensitive.manualNotes,
          peopleTags: sensitive.peopleTags,
          sensitiveDataNonce: row.sensitiveDataNonce,
        });
        await ctx.db.patch(row._id, payload);
      }
      migrated += 1;
    } catch {
      failed += 1;
    }
  }

  const lastRow = rows[rows.length - 1];
  const done = isDoneForBatch({ rows, hasMore: fetched.hasMore });

  return {
    table: "days",
    scanned: rows.length,
    migrated,
    plaintextDetected,
    failed,
    done,
    nextCursor:
      done || !lastRow
        ? undefined
        : encodeCursor(lastRow.dayKey, String(lastRow._id)),
    dryRun: args.dryRun,
  };
}

async function migrateSummariesBatch(
  ctx: any,
  args: {
    batchSize: number;
    cursor: string | undefined;
    dryRun: boolean;
  },
): Promise<BatchResult> {
  const fetched = await fetchSummariesBatchRows(
    ctx.db,
    args.batchSize,
    args.cursor,
  );
  const rows = fetched.rows as SummaryMigrationRecord[];

  let migrated = 0;
  let plaintextDetected = 0;
  let failed = 0;

  for (const row of rows) {
    const hasPlaintext = hasLegacySummaryPlaintext(row);
    if (hasPlaintext) plaintextDetected += 1;

    if (!needsSummarySensitiveMigration(row)) {
      continue;
    }

    try {
      const sensitive = await readSummarySensitiveFields(row);
      if (!args.dryRun) {
        const payload = await buildSummarySensitiveWritePayload({
          userId: row.userId,
          story: sensitive.story,
          highlights: sensitive.highlights,
          sensitiveDataNonce: row.sensitiveDataNonce,
        });
        await ctx.db.patch(row._id, payload);
      }
      migrated += 1;
    } catch {
      failed += 1;
    }
  }

  const lastRow = rows[rows.length - 1];
  const done = isDoneForBatch({ rows, hasMore: fetched.hasMore });

  return {
    table: "daySummaries",
    scanned: rows.length,
    migrated,
    plaintextDetected,
    failed,
    done,
    nextCursor:
      done || !lastRow
        ? undefined
        : encodeCursor(lastRow.generatedAt, String(lastRow._id)),
    dryRun: args.dryRun,
  };
}

async function migrateIntegrationDailyBatch(
  ctx: any,
  args: {
    batchSize: number;
    cursor: string | undefined;
    dryRun: boolean;
  },
): Promise<BatchResult> {
  const fetched = await fetchIntegrationDailyBatchRows(
    ctx.db,
    args.batchSize,
    args.cursor,
  );
  const rows = fetched.rows;

  let migrated = 0;
  let plaintextDetected = 0;
  let failed = 0;

  for (const row of rows) {
    const hasPlaintext = hasLegacyIntegrationDailyPlaintext(row);
    if (hasPlaintext) plaintextDetected += 1;

    if (!needsIntegrationDailySensitiveMigration(row)) {
      continue;
    }

    try {
      const sensitive = await readIntegrationDailySensitiveFields(row);
      if (!args.dryRun) {
        const payload = await buildIntegrationDailySensitiveWritePayload({
          userId: row.userId,
          summary: sensitive.summary,
          signals: sensitive.signals,
          context: sensitive.context,
          sensitiveDataNonce: row.sensitiveDataNonce,
        });
        await ctx.db.patch(row._id, payload);
      }
      migrated += 1;
    } catch {
      failed += 1;
    }
  }

  const lastRow = rows[rows.length - 1];
  const done = isDoneForBatch({ rows, hasMore: fetched.hasMore });

  return {
    table: "integrationDailyData",
    scanned: rows.length,
    migrated,
    plaintextDetected,
    failed,
    done,
    nextCursor:
      done || !lastRow
        ? undefined
        : encodeCursor(lastRow.syncedAt, String(lastRow._id)),
    dryRun: args.dryRun,
  };
}

export const adminMigrateSensitiveDataBatch = mutation({
  args: {
    table: migrationTableValidator,
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BatchResult> => {
    await requireAdmin(ctx);

    const batchArgs = {
      batchSize: clampBatchSize(args.batchSize),
      cursor: args.cursor,
      dryRun: Boolean(args.dryRun),
    };

    switch (args.table) {
      case "memories":
        return await migrateMemoriesBatch(ctx, batchArgs);
      case "days":
        return await migrateDaysBatch(ctx, batchArgs);
      case "daySummaries":
        return await migrateSummariesBatch(ctx, batchArgs);
      case "integrationDailyData":
        return await migrateIntegrationDailyBatch(ctx, batchArgs);
      default:
        throw new Error(`Unsupported table: ${String(args.table)}`);
    }
  },
});

export const adminAuditSensitiveDataTableStatus = query({
  args: {
    table: migrationTableValidator,
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<TableAuditResult> => {
    await requireAdmin(ctx);

    const auditArgs = {
      batchSize: clampBatchSize(args.batchSize),
      cursor: args.cursor,
    };

    switch (args.table) {
      case "memories":
        return await auditMemoriesBatch(ctx, auditArgs);
      case "days":
        return await auditDaysBatch(ctx, auditArgs);
      case "daySummaries":
        return await auditSummariesBatch(ctx, auditArgs);
      case "integrationDailyData":
        return await auditIntegrationDailyBatch(ctx, auditArgs);
      default:
        throw new Error(`Unsupported table: ${String(args.table)}`);
    }
  },
});

export const adminMigrateAllSensitiveData = mutation({
  args: {
    batchSize: v.optional(v.number()),
    maxBatchesPerTable: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const batchSize = clampBatchSize(args.batchSize);
    const maxBatchesPerTable = Math.max(
      1,
      Math.min(Math.trunc(args.maxBatchesPerTable ?? 20), 200),
    );
    const dryRun = Boolean(args.dryRun);

    const tables: MigrationTable[] = [
      "memories",
      "days",
      "daySummaries",
      "integrationDailyData",
    ];

    const results: Array<{
      table: MigrationTable;
      batches: number;
      scanned: number;
      migrated: number;
      plaintextDetected: number;
      failed: number;
      complete: boolean;
      nextCursor: string | undefined;
      failures: string[];
    }> = [];

    for (const table of tables) {
      let cursor: string | undefined;
      let batches = 0;
      let scanned = 0;
      let migrated = 0;
      let plaintextDetected = 0;
      let failed = 0;
      const failures: string[] = [];

      while (batches < maxBatchesPerTable) {
        let batch: BatchResult;

        try {
          switch (table) {
            case "memories":
              batch = await migrateMemoriesBatch(ctx, {
                batchSize,
                cursor,
                dryRun,
              });
              break;
            case "days":
              batch = await migrateDaysBatch(ctx, {
                batchSize,
                cursor,
                dryRun,
              });
              break;
            case "daySummaries":
              batch = await migrateSummariesBatch(ctx, {
                batchSize,
                cursor,
                dryRun,
              });
              break;
            case "integrationDailyData":
              batch = await migrateIntegrationDailyBatch(ctx, {
                batchSize,
                cursor,
                dryRun,
              });
              break;
            default:
              throw new Error(`Unsupported table: ${String(table)}`);
          }
        } catch (error) {
          failures.push(getErrorMessage(error));
          break;
        }

        batches += 1;
        scanned += batch.scanned;
        migrated += batch.migrated;
        plaintextDetected += batch.plaintextDetected;
        failed += batch.failed;
        cursor = batch.nextCursor;

        if (batch.done || !batch.nextCursor) {
          cursor = undefined;
          break;
        }
      }

      results.push({
        table,
        batches,
        scanned,
        migrated,
        plaintextDetected,
        failed,
        complete: cursor === undefined,
        nextCursor: cursor,
        failures,
      });
    }

    return {
      dryRun,
      batchSize,
      maxBatchesPerTable,
      results,
      totals: {
        scanned: results.reduce((sum, item) => sum + item.scanned, 0),
        migrated: results.reduce((sum, item) => sum + item.migrated, 0),
        plaintextDetected: results.reduce(
          (sum, item) => sum + item.plaintextDetected,
          0,
        ),
        failed: results.reduce((sum, item) => sum + item.failed, 0),
      },
    };
  },
});
