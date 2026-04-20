import type { Doc, Id } from "./_generated/dataModel";
import type { IntegrationDailyContext } from "./integrations.dailyData";
import {
  createSensitiveDataNonce,
  decrypt,
  encrypt,
  isSensitiveDataEnvelope,
  type SensitiveDataEnvelope,
} from "./sensitiveDataCrypto";

type BaseSensitiveRecord = {
  userId: Id<"user">;
  sensitiveDataNonce?: string;
  sensitiveDataMigratedAt?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoPlaintextAfterMigration(args: {
  table: string;
  migratedAt: number | undefined;
  hasPlaintext: boolean;
}) {
  if (args.migratedAt !== undefined && args.hasPlaintext) {
    throw new Error(
      `Sensitive data validation failed for ${args.table}: plaintext fields were found on a migrated encrypted record.`,
    );
  }
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return undefined;
    }
    parsed.push(item);
  }

  return parsed;
}

function requireSensitiveNonce(record: {
  sensitiveDataNonce?: string;
  table: string;
}): string {
  const nonce = record.sensitiveDataNonce?.trim();
  if (!nonce) {
    throw new Error(
      `Sensitive data record for ${record.table} is missing a nonce and cannot be decrypted.`,
    );
  }

  return nonce;
}

export type MemorySensitiveRecord = BaseSensitiveRecord & {
  title?: string;
  description?: string;
  mood?: string;
  titleEncrypted?: SensitiveDataEnvelope;
  descriptionEncrypted?: SensitiveDataEnvelope;
  moodEncrypted?: SensitiveDataEnvelope;
};

export function hasLegacyMemoryPlaintext(
  record: MemorySensitiveRecord,
): boolean {
  return (
    typeof record.title === "string" ||
    typeof record.description === "string" ||
    typeof record.mood === "string"
  );
}

export function needsMemorySensitiveMigration(
  record: MemorySensitiveRecord,
): boolean {
  return (
    hasLegacyMemoryPlaintext(record) ||
    !isSensitiveDataEnvelope(record.titleEncrypted) ||
    !record.sensitiveDataNonce
  );
}

export async function readMemorySensitiveFields(
  record: MemorySensitiveRecord,
): Promise<{
  title: string;
  description: string | undefined;
  mood: string | undefined;
}> {
  assertNoPlaintextAfterMigration({
    table: "memories",
    migratedAt: record.sensitiveDataMigratedAt,
    hasPlaintext: hasLegacyMemoryPlaintext(record),
  });

  let title: string | undefined;
  let description: string | undefined;
  let mood: string | undefined;

  const hasEncryptedFields =
    isSensitiveDataEnvelope(record.titleEncrypted) ||
    isSensitiveDataEnvelope(record.descriptionEncrypted) ||
    isSensitiveDataEnvelope(record.moodEncrypted);

  if (hasEncryptedFields) {
    const nonce = record.sensitiveDataNonce?.trim();

    if (nonce) {
      title = await decrypt<string>(record.titleEncrypted, {
        table: "memories",
        userId: String(record.userId),
        nonce,
        field: "title",
      });

      description = await decrypt<string>(record.descriptionEncrypted, {
        table: "memories",
        userId: String(record.userId),
        nonce,
        field: "description",
      });

      mood = await decrypt<string>(record.moodEncrypted, {
        table: "memories",
        userId: String(record.userId),
        nonce,
        field: "mood",
      });
    } else if (!hasLegacyMemoryPlaintext(record)) {
      requireSensitiveNonce({
        table: "memories",
        sensitiveDataNonce: record.sensitiveDataNonce,
      });
    }
  }

  if (title === undefined && typeof record.title === "string") {
    title = record.title;
  }

  if (description === undefined && typeof record.description === "string") {
    description = record.description;
  }

  if (mood === undefined && typeof record.mood === "string") {
    mood = record.mood;
  }

  if (!title || title.trim().length === 0) {
    throw new Error("Memory record is missing encrypted/legacy title data.");
  }

  return {
    title,
    description,
    mood,
  };
}

export async function withMemorySensitiveFields<
  T extends MemorySensitiveRecord,
>(
  record: T,
): Promise<
  Omit<T, "title" | "description" | "mood"> & {
    title: string;
    description: string | undefined;
    mood: string | undefined;
  }
> {
  const sensitive = await readMemorySensitiveFields(record);
  return {
    ...(record as Omit<T, "title" | "description" | "mood">),
    title: sensitive.title,
    description: sensitive.description,
    mood: sensitive.mood,
  };
}

export async function buildMemorySensitiveWritePayload(args: {
  userId: Id<"user">;
  title: string;
  description: string | undefined;
  mood: string | undefined;
  sensitiveDataNonce?: string;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const nonce = args.sensitiveDataNonce?.trim() || createSensitiveDataNonce();

  const titleEncrypted = await encrypt(args.title, {
    table: "memories",
    userId: String(args.userId),
    nonce,
    field: "title",
  });

  const descriptionEncrypted =
    args.description !== undefined
      ? await encrypt(args.description, {
          table: "memories",
          userId: String(args.userId),
          nonce,
          field: "description",
        })
      : undefined;

  const moodEncrypted =
    args.mood !== undefined
      ? await encrypt(args.mood, {
          table: "memories",
          userId: String(args.userId),
          nonce,
          field: "mood",
        })
      : undefined;

  return {
    sensitiveDataNonce: nonce,
    sensitiveDataMigratedAt: now,
    titleEncrypted,
    descriptionEncrypted,
    moodEncrypted,
    title: undefined,
    description: undefined,
    mood: undefined,
  };
}

export type DaySensitiveRecord = BaseSensitiveRecord & {
  manualNotes?: string[];
  peopleTags?: string[];
  manualNotesEncrypted?: SensitiveDataEnvelope;
  peopleTagsEncrypted?: SensitiveDataEnvelope;
};

export function hasLegacyDayPlaintext(record: DaySensitiveRecord): boolean {
  return Array.isArray(record.manualNotes) || Array.isArray(record.peopleTags);
}

export function needsDaySensitiveMigration(
  record: DaySensitiveRecord,
): boolean {
  return (
    hasLegacyDayPlaintext(record) ||
    (isSensitiveDataEnvelope(record.manualNotesEncrypted) &&
      !record.sensitiveDataNonce) ||
    (isSensitiveDataEnvelope(record.peopleTagsEncrypted) &&
      !record.sensitiveDataNonce)
  );
}

export async function readDaySensitiveFields(
  record: DaySensitiveRecord,
): Promise<{
  manualNotes: string[];
  peopleTags: string[];
}> {
  assertNoPlaintextAfterMigration({
    table: "days",
    migratedAt: record.sensitiveDataMigratedAt,
    hasPlaintext: hasLegacyDayPlaintext(record),
  });

  let manualNotes: string[] | undefined;
  let peopleTags: string[] | undefined;

  const hasEncryptedFields =
    isSensitiveDataEnvelope(record.manualNotesEncrypted) ||
    isSensitiveDataEnvelope(record.peopleTagsEncrypted);

  if (hasEncryptedFields) {
    const nonce = record.sensitiveDataNonce?.trim();

    if (nonce) {
      manualNotes = await decrypt<string[]>(record.manualNotesEncrypted, {
        table: "days",
        userId: String(record.userId),
        nonce,
        field: "manualNotes",
      });

      peopleTags = await decrypt<string[]>(record.peopleTagsEncrypted, {
        table: "days",
        userId: String(record.userId),
        nonce,
        field: "peopleTags",
      });
    } else if (!hasLegacyDayPlaintext(record)) {
      requireSensitiveNonce({
        table: "days",
        sensitiveDataNonce: record.sensitiveDataNonce,
      });
    }
  }

  if (!manualNotes) {
    manualNotes = readStringArray(record.manualNotes) ?? [];
  }

  if (!peopleTags) {
    peopleTags = readStringArray(record.peopleTags) ?? [];
  }

  return {
    manualNotes,
    peopleTags,
  };
}

export async function withDaySensitiveFields<T extends DaySensitiveRecord>(
  record: T,
): Promise<
  Omit<T, "manualNotes" | "peopleTags"> & {
    manualNotes: string[];
    peopleTags: string[];
  }
> {
  const sensitive = await readDaySensitiveFields(record);
  return {
    ...(record as Omit<T, "manualNotes" | "peopleTags">),
    manualNotes: sensitive.manualNotes,
    peopleTags: sensitive.peopleTags,
  };
}

export async function buildDaySensitiveWritePayload(args: {
  userId: Id<"user">;
  manualNotes: string[] | undefined;
  peopleTags: string[] | undefined;
  sensitiveDataNonce?: string;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const nonce = args.sensitiveDataNonce?.trim() || createSensitiveDataNonce();

  const manualNotesEncrypted =
    args.manualNotes !== undefined
      ? await encrypt(args.manualNotes, {
          table: "days",
          userId: String(args.userId),
          nonce,
          field: "manualNotes",
        })
      : undefined;

  const peopleTagsEncrypted =
    args.peopleTags !== undefined
      ? await encrypt(args.peopleTags, {
          table: "days",
          userId: String(args.userId),
          nonce,
          field: "peopleTags",
        })
      : undefined;

  return {
    sensitiveDataNonce: nonce,
    sensitiveDataMigratedAt: now,
    manualNotesEncrypted,
    peopleTagsEncrypted,
    manualNotes: undefined,
    peopleTags: undefined,
  };
}

export type SummarySensitiveRecord = BaseSensitiveRecord & {
  story?: string;
  highlights?: string[];
  storyEncrypted?: SensitiveDataEnvelope;
  highlightsEncrypted?: SensitiveDataEnvelope;
};

export function hasLegacySummaryPlaintext(
  record: SummarySensitiveRecord,
): boolean {
  return typeof record.story === "string" || Array.isArray(record.highlights);
}

export function needsSummarySensitiveMigration(
  record: SummarySensitiveRecord,
): boolean {
  return (
    hasLegacySummaryPlaintext(record) ||
    !isSensitiveDataEnvelope(record.storyEncrypted) ||
    !isSensitiveDataEnvelope(record.highlightsEncrypted) ||
    !record.sensitiveDataNonce
  );
}

export async function readSummarySensitiveFields(
  record: SummarySensitiveRecord,
): Promise<{
  story: string;
  highlights: string[];
}> {
  assertNoPlaintextAfterMigration({
    table: "daySummaries",
    migratedAt: record.sensitiveDataMigratedAt,
    hasPlaintext: hasLegacySummaryPlaintext(record),
  });

  let story: string | undefined;
  let highlights: string[] | undefined;

  const hasEncryptedFields =
    isSensitiveDataEnvelope(record.storyEncrypted) ||
    isSensitiveDataEnvelope(record.highlightsEncrypted);

  if (hasEncryptedFields) {
    const nonce = record.sensitiveDataNonce?.trim();

    if (nonce) {
      story = await decrypt<string>(record.storyEncrypted, {
        table: "daySummaries",
        userId: String(record.userId),
        nonce,
        field: "story",
      });

      highlights = await decrypt<string[]>(record.highlightsEncrypted, {
        table: "daySummaries",
        userId: String(record.userId),
        nonce,
        field: "highlights",
      });
    } else if (!hasLegacySummaryPlaintext(record)) {
      requireSensitiveNonce({
        table: "daySummaries",
        sensitiveDataNonce: record.sensitiveDataNonce,
      });
    }
  }

  if (story === undefined && typeof record.story === "string") {
    story = record.story;
  }

  if (!highlights) {
    highlights = readStringArray(record.highlights) ?? [];
  }

  if (!story || story.trim().length === 0) {
    throw new Error(
      "Day summary record is missing encrypted/legacy story payload.",
    );
  }

  return {
    story,
    highlights,
  };
}

export async function withSummarySensitiveFields<
  T extends SummarySensitiveRecord,
>(
  record: T,
): Promise<
  Omit<T, "story" | "highlights"> & {
    story: string;
    highlights: string[];
  }
> {
  const sensitive = await readSummarySensitiveFields(record);
  return {
    ...(record as Omit<T, "story" | "highlights">),
    story: sensitive.story,
    highlights: sensitive.highlights,
  };
}

export async function buildSummarySensitiveWritePayload(args: {
  userId: Id<"user">;
  story: string;
  highlights: string[];
  sensitiveDataNonce?: string;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const nonce = args.sensitiveDataNonce?.trim() || createSensitiveDataNonce();

  const storyEncrypted = await encrypt(args.story, {
    table: "daySummaries",
    userId: String(args.userId),
    nonce,
    field: "story",
  });

  const highlightsEncrypted = await encrypt(args.highlights, {
    table: "daySummaries",
    userId: String(args.userId),
    nonce,
    field: "highlights",
  });

  return {
    sensitiveDataNonce: nonce,
    sensitiveDataMigratedAt: now,
    storyEncrypted,
    highlightsEncrypted,
    story: undefined,
    highlights: undefined,
  };
}

export type IntegrationDailySensitiveRecord = Doc<"integrationDailyData">;

export function hasLegacyIntegrationDailyPlaintext(
  record: IntegrationDailySensitiveRecord,
): boolean {
  return (
    typeof record.summary === "string" ||
    Array.isArray(record.signals) ||
    isRecord(record.context)
  );
}

export function needsIntegrationDailySensitiveMigration(
  record: IntegrationDailySensitiveRecord,
): boolean {
  const hasEncryptedField =
    isSensitiveDataEnvelope(record.summaryEncrypted) ||
    isSensitiveDataEnvelope(record.signalsEncrypted) ||
    isSensitiveDataEnvelope(record.contextEncrypted);

  return (
    hasLegacyIntegrationDailyPlaintext(record) ||
    (hasEncryptedField && !record.sensitiveDataNonce)
  );
}

export async function readIntegrationDailySensitiveFields(
  record: IntegrationDailySensitiveRecord,
): Promise<{
  summary: string | undefined;
  signals: string[] | undefined;
  context: IntegrationDailyContext | undefined;
}> {
  assertNoPlaintextAfterMigration({
    table: "integrationDailyData",
    migratedAt: record.sensitiveDataMigratedAt,
    hasPlaintext: hasLegacyIntegrationDailyPlaintext(record),
  });

  let summary: string | undefined;
  let signals: string[] | undefined;
  let context: IntegrationDailyContext | undefined;

  const hasEncryptedFields =
    isSensitiveDataEnvelope(record.summaryEncrypted) ||
    isSensitiveDataEnvelope(record.signalsEncrypted) ||
    isSensitiveDataEnvelope(record.contextEncrypted);

  if (hasEncryptedFields) {
    const nonce = record.sensitiveDataNonce?.trim();

    if (nonce) {
      summary = await decrypt<string>(record.summaryEncrypted, {
        table: "integrationDailyData",
        userId: String(record.userId),
        nonce,
        field: "summary",
      });

      signals = await decrypt<string[]>(record.signalsEncrypted, {
        table: "integrationDailyData",
        userId: String(record.userId),
        nonce,
        field: "signals",
      });

      context = await decrypt<IntegrationDailyContext>(
        record.contextEncrypted,
        {
          table: "integrationDailyData",
          userId: String(record.userId),
          nonce,
          field: "context",
        },
      );
    } else if (!hasLegacyIntegrationDailyPlaintext(record)) {
      requireSensitiveNonce({
        table: "integrationDailyData",
        sensitiveDataNonce: record.sensitiveDataNonce,
      });
    }
  }

  if (summary === undefined && typeof record.summary === "string") {
    summary = record.summary;
  }

  if (signals === undefined) {
    signals = readStringArray(record.signals);
  }

  if (context === undefined && isRecord(record.context)) {
    context = record.context as IntegrationDailyContext;
  }

  return {
    summary,
    signals,
    context,
  };
}

export async function withIntegrationDailySensitiveFields<
  T extends IntegrationDailySensitiveRecord,
>(
  record: T,
): Promise<
  Omit<T, "summary" | "signals" | "context"> & {
    summary: string | undefined;
    signals: string[];
    context: IntegrationDailyContext | undefined;
  }
> {
  const sensitive = await readIntegrationDailySensitiveFields(record);
  return {
    ...(record as Omit<T, "summary" | "signals" | "context">),
    summary: sensitive.summary,
    signals: sensitive.signals ?? [],
    context: sensitive.context,
  };
}

export async function buildIntegrationDailySensitiveWritePayload(args: {
  userId: Id<"user">;
  summary: string | undefined;
  signals: string[] | undefined;
  context: IntegrationDailyContext | undefined;
  sensitiveDataNonce?: string;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const nonce = args.sensitiveDataNonce?.trim() || createSensitiveDataNonce();

  const summaryEncrypted =
    args.summary !== undefined
      ? await encrypt(args.summary, {
          table: "integrationDailyData",
          userId: String(args.userId),
          nonce,
          field: "summary",
        })
      : undefined;

  const signalsEncrypted =
    args.signals !== undefined
      ? await encrypt(args.signals, {
          table: "integrationDailyData",
          userId: String(args.userId),
          nonce,
          field: "signals",
        })
      : undefined;

  const contextEncrypted =
    args.context !== undefined
      ? await encrypt(args.context, {
          table: "integrationDailyData",
          userId: String(args.userId),
          nonce,
          field: "context",
        })
      : undefined;

  return {
    sensitiveDataNonce: nonce,
    sensitiveDataMigratedAt: now,
    summaryEncrypted,
    signalsEncrypted,
    contextEncrypted,
    summary: undefined,
    signals: undefined,
    context: undefined,
  };
}
