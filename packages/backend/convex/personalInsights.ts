import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  action,
  internalMutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./authz";
import { validateDayKey } from "./validators";
import { logInfo } from "./observability";

const getSummaryGenerationIdentityRef = makeFunctionReference<"query">(
  "summaries:getSummaryGenerationIdentity",
);
const getMyUserPreferencesRef = makeFunctionReference<"query">(
  "userPreferences:getMyUserPreferences",
);
const listMemoriesByDayForSummaryGenerationRef = makeFunctionReference<"query">(
  "memories:listMemoriesByDayForSummaryGeneration",
);
const listMyIntegrationDailyDataForSummaryGenerationRef =
  makeFunctionReference<"query">(
    "integrations:listMyIntegrationDailyDataForDayForSummaryGeneration",
  );

type TrendDirection = "up" | "down" | "flat";
type RecommendationType = "stabilize" | "momentum" | "recovery";

type DailyFeatureVector = {
  rating?: number;
  memoryCount: number;
  noteCount: number;
  peopleTagCount: number;
  highlightCount: number;
  steps?: number;
  sleepMinutes?: number;
  screenTimeMinutes?: number;
  spendingTotal?: number;
  meetingsCount?: number;
  busyMinutes?: number;
  callsCount?: number;
  callDurationMinutes?: number;
  integrationProviderCount: number;
};

type TrendVector = {
  ratingTrend: TrendDirection;
  memoryTrend: TrendDirection;
  stepsTrend: TrendDirection;
  sleepTrend: TrendDirection;
  screenTimeTrend: TrendDirection;
  spendingTrend: TrendDirection;
  socialTrend: TrendDirection;
};

const FEATURE_VECTOR_VERSION = 1;
const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 30;

function clampWindowDays(windowDays: number | undefined): number {
  if (typeof windowDays !== "number" || !Number.isFinite(windowDays)) {
    return DEFAULT_WINDOW_DAYS;
  }
  return Math.max(3, Math.min(MAX_WINDOW_DAYS, Math.floor(windowDays)));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function detectTrend(
  values: Array<number | undefined>,
  invert = false,
): TrendDirection {
  const numeric = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (numeric.length < 4) return "flat";

  const midpoint = Math.floor(numeric.length / 2);
  const older = numeric.slice(0, midpoint);
  const recent = numeric.slice(midpoint);
  const olderAvg = average(older);
  const recentAvg = average(recent);
  const delta = recentAvg - olderAvg;
  const threshold = Math.max(0.1, Math.abs(olderAvg) * 0.08);
  if (Math.abs(delta) <= threshold) return "flat";
  if (invert) return delta > 0 ? "down" : "up";
  return delta > 0 ? "up" : "down";
}

function toTomorrowDayKeyFrom(dayKey: string): string {
  const next = new Date(`${dayKey}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function mergeMax(values: Array<number | undefined>): number | undefined {
  const numeric = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (numeric.length === 0) return undefined;
  return Math.max(...numeric);
}

function mergeSum(values: Array<number | undefined>): number | undefined {
  const numeric = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (numeric.length === 0) return undefined;
  return Math.round(numeric.reduce((sum, value) => sum + value, 0) * 100) / 100;
}

function buildRecommendation(args: {
  trend: TrendVector;
  focusAreas: number[];
  latest: DailyFeatureVector;
}): {
  recommendationType: RecommendationType;
  recommendations: string[];
  rationale: string[];
  confidence: number;
} {
  const recommendations: string[] = [];
  const rationale: string[] = [];
  let recommendationType: RecommendationType = "stabilize";

  if (args.trend.ratingTrend === "down" || args.trend.sleepTrend === "down") {
    recommendationType = "recovery";
    recommendations.push(
      "Protect a 90-minute recovery block and avoid high-friction commitments in the first half of the day.",
    );
    rationale.push("Recent wellbeing trend is weakening.");
  }

  if (
    args.trend.memoryTrend === "up" &&
    args.trend.ratingTrend !== "down" &&
    recommendationType !== "recovery"
  ) {
    recommendationType = "momentum";
    recommendations.push(
      "Plan one high-impact focus block early and capture a quick reflection after completion.",
    );
    rationale.push("Execution trend is improving with stable daily quality.");
  }

  if (args.focusAreas.includes(0)) {
    if (args.trend.sleepTrend !== "up") {
      recommendations.push(
        "Target a consistent wind-down time to improve sleep stability.",
      );
      rationale.push(
        "Wellbeing focus selected and sleep trend is not improving.",
      );
    }
    if (args.trend.stepsTrend === "down") {
      recommendations.push(
        "Schedule a 20-30 minute walk between major work blocks.",
      );
      rationale.push("Activity trend is declining.");
    }
  }

  if (args.focusAreas.includes(1) && args.trend.socialTrend !== "up") {
    recommendations.push(
      "Proactively schedule one meaningful social touchpoint tomorrow.",
    );
    rationale.push("Relationship-oriented signals are flat or down.");
  }

  if (args.focusAreas.includes(2) && args.latest.memoryCount < 3) {
    recommendations.push(
      "Capture at least three concrete milestones to reinforce productive momentum.",
    );
    rationale.push("Current journaling output volume is below target.");
  }

  if (args.focusAreas.includes(3) && args.trend.spendingTrend === "up") {
    recommendations.push(
      "Set a spending cap before high-risk purchase windows tomorrow.",
    );
    rationale.push("Spending trend is increasing.");
  }

  if (args.focusAreas.includes(4) && args.latest.noteCount < 2) {
    recommendations.push(
      "Add a 5-minute end-of-day reflection with one gratitude and one lesson.",
    );
    rationale.push("Mindfulness signal is low in recent days.");
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Keep tomorrow simple: one priority, one recovery action, and one reflection checkpoint.",
    );
    rationale.push("No strong negative or positive trend signal dominates.");
  }

  const confidenceBase =
    args.trend.ratingTrend !== "flat" ||
    args.trend.memoryTrend !== "flat" ||
    args.trend.sleepTrend !== "flat"
      ? 0.72
      : 0.58;

  return {
    recommendationType,
    recommendations: recommendations.slice(0, 4),
    rationale: rationale.slice(0, 4),
    confidence: Math.min(
      0.92,
      confidenceBase + Math.min(0.12, args.focusAreas.length * 0.02),
    ),
  };
}

export const upsertDailyFeatureVectorInternal = internalMutation({
  args: {
    userId: v.id("user"),
    dayKey: v.string(),
    vectorVersion: v.number(),
    features: v.object({
      rating: v.optional(v.number()),
      memoryCount: v.number(),
      noteCount: v.number(),
      peopleTagCount: v.number(),
      highlightCount: v.number(),
      steps: v.optional(v.number()),
      sleepMinutes: v.optional(v.number()),
      screenTimeMinutes: v.optional(v.number()),
      spendingTotal: v.optional(v.number()),
      meetingsCount: v.optional(v.number()),
      busyMinutes: v.optional(v.number()),
      callsCount: v.optional(v.number()),
      callDurationMinutes: v.optional(v.number()),
      integrationProviderCount: v.number(),
    }),
    trend: v.optional(
      v.object({
        ratingTrend: v.union(
          v.literal("up"),
          v.literal("down"),
          v.literal("flat"),
        ),
        memoryTrend: v.union(
          v.literal("up"),
          v.literal("down"),
          v.literal("flat"),
        ),
        stepsTrend: v.union(
          v.literal("up"),
          v.literal("down"),
          v.literal("flat"),
        ),
        sleepTrend: v.union(
          v.literal("up"),
          v.literal("down"),
          v.literal("flat"),
        ),
        screenTimeTrend: v.union(
          v.literal("up"),
          v.literal("down"),
          v.literal("flat"),
        ),
        spendingTrend: v.union(
          v.literal("up"),
          v.literal("down"),
          v.literal("flat"),
        ),
        socialTrend: v.union(
          v.literal("up"),
          v.literal("down"),
          v.literal("flat"),
        ),
      }),
    ),
    sourceDays: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"dailyFeatureVectors">> => {
    validateDayKey(args.dayKey);
    const now = Date.now();
    const existing = await ctx.db
      .query("dailyFeatureVectors")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", args.userId).eq("dayKey", args.dayKey),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        vectorVersion: args.vectorVersion,
        features: args.features,
        trend: args.trend,
        sourceDays: args.sourceDays,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("dailyFeatureVectors", {
      userId: args.userId,
      dayKey: args.dayKey,
      vectorVersion: args.vectorVersion,
      features: args.features,
      trend: args.trend,
      sourceDays: args.sourceDays,
      generatedAt: now,
      updatedAt: now,
    });
  },
});

export const upsertNextBestDayRecommendationInternal = internalMutation({
  args: {
    userId: v.id("user"),
    targetDayKey: v.string(),
    basedOnDays: v.number(),
    confidence: v.number(),
    recommendationType: v.union(
      v.literal("stabilize"),
      v.literal("momentum"),
      v.literal("recovery"),
    ),
    recommendations: v.array(v.string()),
    rationale: v.array(v.string()),
    trend: v.object({
      ratingTrend: v.union(
        v.literal("up"),
        v.literal("down"),
        v.literal("flat"),
      ),
      memoryTrend: v.union(
        v.literal("up"),
        v.literal("down"),
        v.literal("flat"),
      ),
      stepsTrend: v.union(
        v.literal("up"),
        v.literal("down"),
        v.literal("flat"),
      ),
      sleepTrend: v.union(
        v.literal("up"),
        v.literal("down"),
        v.literal("flat"),
      ),
      screenTimeTrend: v.union(
        v.literal("up"),
        v.literal("down"),
        v.literal("flat"),
      ),
      spendingTrend: v.union(
        v.literal("up"),
        v.literal("down"),
        v.literal("flat"),
      ),
      socialTrend: v.union(
        v.literal("up"),
        v.literal("down"),
        v.literal("flat"),
      ),
    }),
  },
  handler: async (ctx, args): Promise<Id<"nextBestDayRecommendations">> => {
    validateDayKey(args.targetDayKey);
    const now = Date.now();
    const existing = await ctx.db
      .query("nextBestDayRecommendations")
      .withIndex("by_user_targetDay", (q) =>
        q.eq("userId", args.userId).eq("targetDayKey", args.targetDayKey),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        generatedAt: now,
        basedOnDays: args.basedOnDays,
        confidence: args.confidence,
        recommendationType: args.recommendationType,
        recommendations: args.recommendations.slice(0, 4),
        rationale: args.rationale.slice(0, 4),
        trend: args.trend,
      });
      return existing._id;
    }

    return await ctx.db.insert("nextBestDayRecommendations", {
      userId: args.userId,
      targetDayKey: args.targetDayKey,
      generatedAt: now,
      basedOnDays: args.basedOnDays,
      confidence: args.confidence,
      recommendationType: args.recommendationType,
      recommendations: args.recommendations.slice(0, 4),
      rationale: args.rationale.slice(0, 4),
      trend: args.trend,
    });
  },
});

async function buildDailyFeatureVector(args: {
  ctx: ActionCtx;
  dayKey: string;
}): Promise<DailyFeatureVector> {
  const dayRaw = (await args.ctx.runQuery(api.days.getDay, {
    dayKey: args.dayKey,
  })) as {
    rating?: number;
    manualNotes?: string[];
    peopleTags?: string[];
  } | null;
  const day = dayRaw && typeof dayRaw === "object" ? dayRaw : null;

  const memoriesRaw = (await args.ctx.runQuery(
    listMemoriesByDayForSummaryGenerationRef,
    {
      dayKey: args.dayKey,
      limit: 200,
    },
  )) as unknown;
  const memories = Array.isArray(memoriesRaw) ? memoriesRaw : [];

  const summaryRaw = (await args.ctx.runQuery(api.summaries.getSummaryByDay, {
    dayKey: args.dayKey,
  })) as { highlights?: string[] } | null;
  const summary =
    summaryRaw && typeof summaryRaw === "object" ? summaryRaw : null;

  const integrationsRaw = (await args.ctx.runQuery(
    listMyIntegrationDailyDataForSummaryGenerationRef,
    {
      dayKey: args.dayKey,
      limit: 64,
    },
  )) as unknown;
  const integrations = (
    Array.isArray(integrationsRaw) ? integrationsRaw : []
  ) as Array<{
    provider: string;
    metrics?: {
      steps?: number;
      sleepMinutes?: number;
      screenTimeMinutes?: number;
      spendingTotal?: number;
    };
    context?: {
      calendar?: {
        meetingsCount?: number;
        busyMinutes?: number;
      };
      activitySummary?: {
        callsCount?: number;
        callDurationMinutes?: number;
      };
    };
  }>;

  return {
    rating: day?.rating,
    memoryCount: memories.length,
    noteCount: day?.manualNotes?.length ?? 0,
    peopleTagCount: day?.peopleTags?.length ?? 0,
    highlightCount: summary?.highlights?.length ?? 0,
    steps: mergeMax(integrations.map((entry) => entry.metrics?.steps)),
    sleepMinutes: mergeMax(
      integrations.map((entry) => entry.metrics?.sleepMinutes),
    ),
    screenTimeMinutes: mergeMax(
      integrations.map((entry) => entry.metrics?.screenTimeMinutes),
    ),
    spendingTotal: mergeSum(
      integrations.map((entry) => entry.metrics?.spendingTotal),
    ),
    meetingsCount: mergeSum(
      integrations.map((entry) => entry.context?.calendar?.meetingsCount),
    ),
    busyMinutes: mergeSum(
      integrations.map((entry) => entry.context?.calendar?.busyMinutes),
    ),
    callsCount: mergeSum(
      integrations.map((entry) => entry.context?.activitySummary?.callsCount),
    ),
    callDurationMinutes: mergeSum(
      integrations.map(
        (entry) => entry.context?.activitySummary?.callDurationMinutes,
      ),
    ),
    integrationProviderCount: new Set(
      integrations.map((entry) => entry.provider),
    ).size,
  };
}

function computeTrendVectors(vectors: DailyFeatureVector[]): TrendVector {
  return {
    ratingTrend: detectTrend(vectors.map((vector) => vector.rating)),
    memoryTrend: detectTrend(vectors.map((vector) => vector.memoryCount)),
    stepsTrend: detectTrend(vectors.map((vector) => vector.steps)),
    sleepTrend: detectTrend(vectors.map((vector) => vector.sleepMinutes)),
    screenTimeTrend: detectTrend(
      vectors.map((vector) => vector.screenTimeMinutes),
      true,
    ),
    spendingTrend: detectTrend(
      vectors.map((vector) => vector.spendingTotal),
      true,
    ),
    socialTrend: detectTrend(
      vectors.map(
        (vector) => (vector.callsCount ?? 0) + (vector.meetingsCount ?? 0),
      ),
    ),
  };
}

type RefreshDailyFeatureVectorResult = {
  vectorId: Id<"dailyFeatureVectors">;
  dayKey: string;
  vectorVersion: number;
  features: DailyFeatureVector;
  trend: TrendVector;
  sourceDays: number;
};

export const refreshMyDailyFeatureVector = action({
  args: {
    dayKey: v.string(),
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<RefreshDailyFeatureVectorResult> => {
    validateDayKey(args.dayKey);
    const windowDays = clampWindowDays(args.windowDays);
    const identity = (await ctx.runQuery(
      getSummaryGenerationIdentityRef,
      {},
    )) as {
      userId: Id<"user">;
    };

    const currentVector = await buildDailyFeatureVector({
      ctx,
      dayKey: args.dayKey,
    });

    const recentDays = (await ctx.runQuery(api.days.listRecentDays, {
      limit: windowDays,
    })) as Array<{ dayKey: string }>;

    const historicalDayKeys = recentDays
      .map((day) => day.dayKey)
      .filter((dayKey) => dayKey !== args.dayKey)
      .slice(0, windowDays - 1);

    const historicalVectors = await Promise.all(
      historicalDayKeys.map(
        async (dayKey) =>
          await buildDailyFeatureVector({
            ctx,
            dayKey,
          }),
      ),
    );

    const trend = computeTrendVectors([
      ...historicalVectors.reverse(),
      currentVector,
    ]);

    const vectorId: Id<"dailyFeatureVectors"> = await ctx.runMutation(
      internal.personalInsights.upsertDailyFeatureVectorInternal,
      {
        userId: identity.userId,
        dayKey: args.dayKey,
        vectorVersion: FEATURE_VECTOR_VERSION,
        features: currentVector,
        trend,
        sourceDays: historicalVectors.length + 1,
      },
    );

    logInfo("personal_insight.daily_feature_vector_refreshed", {
      userId: identity.userId,
      dayKey: args.dayKey,
      sourceDays: historicalVectors.length + 1,
    });

    return {
      vectorId,
      dayKey: args.dayKey,
      vectorVersion: FEATURE_VECTOR_VERSION,
      features: currentVector,
      trend,
      sourceDays: historicalVectors.length + 1,
    };
  },
});

type NextBestDayRecommendationResult = {
  recommendationId: Id<"nextBestDayRecommendations">;
  targetDayKey: string;
  basedOnDays: number;
  confidence: number;
  recommendationType: RecommendationType;
  recommendations: string[];
  rationale: string[];
  trend: TrendVector;
  latestVector: DailyFeatureVector;
};

export const getMyNextBestDayRecommendation = action({
  args: {
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<NextBestDayRecommendationResult> => {
    const windowDays = clampWindowDays(args.windowDays);
    const identity = (await ctx.runQuery(
      getSummaryGenerationIdentityRef,
      {},
    )) as {
      userId: Id<"user">;
    };
    const preferences = (await ctx.runQuery(getMyUserPreferencesRef, {})) as {
      focusAreas?: number[];
    } | null;

    const recentDays = (await ctx.runQuery(api.days.listRecentDays, {
      limit: windowDays,
    })) as Array<{ dayKey: string }>;

    if (recentDays.length === 0) {
      throw new Error("No day history available for recommendation.");
    }

    const recentDayKeys = recentDays
      .map((day) => day.dayKey)
      .slice(0, windowDays);
    const vectors = await Promise.all(
      recentDayKeys.map(
        async (dayKey) =>
          await buildDailyFeatureVector({
            ctx,
            dayKey,
          }),
      ),
    );

    await Promise.all(
      recentDayKeys.map(async (dayKey, index) => {
        const vector = vectors[index];
        if (!vector) return;
        await ctx.runMutation(
          internal.personalInsights.upsertDailyFeatureVectorInternal,
          {
            userId: identity.userId,
            dayKey,
            vectorVersion: FEATURE_VECTOR_VERSION,
            features: vector,
            trend: undefined,
            sourceDays: recentDayKeys.length,
          },
        );
      }),
    );

    const trend = computeTrendVectors(vectors.slice().reverse());
    const latestDayKey = recentDayKeys[0];
    const latestVector = vectors[0];
    if (!latestDayKey || !latestVector) {
      // Should be unreachable: we just asserted recentDays.length > 0 above.
      throw new Error(
        "No recent day data available to build a next-best-day recommendation.",
      );
    }
    const targetDayKey = toTomorrowDayKeyFrom(latestDayKey);
    const built = buildRecommendation({
      trend,
      focusAreas: preferences?.focusAreas ?? [],
      latest: latestVector,
    });

    const recommendationId: Id<"nextBestDayRecommendations"> =
      await ctx.runMutation(
        internal.personalInsights.upsertNextBestDayRecommendationInternal,
        {
          userId: identity.userId,
          targetDayKey,
          basedOnDays: recentDayKeys.length,
          confidence: built.confidence,
          recommendationType: built.recommendationType,
          recommendations: built.recommendations,
          rationale: built.rationale,
          trend,
        },
      );

    logInfo("personal_insight.next_best_day_generated", {
      userId: identity.userId,
      targetDayKey,
      basedOnDays: recentDayKeys.length,
      confidence: built.confidence,
      recommendationType: built.recommendationType,
    });

    return {
      recommendationId,
      targetDayKey,
      basedOnDays: recentDayKeys.length,
      confidence: built.confidence,
      recommendationType: built.recommendationType,
      recommendations: built.recommendations,
      rationale: built.rationale,
      trend,
      latestVector,
    };
  },
});

export const getMyDailyFeatureVector = query({
  args: {
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);

    return await ctx.db
      .query("dailyFeatureVectors")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .unique();
  },
});

export const listMyDailyFeatureVectors = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const limit = Math.max(1, Math.min(60, Math.floor(args.limit ?? 14)));

    return await ctx.db
      .query("dailyFeatureVectors")
      .withIndex("by_user_generatedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
  },
});

export const getMyLatestNextBestDayRecommendation = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const latest = await ctx.db
      .query("nextBestDayRecommendations")
      .withIndex("by_user_generatedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(1);
    return latest[0] ?? null;
  },
});
