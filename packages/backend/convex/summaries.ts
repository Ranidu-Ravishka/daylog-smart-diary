import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser, requireOwnership } from "./authz";
import { validateDayKey, clampLimit } from "./validators";
import { getSummaryDailyGenerationLimit } from "./runtimeConfig";

export function getUtcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

// ── Get summary for a specific day ──────────────────────────
export const getSummaryByDay = query({
  args: { dayKey: v.string() },
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
  args: { limit: v.optional(v.number()) },
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

    const existing = await ctx.db
      .query("daySummaries")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        story: args.story,
        highlights: args.highlights,
        metrics: args.metrics,
        sourcesUsed: args.sourcesUsed,
        generatedAt: now,
      });

      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("daySummaries", {
      userId: user._id,
      dayKey: args.dayKey,
      story: args.story,
      highlights: args.highlights,
      metrics: args.metrics,
      sourcesUsed: args.sourcesUsed,
      generatedAt: now,
    });

    return await ctx.db.get(id);
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
    return { success: true };
  },
});

// ── Get current authenticated user's generation quota usage for today (UTC) ──
export const getSummaryQuotaForDay = query({
  args: {},
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
    const quotaDayKey = getUtcDayKey(now);
    const limit = getSummaryDailyGenerationLimit();

    const existing = await ctx.db
      .query("summaryGenerationQuotas")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("quotaDayKey", quotaDayKey),
      )
      .unique();

    const used = existing?.used ?? 0;
    if (used >= limit) {
      throw new Error(
        `Daily summary limit reached (${limit}/day). Please try again tomorrow.`,
      );
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        used: used + 1,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("summaryGenerationQuotas", {
        userId: user._id,
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
  },
});

export const exportMyDiaryData = query({
  args: {
    includeLocationSignals: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const includeLocationSignals = args.includeLocationSignals ?? false;

    const summaries = await ctx.db
      .query("daySummaries")
      .withIndex("by_user_generatedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user_happenedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    const days = await ctx.db
      .query("days")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    const integrations = await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    const integrationDailyData = integrations
      .filter((item) => includeLocationSignals || item.provider !== "location")
      .map((item) => ({
        provider: item.provider,
        dayKey: item.dayKey,
        syncedAt: item.syncedAt,
        summary: item.summary,
        metrics: item.metrics,
        signals:
          item.provider === "location" && !includeLocationSignals
            ? []
            : (item.signals ?? []),
      }));

    return {
      exportedAt: Date.now(),
      summaries: summaries.map((summary) => ({
        dayKey: summary.dayKey,
        story: summary.story,
        highlights: summary.highlights,
        metrics: summary.metrics,
        sourcesUsed: summary.sourcesUsed,
        generatedAt: summary.generatedAt,
      })),
      memories: memories.map((memory) => ({
        dayKey: memory.dayKey,
        title: memory.title,
        description: memory.description,
        mood: memory.mood,
        happenedAt: memory.happenedAt,
      })),
      days: days.map((day) => ({
        dayKey: day.dayKey,
        rating: day.rating,
        manualNotes: day.manualNotes ?? [],
        peopleTags: day.peopleTags ?? [],
      })),
      integrationDailyData,
    };
  },
});
