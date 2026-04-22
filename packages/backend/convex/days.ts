import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser, requireOwnership } from "./authz";
import { validateDayKey, validateRating, clampLimit } from "./validators";
import { deleteDayCascadeData } from "./cascadeCleanup";
import { applyDashboardMetricsDelta } from "./dashboardMetrics";
import { captureException, logInfo } from "./observability";
import type { Doc } from "./_generated/dataModel";
import {
  buildDaySensitiveWritePayload,
  needsDaySensitiveMigration,
  readDaySensitiveFields,
  type DaySensitiveRecord,
  withDaySensitiveFields,
} from "./sensitiveDataFields";

function normalizeStringArray(items: string[] | undefined): string[] {
  if (!items || items.length === 0) {
    return [];
  }

  return items.map((item) => item.trim()).filter(Boolean);
}

function mergeUnique(base: string[], additions: string[]): string[] {
  if (additions.length === 0) {
    return base;
  }

  const seen = new Set(base.map((item) => item.trim()));
  const merged = [...base];

  for (const item of additions) {
    if (seen.has(item)) {
      continue;
    }

    seen.add(item);
    merged.push(item);
  }

  return merged;
}

type DayRecord = Doc<"days"> & DaySensitiveRecord;

async function mapDayForResponse<T extends DayRecord | null>(day: T) {
  if (!day) {
    return day;
  }

  return await withDaySensitiveFields(day);
}

// ── Get or create a day record ──────────────────────────────
export const upsertDay = mutation({
  args: {
    dayKey: v.string(),
    rating: v.optional(v.number()),
    manualNotes: v.optional(v.array(v.string())),
    peopleTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    validateDayKey(args.dayKey);
    if (args.rating !== undefined) validateRating(args.rating);

    const existing = await ctx.db
      .query("days")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .unique();

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (args.rating !== undefined) updates.rating = args.rating;

      const shouldEncryptSensitiveFields =
        args.manualNotes !== undefined ||
        args.peopleTags !== undefined ||
        needsDaySensitiveMigration(existing as DayRecord);

      if (shouldEncryptSensitiveFields) {
        const currentSensitive = await readDaySensitiveFields(
          existing as DayRecord,
        );

        const encryptedPayload = await buildDaySensitiveWritePayload({
          userId: user._id,
          manualNotes:
            args.manualNotes !== undefined
              ? args.manualNotes
              : currentSensitive.manualNotes,
          peopleTags:
            args.peopleTags !== undefined
              ? args.peopleTags
              : currentSensitive.peopleTags,
          sensitiveDataNonce: existing.sensitiveDataNonce,
        });

        Object.assign(updates, encryptedPayload);
      }

      await ctx.db.patch(existing._id, updates);
      return await mapDayForResponse(
        (await ctx.db.get(existing._id)) as DayRecord,
      );
    }

    const encryptedPayload = await buildDaySensitiveWritePayload({
      userId: user._id,
      manualNotes: args.manualNotes,
      peopleTags: args.peopleTags,
    });

    const id = await ctx.db.insert("days", {
      userId: user._id,
      dayKey: args.dayKey,
      rating: args.rating,
      ...encryptedPayload,
    });

    await applyDashboardMetricsDelta(ctx.db, {
      totalDays: 1,
    });

    return await mapDayForResponse((await ctx.db.get(id)) as DayRecord);
  },
});

// ── Append day log entries without destructive overwrites ───────────
export const appendDayLogEntries = mutation({
  args: {
    dayKey: v.string(),
    rating: v.optional(v.number()),
    manualNotesToAdd: v.optional(v.array(v.string())),
    peopleTagsToAdd: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    validateDayKey(args.dayKey);
    if (args.rating !== undefined) validateRating(args.rating);

    const manualNotesToAdd = normalizeStringArray(args.manualNotesToAdd);
    const peopleTagsToAdd = normalizeStringArray(args.peopleTagsToAdd);

    const existing = await ctx.db
      .query("days")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .unique();

    if (existing) {
      const currentSensitive = await readDaySensitiveFields(
        existing as DayRecord,
      );
      const nextManualNotes = mergeUnique(
        currentSensitive.manualNotes,
        manualNotesToAdd,
      );
      const nextPeopleTags = mergeUnique(
        currentSensitive.peopleTags,
        peopleTagsToAdd,
      );

      const updates: Record<string, unknown> = {};
      if (args.rating !== undefined) {
        updates.rating = args.rating;
      }

      // Sensitive day fields are applied through encrypted payload only.

      const shouldEncryptSensitiveFields =
        manualNotesToAdd.length > 0 ||
        peopleTagsToAdd.length > 0 ||
        needsDaySensitiveMigration(existing as DayRecord);

      if (shouldEncryptSensitiveFields) {
        const encryptedPayload = await buildDaySensitiveWritePayload({
          userId: user._id,
          manualNotes: nextManualNotes,
          peopleTags: nextPeopleTags,
          sensitiveDataNonce: existing.sensitiveDataNonce,
        });

        Object.assign(updates, encryptedPayload);
      }

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existing._id, updates);
      }

      return await mapDayForResponse(
        (await ctx.db.get(existing._id)) as DayRecord,
      );
    }

    const encryptedPayload = await buildDaySensitiveWritePayload({
      userId: user._id,
      manualNotes: manualNotesToAdd.length > 0 ? manualNotesToAdd : undefined,
      peopleTags: peopleTagsToAdd.length > 0 ? peopleTagsToAdd : undefined,
    });

    const id = await ctx.db.insert("days", {
      userId: user._id,
      dayKey: args.dayKey,
      rating: args.rating,
      ...encryptedPayload,
    });

    await applyDashboardMetricsDelta(ctx.db, {
      totalDays: 1,
    });

    return await mapDayForResponse((await ctx.db.get(id)) as DayRecord);
  },
});

// ── Get a single day record ─────────────────────────────────
export const getDay = query({
  args: {
    dayKey: v.string(),
    refreshToken: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const day = await ctx.db
      .query("days")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .unique();

    return await mapDayForResponse(day as DayRecord | null);
  },
});

// ── Get a day by its document ID ────────────────────────────
export const getDayById = query({
  args: { dayId: v.id("days") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const day = await ctx.db.get(args.dayId);

    if (!day) {
      throw new Error("Day not found");
    }

    requireOwnership(user, day.userId);
    return await mapDayForResponse(day as DayRecord);
  },
});

// ── List recent days (up to N) ──────────────────────────────
export const listRecentDays = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const limit = clampLimit(args.limit ?? 30);

    const days = await ctx.db
      .query("days")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    return await Promise.all(
      days.map(async (day) => mapDayForResponse(day as DayRecord)),
    );
  },
});

// ── Update day rating ───────────────────────────────────────
export const updateDayRating = mutation({
  args: {
    dayKey: v.string(),
    rating: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    validateDayKey(args.dayKey);
    validateRating(args.rating);

    const day = await ctx.db
      .query("days")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .unique();

    if (!day) {
      const encryptedPayload = await buildDaySensitiveWritePayload({
        userId: user._id,
        manualNotes: undefined,
        peopleTags: undefined,
      });

      const id = await ctx.db.insert("days", {
        userId: user._id,
        dayKey: args.dayKey,
        rating: args.rating,
        ...encryptedPayload,
      });

      await applyDashboardMetricsDelta(ctx.db, {
        totalDays: 1,
      });

      return await mapDayForResponse((await ctx.db.get(id)) as DayRecord);
    }

    const updates: Record<string, unknown> = {
      rating: args.rating,
    };

    if (needsDaySensitiveMigration(day as DayRecord)) {
      const currentSensitive = await readDaySensitiveFields(day as DayRecord);
      const encryptedPayload = await buildDaySensitiveWritePayload({
        userId: user._id,
        manualNotes: currentSensitive.manualNotes,
        peopleTags: currentSensitive.peopleTags,
        sensitiveDataNonce: day.sensitiveDataNonce,
      });
      Object.assign(updates, encryptedPayload);
    }

    await ctx.db.patch(day._id, updates);
    return await mapDayForResponse((await ctx.db.get(day._id)) as DayRecord);
  },
});

// ── Delete a day record ─────────────────────────────────────
export const deleteDay = mutation({
  args: { dayId: v.id("days") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const startedAt = Date.now();

    logInfo("deletion.day.started", {
      status: "started",
      userId: user._id,
      dayId: args.dayId,
    });

    try {
      const day = await ctx.db.get(args.dayId);

      if (!day) {
        throw new Error("Day not found");
      }

      requireOwnership(user, day.userId);

      const deleted = await deleteDayCascadeData(ctx, {
        userId: day.userId,
        dayKey: day.dayKey,
      });

      await ctx.db.delete(args.dayId);

      await applyDashboardMetricsDelta(ctx.db, {
        totalDays: -1,
        totalMemories: -deleted.deletedMemories,
        totalSummaries: -deleted.deletedSummaries,
      });

      logInfo("deletion.day.succeeded", {
        status: "succeeded",
        userId: user._id,
        dayId: args.dayId,
        dayKey: day.dayKey,
        deletedMemories: deleted.deletedMemories,
        deletedSummaries: deleted.deletedSummaries,
        deletedIntegrationDailyData: deleted.deletedIntegrationDailyData,
        durationMs: Date.now() - startedAt,
      });

      return { success: true };
    } catch (error) {
      captureException("deletion.day.failed", error, {
        status: "failed",
        userId: user._id,
        dayId: args.dayId,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  },
});
