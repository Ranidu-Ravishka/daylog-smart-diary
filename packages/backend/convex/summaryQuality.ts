import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { getActiveUserById, requireAdmin } from "./authz";
import { internal } from "./_generated/api";
import { getSummaryLowQualityThreshold } from "./runtimeConfig";
import { validateDayKey } from "./validators";

type SummaryQualityScores = {
  overall: number;
  length: number;
  coherence: number;
  duplication: number;
  failure: number;
};

type SummaryQualityEvaluation = {
  scores: SummaryQualityScores;
  wordCount: number;
  duplicateLineRatio: number;
  flags: string[];
  lowQuality: boolean;
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function scoreLength(wordCount: number): number {
  const idealMin = 45;
  const idealMax = 140;

  if (wordCount >= idealMin && wordCount <= idealMax) return 1;
  if (wordCount < idealMin) {
    return clamp01(wordCount / idealMin);
  }

  const over = wordCount - idealMax;
  return clamp01(1 - over / idealMax);
}

function scoreCoherence(story: string, highlights: string[]): number {
  const sentences = story
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const sentenceCount = sentences.length;
  const sentenceLengths = sentences
    .map((sentence) => toWords(sentence).length)
    .filter((length) => length > 0);

  const avgSentenceLength =
    sentenceLengths.length > 0
      ? sentenceLengths.reduce((sum, value) => sum + value, 0) /
        sentenceLengths.length
      : 0;

  const sentenceShapeScore =
    sentenceCount >= 2 && avgSentenceLength >= 7 && avgSentenceLength <= 28
      ? 1
      : clamp01(sentenceCount / 2) * clamp01(avgSentenceLength / 14);

  const highlightDiversity =
    highlights.length > 0
      ? new Set(
          highlights.map((item) => item.trim().toLowerCase()).filter(Boolean),
        ).size / highlights.length
      : 0.7;

  return clamp01(sentenceShapeScore * 0.7 + highlightDiversity * 0.3);
}

function scoreDuplication(
  story: string,
  highlights: string[],
): {
  score: number;
  duplicateLineRatio: number;
} {
  const storySegments = story
    .split(/[.!?\n]+/)
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);

  const normalizedHighlights = highlights
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const combined = [...storySegments, ...normalizedHighlights];
  if (combined.length === 0) {
    return {
      score: 0,
      duplicateLineRatio: 1,
    };
  }

  const uniqueCount = new Set(combined).size;
  const duplicateLineRatio = clamp01(1 - uniqueCount / combined.length);

  return {
    score: clamp01(1 - duplicateLineRatio),
    duplicateLineRatio,
  };
}

function scoreFailureRate(args: {
  failureReason?: string;
  story: string;
  wordCount: number;
}): number {
  if (args.failureReason) return 1;

  const normalizedStory = args.story.toLowerCase();
  const fallbackFragments = [
    "meaningful day",
    "worth reflecting on",
    "summary generation failed",
  ];

  if (
    fallbackFragments.some((fragment) => normalizedStory.includes(fragment))
  ) {
    return 0.8;
  }

  if (args.wordCount < 20) {
    return 0.7;
  }

  return 0;
}

function buildFlags(args: {
  wordCount: number;
  duplicateLineRatio: number;
  failureRate: number;
  overall: number;
}): string[] {
  const flags: string[] = [];

  if (args.wordCount < 25) {
    flags.push("too_short");
  }

  if (args.wordCount > 170) {
    flags.push("too_long");
  }

  if (args.duplicateLineRatio >= 0.35) {
    flags.push("high_duplication");
  }

  if (args.failureRate >= 0.5) {
    flags.push("failure_risk");
  }

  if (args.overall < getSummaryLowQualityThreshold()) {
    flags.push("low_quality");
  }

  return flags;
}

export function evaluateSummaryQuality(args: {
  story: string;
  highlights: string[];
  sourcesUsed: string[];
  failureReason?: string;
}): SummaryQualityEvaluation {
  const wordCount = toWords(args.story).length;

  const lengthScore = scoreLength(wordCount);
  const coherenceScore = scoreCoherence(args.story, args.highlights);
  const { score: duplicationScore, duplicateLineRatio } = scoreDuplication(
    args.story,
    args.highlights,
  );

  const failureRate = scoreFailureRate({
    failureReason: args.failureReason,
    story: args.story,
    wordCount,
  });

  const overall = clamp01(
    lengthScore * 0.25 +
      coherenceScore * 0.35 +
      duplicationScore * 0.25 +
      (1 - failureRate) * 0.15,
  );

  const flags = buildFlags({
    wordCount,
    duplicateLineRatio,
    failureRate,
    overall,
  });

  const lowQuality = overall < getSummaryLowQualityThreshold();

  return {
    scores: {
      overall,
      length: lengthScore,
      coherence: coherenceScore,
      duplication: duplicationScore,
      failure: failureRate,
    },
    wordCount,
    duplicateLineRatio,
    flags,
    lowQuality,
  };
}

function toFailureReason(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return "generation_failed";
}

export const recordSummaryGenerationEvaluationInternal = internalMutation({
  args: {
    userId: v.id("user"),
    dayKey: v.string(),
    modelProvider: v.string(),
    modelName: v.string(),
    modelInput: v.string(),
    success: v.boolean(),
    generatedStory: v.optional(v.string()),
    generatedHighlights: v.optional(v.array(v.string())),
    sourcesUsed: v.optional(v.array(v.string())),
    failureReason: v.optional(v.string()),
    summaryId: v.optional(v.id("daySummaries")),
    attemptChainId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateDayKey(args.dayKey);
    if (!(await getActiveUserById(ctx, args.userId))) {
      throw new Error("Cannot record a summary for an inactive user");
    }

    const now = Date.now();
    const failureReason = toFailureReason(args.failureReason);

    const generationEventId = await ctx.db.insert("summaryGenerationEvents", {
      userId: args.userId,
      dayKey: args.dayKey,
      modelProvider: args.modelProvider,
      modelName: args.modelName,
      modelInputBytes: new TextEncoder().encode(args.modelInput).length,
      success: args.success,
      failureReason: args.success ? undefined : "generation_failed",
      summaryId: args.summaryId,
      attemptChainId: args.attemptChainId,
      createdAt: now,
    });

    if (!args.success || !args.generatedStory) {
      await ctx.db.insert("platformAuditEvents", {
        category: "summary_quality",
        action: "summary_generation_failed",
        actorType: "user",
        actorUserId: args.userId,
        target: args.dayKey,
        details: "generation_failed",
        at: now,
      });

      return {
        generationEventId,
        evaluated: false,
      };
    }

    const evaluation = evaluateSummaryQuality({
      story: args.generatedStory,
      highlights: args.generatedHighlights ?? [],
      sourcesUsed: args.sourcesUsed ?? [],
      failureReason,
    });

    const evaluationId = await ctx.db.insert("summaryQualityEvaluations", {
      userId: args.userId,
      dayKey: args.dayKey,
      generationEventId,
      summaryId: args.summaryId,
      scores: evaluation.scores,
      wordCount: evaluation.wordCount,
      duplicateLineRatio: evaluation.duplicateLineRatio,
      flags: evaluation.flags,
      lowQuality: evaluation.lowQuality,
      evaluatedAt: now,
    });

    if (evaluation.lowQuality) {
      await ctx.db.insert("platformAuditEvents", {
        category: "summary_quality",
        action: "summary_low_quality_detected",
        actorType: "user",
        actorUserId: args.userId,
        target: args.dayKey,
        details: JSON.stringify({
          evaluationId,
          score: evaluation.scores.overall,
          flags: evaluation.flags,
        }).slice(0, 1000),
        at: now,
      });
    }

    return {
      generationEventId,
      evaluationId,
      evaluated: true,
      lowQuality: evaluation.lowQuality,
      overallScore: evaluation.scores.overall,
      flags: evaluation.flags,
    };
  },
});

export const listSummaryQualityEvaluationsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    onlyLowQuality: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    if (args.onlyLowQuality) {
      return await ctx.db
        .query("summaryQualityEvaluations")
        .withIndex("by_lowQuality_evaluatedAt", (q) => q.eq("lowQuality", true))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return await ctx.db
      .query("summaryQualityEvaluations")
      .withIndex("by_evaluatedAt")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const listSummaryGenerationEventsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    onlyFailures: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    if (args.onlyFailures) {
      return await ctx.db
        .query("summaryGenerationEvents")
        .withIndex("by_success_createdAt", (q) => q.eq("success", false))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return await ctx.db
      .query("summaryGenerationEvents")
      .withIndex("by_createdAt")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const listSummaryAttemptsByChainForAdmin = query({
  args: {
    attemptChainId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const chainId = args.attemptChainId.trim();
    if (!chainId) {
      throw new Error("attemptChainId is required");
    }

    const attempts = await ctx.db
      .query("aiSummaryAttempts")
      .withIndex("by_attemptChainId_attemptNumber", (q) =>
        q.eq("attemptChainId", chainId),
      )
      .order("asc")
      .collect();

    // Keep legacy output and prompt-derived hashes out of admin list surfaces.
    return attempts.map((attempt) => ({
      ...attempt,
      outputSummary: undefined,
      inputHash: undefined,
    }));
  },
});

export const recordSummaryAttemptInternal = internalMutation({
  args: {
    userId: v.id("user"),
    dayKey: v.string(),
    attemptChainId: v.string(),
    generationEventId: v.id("summaryGenerationEvents"),
    attemptNumber: v.number(),
    strategy: v.union(
      v.literal("default"),
      v.literal("concise"),
      v.literal("factual_bias"),
      v.literal("source_grounded"),
      v.literal("structured_output"),
    ),
    outputSummary: v.optional(v.string()),
    qualityScore: v.optional(v.number()),
    evaluationFlags: v.array(v.string()),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateDayKey(args.dayKey);
    if (!(await getActiveUserById(ctx, args.userId))) {
      throw new Error("Cannot record a summary attempt for an inactive user");
    }

    return await ctx.db.insert("aiSummaryAttempts", {
      userId: args.userId,
      dayKey: args.dayKey,
      attemptChainId: args.attemptChainId.trim(),
      generationEventId: args.generationEventId,
      attemptNumber: Math.max(1, Math.floor(args.attemptNumber)),
      strategy: args.strategy,
      // Do not persist raw generated text in attempt telemetry records.
      outputSummary: undefined,
      qualityScore: args.qualityScore,
      evaluationFlags: args.evaluationFlags.slice(0, 16),
      failureReason: toFailureReason(args.failureReason),
      createdAt: Date.now(),
    });
  },
});

export const markSummaryGenerationBestAttemptInternal = internalMutation({
  args: {
    generationEventId: v.id("summaryGenerationEvents"),
    selectedBestAttemptId: v.id("aiSummaryAttempts"),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.generationEventId);
    if (!event) {
      throw new Error("Summary generation event not found");
    }
    if (!(await getActiveUserById(ctx, event.userId))) {
      throw new Error("Cannot update a summary for an inactive user");
    }
    const attempt = await ctx.db.get(args.selectedBestAttemptId);
    if (!attempt) {
      throw new Error("Selected summary attempt not found");
    }
    if (attempt.generationEventId !== event._id) {
      throw new Error("Selected attempt does not belong to generation event");
    }
    if (
      event.attemptChainId &&
      attempt.attemptChainId !== event.attemptChainId
    ) {
      throw new Error("Selected attempt chain mismatch");
    }

    await ctx.db.patch(event._id, {
      selectedBestAttemptId: args.selectedBestAttemptId,
    });

    return {
      success: true,
    };
  },
});

export const backfillSummaryQualityEvaluations = mutation({
  args: {
    maxItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const maxItems =
      typeof args.maxItems === "number" && Number.isFinite(args.maxItems)
        ? Math.max(1, Math.min(500, Math.floor(args.maxItems)))
        : 100;

    const events = await ctx.db
      .query("summaryGenerationEvents")
      .withIndex("by_createdAt")
      .order("desc")
      .take(maxItems * 3);

    let evaluatedCount = 0;
    let skippedCount = 0;

    for (const event of events) {
      if (!event.success || !event.generatedStory) {
        skippedCount += 1;
        continue;
      }

      const existingEvaluation = await ctx.db
        .query("summaryQualityEvaluations")
        .withIndex("by_generationEventId", (q) =>
          q.eq("generationEventId", event._id as Id<"summaryGenerationEvents">),
        )
        .unique();

      if (existingEvaluation) {
        skippedCount += 1;
        continue;
      }

      const evaluation = evaluateSummaryQuality({
        story: event.generatedStory,
        highlights: event.generatedHighlights ?? [],
        sourcesUsed: event.sourcesUsed ?? [],
        failureReason: event.failureReason,
      });

      await ctx.db.insert("summaryQualityEvaluations", {
        userId: event.userId,
        dayKey: event.dayKey,
        generationEventId: event._id,
        summaryId: event.summaryId,
        scores: evaluation.scores,
        wordCount: evaluation.wordCount,
        duplicateLineRatio: evaluation.duplicateLineRatio,
        flags: evaluation.flags,
        lowQuality: evaluation.lowQuality,
        evaluatedAt: Date.now(),
      });

      evaluatedCount += 1;
      if (evaluatedCount >= maxItems) break;
    }

    return {
      evaluatedCount,
      skippedCount,
      scanned: events.length,
    };
  },
});

export const redactLegacySummaryGenerationEventContentInternal =
  internalMutation({
    args: {
      cursor: v.optional(v.string()),
      batchSize: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
      const batchSize = Math.max(1, Math.min(500, args.batchSize ?? 100));
      const completed = await ctx.db
        .query("platformAuditEvents")
        .withIndex("by_category_action_at", (q) =>
          q
            .eq("category", "summary_quality")
            .eq("action", "legacy_event_content_redaction_completed"),
        )
        .take(1);
      if (completed.length > 0) {
        return { redacted: 0, scanned: 0, done: true };
      }

      const page = await ctx.db
        .query("summaryGenerationEvents")
        .withIndex("by_createdAt")
        .order("asc")
        .paginate({
          numItems: batchSize,
          cursor: args.cursor ?? null,
        });

      let redacted = 0;
      for (const event of page.page) {
        if (
          event.modelInput !== undefined ||
          event.generatedStory !== undefined ||
          event.generatedHighlights !== undefined ||
          event.sourcesUsed !== undefined ||
          event.failureReason !== undefined
        ) {
          await ctx.db.patch(event._id, {
            modelInput: undefined,
            generatedStory: undefined,
            generatedHighlights: undefined,
            sourcesUsed: undefined,
            failureReason: event.success ? undefined : "generation_failed",
            privacyRedactedAt: Date.now(),
          });
          redacted += 1;
        }
      }

      if (page.isDone) {
        await ctx.db.insert("platformAuditEvents", {
          category: "summary_quality",
          action: "legacy_event_content_redaction_completed",
          actorType: "system",
          target: "summaryGenerationEvents",
          details: "Legacy prompt/output content redaction completed",
          at: Date.now(),
        });
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.summaryQuality.redactLegacySummaryGenerationEventContentInternal,
          {
            cursor: page.continueCursor,
            batchSize,
          },
        );
      }

      return {
        redacted,
        scanned: page.page.length,
        done: page.isDone,
      };
    },
  });

export const removeLegacyAiSummaryAttemptInputHashesInternal =
  internalMutation({
    args: {
      cursor: v.optional(v.string()),
      batchSize: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
      const batchSize = Math.max(1, Math.min(500, args.batchSize ?? 100));
      const completed = await ctx.db
        .query("platformAuditEvents")
        .withIndex("by_category_action_at", (q) =>
          q
            .eq("category", "summary_quality")
            .eq("action", "legacy_ai_attempt_input_hash_cleanup_completed"),
        )
        .take(1);
      if (completed.length > 0) {
        return { removed: 0, scanned: 0, done: true };
      }

      const page = await ctx.db
        .query("aiSummaryAttempts")
        .withIndex("by_createdAt")
        .order("asc")
        .paginate({
          numItems: batchSize,
          cursor: args.cursor ?? null,
        });

      let removed = 0;
      for (const attempt of page.page) {
        if (attempt.inputHash !== undefined) {
          await ctx.db.patch(attempt._id, { inputHash: undefined });
          removed += 1;
        }
      }

      if (page.isDone) {
        await ctx.db.insert("platformAuditEvents", {
          category: "summary_quality",
          action: "legacy_ai_attempt_input_hash_cleanup_completed",
          actorType: "system",
          target: "aiSummaryAttempts",
          details: "Legacy inputHash cleanup completed",
          at: Date.now(),
        });
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.summaryQuality.removeLegacyAiSummaryAttemptInputHashesInternal,
          {
            cursor: page.continueCursor,
            batchSize,
          },
        );
      }

      return {
        removed,
        scanned: page.page.length,
        done: page.isDone,
      };
    },
  });
