import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { applyDashboardMetricsDelta } from "../../dashboardMetrics";
import {
  buildSummarySensitiveWritePayload,
  withSummarySensitiveFields,
  type SummarySensitiveRecord,
} from "../../sensitiveDataFields";

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

export function getUtcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

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
