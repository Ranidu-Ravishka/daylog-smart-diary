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
import { getActiveUserById, requireUser } from "./authz";
import { validateDayKey } from "./validators";
import { logInfo, logWarn } from "./observability";
import { callOpenAiChatJsonWithUsage } from "./providerAdapters";
import { convexServerEnv } from "./env";

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
const recordAiUsageInternalRef = makeFunctionReference<"mutation">(
  "aiUsage:recordAiUsageInternal",
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

// In-memory TTL cache for insight narratives. The same underlying metrics
// yield the same narrative, so if a user re-opens the Insights tab within
// a few minutes, we short-circuit and avoid repeat LLM spend. Cache is
// process-local (acceptable: repeat requests within a single process get
// the benefit; cross-process is still cheap because the input hash changes
// only when data changes).
const INSIGHT_NARRATIVE_CACHE_TTL_MS = 5 * 60_000;
const INSIGHT_NARRATIVE_CACHE_MAX_ENTRIES = 512;
type InsightNarrativeCacheEntry = {
  inputHash: string;
  expiresAtMs: number;
  value: unknown;
};
const insightNarrativeCache = new Map<string, InsightNarrativeCacheEntry>();

function insightNarrativeCacheKey(
  userId: Id<"user">,
  windowDays: number,
): string {
  return `${userId}:${windowDays}`;
}

function hashInsightNarrativeInput(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function evictExpiredInsightNarrativeCache(nowMs: number): void {
  if (insightNarrativeCache.size < INSIGHT_NARRATIVE_CACHE_MAX_ENTRIES) return;
  for (const [key, entry] of insightNarrativeCache) {
    if (entry.expiresAtMs <= nowMs) insightNarrativeCache.delete(key);
  }
  // Hard cap on cache size to bound memory under abuse / pathological traffic.
  while (insightNarrativeCache.size >= INSIGHT_NARRATIVE_CACHE_MAX_ENTRIES) {
    const oldestKey = insightNarrativeCache.keys().next().value;
    if (oldestKey === undefined) break;
    insightNarrativeCache.delete(oldestKey);
  }
}

export function __resetInsightNarrativeCacheForTests(): void {
  insightNarrativeCache.clear();
}

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
    if (!(await getActiveUserById(ctx, args.userId))) {
      throw new Error("Cannot store insights for an inactive user");
    }

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
    if (!(await getActiveUserById(ctx, args.userId))) {
      throw new Error("Cannot store recommendations for an inactive user");
    }

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

export const listMyDailyFeatureVectorsByDayKeys = query({
  args: {
    dayKeys: v.array(v.string()),
    vectorVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const uniqueDayKeys = Array.from(new Set(args.dayKeys)).slice(
      0,
      MAX_WINDOW_DAYS,
    );

    if (uniqueDayKeys.length === 0) {
      return [] as Array<{
        dayKey: string;
        features: DailyFeatureVector;
      }>;
    }

    const existingRows = await Promise.all(
      uniqueDayKeys.map(async (dayKey) =>
        ctx.db
          .query("dailyFeatureVectors")
          .withIndex("by_user_day", (q) =>
            q.eq("userId", user._id).eq("dayKey", dayKey),
          )
          .unique(),
      ),
    );

    return existingRows.flatMap((row) => {
      if (
        row === null ||
        row.vectorVersion !== args.vectorVersion ||
        row.features === undefined
      ) {
        return [];
      }

      return [
        {
          dayKey: row.dayKey,
          features: row.features as DailyFeatureVector,
        },
      ];
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

async function resolveVectorsForDayKeys(args: {
  ctx: ActionCtx;
  dayKeys: string[];
}): Promise<{
  vectorsByDayKey: Map<string, DailyFeatureVector>;
  recomputedDayKeys: string[];
}> {
  const uniqueDayKeys = Array.from(new Set(args.dayKeys)).slice(
    0,
    MAX_WINDOW_DAYS,
  );
  if (uniqueDayKeys.length === 0) {
    return {
      vectorsByDayKey: new Map<string, DailyFeatureVector>(),
      recomputedDayKeys: [],
    };
  }

  const existingVectors = (await args.ctx.runQuery(
    api.personalInsights.listMyDailyFeatureVectorsByDayKeys,
    {
      dayKeys: uniqueDayKeys,
      vectorVersion: FEATURE_VECTOR_VERSION,
    },
  )) as Array<{ dayKey: string; features: DailyFeatureVector }>;

  const vectorsByDayKey = new Map<string, DailyFeatureVector>();
  for (const row of existingVectors) {
    vectorsByDayKey.set(row.dayKey, row.features);
  }

  const missingDayKeys = uniqueDayKeys.filter(
    (dayKey) => !vectorsByDayKey.has(dayKey),
  );

  if (missingDayKeys.length === 0) {
    return {
      vectorsByDayKey,
      recomputedDayKeys: [],
    };
  }

  const recomputedVectors = await Promise.all(
    missingDayKeys.map(async (dayKey) =>
      buildDailyFeatureVector({
        ctx: args.ctx,
        dayKey,
      }),
    ),
  );

  missingDayKeys.forEach((dayKey, index) => {
    const vector = recomputedVectors[index];
    if (vector) {
      vectorsByDayKey.set(dayKey, vector);
    }
  });

  return {
    vectorsByDayKey,
    recomputedDayKeys: missingDayKeys,
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

    const recentDays = (await ctx.runQuery(api.days.listRecentDays, {
      limit: windowDays,
    })) as Array<{ dayKey: string }>;

    const orderedDayKeys = Array.from(
      new Set([args.dayKey, ...recentDays.map((day) => day.dayKey)]),
    ).slice(0, windowDays);
    const { vectorsByDayKey } = await resolveVectorsForDayKeys({
      ctx,
      dayKeys: orderedDayKeys,
    });
    const currentVector = vectorsByDayKey.get(args.dayKey);
    if (!currentVector) {
      throw new Error("Failed to compute feature vector for requested day.");
    }

    const historicalVectors = orderedDayKeys
      .filter((dayKey) => dayKey !== args.dayKey)
      .map((dayKey) => vectorsByDayKey.get(dayKey))
      .filter((vector): vector is DailyFeatureVector => vector !== undefined);

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
    const { vectorsByDayKey, recomputedDayKeys } =
      await resolveVectorsForDayKeys({
        ctx,
        dayKeys: recentDayKeys,
      });
    const vectors = recentDayKeys
      .map((dayKey) => vectorsByDayKey.get(dayKey))
      .filter((vector): vector is DailyFeatureVector => vector !== undefined);

    if (vectors.length === 0) {
      throw new Error(
        "No recent feature vectors available for recommendation.",
      );
    }

    await Promise.all(
      recomputedDayKeys.map(async (dayKey) => {
        const vector = vectorsByDayKey.get(dayKey);
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

const INSIGHT_NARRATIVE_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "insight_narrative",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        narrative: { type: "string" },
        highlights: {
          type: "array",
          items: { type: "string" },
          maxItems: 4,
        },
        anomalies: {
          type: "array",
          items: { type: "string" },
          maxItems: 4,
        },
        recommendedFocus: {
          type: "array",
          items: { type: "string" },
          maxItems: 3,
        },
      },
      required: ["narrative", "highlights", "anomalies", "recommendedFocus"],
    },
  },
} as const;

type InsightNarrativeResult = {
  generatedAt: number;
  windowDays: number;
  sourceDays: number;
  narrative: string;
  highlights: string[];
  anomalies: string[];
  recommendedFocus: string[];
  trend: TrendVector;
  features: DailyFeatureVector;
};

function resolveInsightNarrativeKeys(): {
  primaryKey: string;
  candidateKeys: string[];
  baseUrl?: string;
} {
  if (convexServerEnv.aiGatewayApiKey && convexServerEnv.aiGatewayBaseUrl) {
    return {
      primaryKey: convexServerEnv.aiGatewayApiKey,
      candidateKeys: [convexServerEnv.aiGatewayApiKey],
      baseUrl: convexServerEnv.aiGatewayBaseUrl,
    };
  }
  const rotation = convexServerEnv.openAiApiKeyRotation ?? [];
  const candidateKeys =
    rotation.length > 0
      ? [convexServerEnv.openAiApiKey, ...rotation]
      : [convexServerEnv.openAiApiKey];
  return {
    primaryKey: convexServerEnv.openAiApiKey,
    candidateKeys,
    baseUrl: convexServerEnv.aiGatewayBaseUrl,
  };
}

function summarizeFeatureVector(vector: DailyFeatureVector): string {
  const parts: string[] = [];
  if (typeof vector.rating === "number") {
    parts.push(`rating ${vector.rating.toFixed(1)}`);
  }
  parts.push(
    `${vector.memoryCount} memories`,
    `${vector.highlightCount} highlights`,
  );
  if (typeof vector.steps === "number") {
    parts.push(`${Math.round(vector.steps)} steps`);
  }
  if (typeof vector.sleepMinutes === "number") {
    parts.push(`${Math.round(vector.sleepMinutes)} sleep min`);
  }
  if (typeof vector.screenTimeMinutes === "number") {
    parts.push(`${Math.round(vector.screenTimeMinutes)} screen min`);
  }
  if (typeof vector.spendingTotal === "number") {
    parts.push(`spend ${vector.spendingTotal.toFixed(2)}`);
  }
  if (typeof vector.meetingsCount === "number" && vector.meetingsCount > 0) {
    parts.push(`${vector.meetingsCount} meetings`);
  }
  if (typeof vector.busyMinutes === "number" && vector.busyMinutes > 0) {
    parts.push(`${Math.round(vector.busyMinutes)} busy min`);
  }
  if (typeof vector.callsCount === "number" && vector.callsCount > 0) {
    parts.push(`${vector.callsCount} calls`);
  }
  return parts.join(", ");
}

export const generateInsightNarrative = action({
  args: {
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<InsightNarrativeResult> => {
    const user = (await ctx.runQuery(getSummaryGenerationIdentityRef, {})) as {
      userId: Id<"user">;
    };
    const windowDays = clampWindowDays(args.windowDays);

    const recentDays = (await ctx.runQuery(api.days.listRecentDays, {
      limit: windowDays,
    })) as Array<{ dayKey: string }>;

    if (recentDays.length === 0) {
      throw new Error(
        "No recent day data available to generate an insight narrative.",
      );
    }

    const recentDayKeys = recentDays.map((d) => d.dayKey).slice(0, windowDays);
    const { vectorsByDayKey } = await resolveVectorsForDayKeys({
      ctx,
      dayKeys: recentDayKeys,
    });
    const vectors = recentDayKeys
      .map((dayKey) => vectorsByDayKey.get(dayKey))
      .filter((vector): vector is DailyFeatureVector => vector !== undefined);

    if (vectors.length === 0) {
      throw new Error(
        "No feature vectors available to generate an insight narrative.",
      );
    }

    const latestVector = vectors[0];
    if (!latestVector) {
      throw new Error(
        "Latest feature vector is missing for the narrative window.",
      );
    }
    const trend = computeTrendVectors(vectors.slice().reverse());

    const recentSnapshots = recentDayKeys
      .map((dayKey, index) => {
        const vector = vectors[index];
        if (!vector) return null;
        return `${dayKey}: ${summarizeFeatureVector(vector)}`;
      })
      .filter((line): line is string => line !== null);

    const modelInput = JSON.stringify({
      windowDays: recentDayKeys.length,
      trend,
      latestVector,
      recentSnapshots,
    });

    const cacheKey = insightNarrativeCacheKey(
      user.userId,
      recentDayKeys.length,
    );
    const inputHash = hashInsightNarrativeInput(modelInput);
    const nowMs = Date.now();
    const cached = insightNarrativeCache.get(cacheKey);
    if (
      cached &&
      cached.inputHash === inputHash &&
      cached.expiresAtMs > nowMs
    ) {
      logInfo("personal_insight.narrative_cache_hit", {
        userId: user.userId,
        windowDays: recentDayKeys.length,
        ageMs: INSIGHT_NARRATIVE_CACHE_TTL_MS - (cached.expiresAtMs - nowMs),
      });
      const safeCached = (cached.value ?? {}) as {
        narrative?: unknown;
        highlights?: unknown;
        anomalies?: unknown;
        recommendedFocus?: unknown;
      };
      const coerceStringArrayCached = (
        input: unknown,
        max: number,
      ): string[] => {
        if (!Array.isArray(input)) return [];
        return input
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, max);
      };
      return {
        generatedAt: nowMs,
        windowDays: recentDayKeys.length,
        sourceDays: vectors.length,
        narrative:
          typeof safeCached.narrative === "string" &&
          safeCached.narrative.trim().length > 0
            ? safeCached.narrative.trim()
            : "Your recent days look steady — keep tracking to surface more signal.",
        highlights: coerceStringArrayCached(safeCached.highlights, 4),
        anomalies: coerceStringArrayCached(safeCached.anomalies, 4),
        recommendedFocus: coerceStringArrayCached(
          safeCached.recommendedFocus,
          3,
        ),
        trend,
        features: latestVector,
      };
    }

    const { primaryKey, candidateKeys, baseUrl } =
      resolveInsightNarrativeKeys();

    let parsed: unknown;
    let usage: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    } | undefined;
    try {
      const response = await callOpenAiChatJsonWithUsage<unknown>({
        apiKey: primaryKey,
        apiKeys: candidateKeys,
        baseUrl,
        operation: "insight_narrative",
        model: "gpt-4o",
        maxOutputTokens: 300,
        temperature: 0.25,
        responseFormat: INSIGHT_NARRATIVE_RESPONSE_FORMAT,
        emptyContentMessage: "Insight narrative output was empty.",
        invalidJsonMessage: "Insight narrative output was not valid JSON.",
        messages: [
          {
            role: "system",
            content:
              "You are an analyst that reviews multi-day behaviour metrics and writes a short, factual insight narrative. " +
              "Only reference trends and values present in the JSON input. Do not invent data. " +
              "Keep the narrative under 90 words. Highlights and anomalies must be short phrases.",
          },
          {
            role: "user",
            content: `Analyse these aggregated daily metrics and return the structured JSON. Input:\n${modelInput}`,
          },
        ],
      });
      parsed = response.data;
      usage = response.usage;
    } catch (error) {
      logWarn("personal_insight.narrative_generation_failed", {
        userId: user.userId,
        windowDays: recentDayKeys.length,
        errorMessage: error instanceof Error ? error.message : "unknown error",
      });
      throw error instanceof Error
        ? error
        : new Error("Insight narrative generation failed.");
    }

    const safe = (parsed ?? {}) as {
      narrative?: unknown;
      highlights?: unknown;
      anomalies?: unknown;
      recommendedFocus?: unknown;
    };

    const coerceStringArray = (input: unknown, max: number): string[] => {
      if (!Array.isArray(input)) return [];
      return input
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, max);
    };

    const result: InsightNarrativeResult = {
      generatedAt: Date.now(),
      windowDays: recentDayKeys.length,
      sourceDays: vectors.length,
      narrative:
        typeof safe.narrative === "string" && safe.narrative.trim().length > 0
          ? safe.narrative.trim()
          : "Your recent days look steady — keep tracking to surface more signal.",
      highlights: coerceStringArray(safe.highlights, 4),
      anomalies: coerceStringArray(safe.anomalies, 4),
      recommendedFocus: coerceStringArray(safe.recommendedFocus, 3),
      trend,
      features: latestVector,
    };

    const promptTokens =
      usage?.promptTokens ?? Math.max(1, Math.ceil(modelInput.length / 4));
    const completionTokens =
      usage?.completionTokens ??
      Math.max(1, Math.ceil(result.narrative.length / 4));
    await ctx.runMutation(recordAiUsageInternalRef, {
      userId: user.userId,
      operation: "personal_insight",
      model: "gpt-4o",
      status: "succeeded",
      promptTokens,
      completionTokens,
      totalTokens: usage?.totalTokens ?? promptTokens + completionTokens,
      usageSource: usage ? "provider" : "estimated",
    });

    evictExpiredInsightNarrativeCache(nowMs);
    insightNarrativeCache.set(cacheKey, {
      inputHash,
      expiresAtMs: nowMs + INSIGHT_NARRATIVE_CACHE_TTL_MS,
      value: parsed,
    });

    logInfo("personal_insight.narrative_generated", {
      userId: user.userId,
      windowDays: recentDayKeys.length,
      sourceDays: vectors.length,
      hasAnomalies: result.anomalies.length > 0,
    });

    return result;
  },
});
