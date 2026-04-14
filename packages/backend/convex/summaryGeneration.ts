import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { makeFunctionReference } from "convex/server";
import { validateDayKey } from "./validators";
import { convexServerEnv } from "./env";
import { resolveSummaryModelAdapter } from "./providerAdapters";
import { captureException, logInfo, logWarn } from "./observability";

const getMyResolvedFeatureFlagsRef = makeFunctionReference<"query">(
  "featureFlags:getMyResolvedFeatureFlags",
);

export class OpenAiRequestError extends Error {
  status: number;
  retryable: boolean;

  constructor(status: number, message: string, retryable: boolean) {
    super(message);
    this.name = "OpenAiRequestError";
    this.status = status;
    this.retryable = retryable;
  }
}

export function isRetryableOpenAiStatus(status: number): boolean {
  if (status === 429) return true;
  return status >= 500;
}

export function isRetryableOpenAiError(error: unknown): boolean {
  if (error instanceof OpenAiRequestError) return error.retryable;
  if (error instanceof TypeError) return true;
  return false;
}

function clampHighlights(highlights: unknown): string[] {
  if (!Array.isArray(highlights)) return [];
  return highlights
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

export function normalizeModelOutput(payload: unknown) {
  const obj = (payload ?? {}) as Record<string, unknown>;
  const storyValue = obj.story;
  const story =
    typeof storyValue === "string" && storyValue.trim().length > 0
      ? storyValue.trim()
      : "You had a meaningful day with several moments worth reflecting on.";

  const highlights = clampHighlights(obj.highlights);

  const rawMetrics = (obj.metrics ?? {}) as Record<string, unknown>;
  const metrics = {
    steps: toFiniteNumber(rawMetrics.steps),
    sleepMinutes: toFiniteNumber(rawMetrics.sleepMinutes),
    screenTimeMinutes: toFiniteNumber(rawMetrics.screenTimeMinutes),
    spendingTotal: toFiniteNumber(rawMetrics.spendingTotal),
  };

  const hasMetrics = Object.values(metrics).some(
    (metric) => metric !== undefined,
  );
  const rawSources = Array.isArray(obj.sourcesUsed)
    ? (obj.sourcesUsed as unknown[])
    : [];
  const sourcesUsed = rawSources
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);

  return {
    story,
    highlights,
    metrics: hasMetrics ? metrics : undefined,
    sourcesUsed:
      sourcesUsed.length > 0
        ? sourcesUsed
        : ["Memories", "Day metadata", "OpenAI GPT-4o"],
  };
}

type IntegrationDailyData = {
  provider: string;
  metrics?: {
    steps?: number;
    sleepMinutes?: number;
    screenTimeMinutes?: number;
    spendingTotal?: number;
  };
  summary?: string;
  signals?: string[];
  context?: {
    schemaVersion?: number;
    location?: {
      mode: "foreground" | "background_controlled";
      totalTrackedMinutes?: number;
      totalDistanceMeters?: number;
      stayPoints?: Array<{
        label: string;
        startedAt: number;
        endedAt: number;
        durationMinutes: number;
      }>;
    };
    fitness?: {
      steps?: number;
      distanceMeters?: number;
      activeMinutes?: number;
      idleMinutes?: number;
      source?: string;
    };
    calendar?: {
      meetingsCount?: number;
      busyMinutes?: number;
      remindersCount?: number;
      eventTitles?: string[];
    };
    activitySummary?: {
      callsCount?: number;
      callDurationMinutes?: number;
      mood?: string;
      moodConfidence?: number;
      activityLevel?: "active" | "mixed" | "idle";
    };
  };
  syncedAt: number;
};

function toSourceLabel(provider: string): string {
  const labels: Record<string, string> = {
    google_calendar: "Google Calendar",
    google_fit: "Google Fit",
    spotify: "Spotify",
    apple_health: "Apple Health",
    location: "Location (foreground)",
    fitness: "Fitness",
    calendar: "Calendar",
    activity_summary: "Activity Summary",
  };

  return labels[provider] ?? provider;
}

function buildIntegrationContextForModel(entries: IntegrationDailyData[]) {
  const stepsValues = entries
    .map((entry) => entry.metrics?.steps)
    .filter((value): value is number => typeof value === "number");
  const sleepValues = entries
    .map((entry) => entry.metrics?.sleepMinutes)
    .filter((value): value is number => typeof value === "number");
  const screenValues = entries
    .map((entry) => entry.metrics?.screenTimeMinutes)
    .filter((value): value is number => typeof value === "number");
  const spendingValues = entries
    .map((entry) => entry.metrics?.spendingTotal)
    .filter((value): value is number => typeof value === "number");

  const flattenedSignals = entries
    .flatMap((entry) => entry.signals ?? [])
    .map((signal) => signal.trim())
    .filter(Boolean);

  const contextSignals = entries
    .flatMap((entry) => {
      const next: string[] = [];
      const context = entry.context;
      if (!context) return next;

      const topStays = (context.location?.stayPoints ?? [])
        .sort((a, b) => b.durationMinutes - a.durationMinutes)
        .slice(0, 2)
        .map((stay) => `${stay.durationMinutes}m at ${stay.label}`);

      if (topStays.length > 0) {
        next.push(`Location stays: ${topStays.join(", ")}`);
      }

      if (context.fitness?.distanceMeters) {
        next.push(
          `${Math.round(context.fitness.distanceMeters)} meters walked`,
        );
      }

      if (context.fitness?.activeMinutes) {
        next.push(`${context.fitness.activeMinutes} active minutes`);
      }

      if (context.calendar?.meetingsCount) {
        next.push(`${context.calendar.meetingsCount} meetings attended`);
      }

      if (context.activitySummary?.callsCount) {
        next.push(
          `${context.activitySummary.callsCount} calls, ${context.activitySummary.callDurationMinutes ?? 0} call minutes`,
        );
      }

      if (context.activitySummary?.mood) {
        next.push(`Mood signal: ${context.activitySummary.mood}`);
      }

      return next;
    })
    .map((signal) => signal.trim())
    .filter(Boolean);

  const uniqueSignals = Array.from(
    new Set([...flattenedSignals, ...contextSignals]),
  ).slice(0, 16);

  const mergedMetrics = {
    steps: stepsValues.length > 0 ? Math.max(...stepsValues) : undefined,
    sleepMinutes: sleepValues.length > 0 ? Math.max(...sleepValues) : undefined,
    screenTimeMinutes:
      screenValues.length > 0 ? Math.max(...screenValues) : undefined,
    spendingTotal:
      spendingValues.length > 0
        ? Math.round(
            spendingValues.reduce((sum, value) => sum + value, 0) * 100,
          ) / 100
        : undefined,
  };

  const hasMergedMetrics = Object.values(mergedMetrics).some(
    (value) => value !== undefined,
  );

  return {
    providers: entries.map((entry) => entry.provider),
    providerSummaries: entries
      .map((entry) => ({
        provider: entry.provider,
        summary: entry.summary,
        syncedAt: entry.syncedAt,
      }))
      .filter((entry) => Boolean(entry.summary))
      .slice(0, 8),
    keySignals: uniqueSignals,
    mergedMetrics: hasMergedMetrics ? mergedMetrics : undefined,
    sources: entries.map((entry) => toSourceLabel(entry.provider)),
    contextSnapshots: entries
      .map((entry) => ({
        provider: entry.provider,
        context: entry.context,
      }))
      .filter((entry) => Boolean(entry.context))
      .slice(0, 8),
  };
}

type SummaryGenerationResult =
  | {
      success: true;
      summaryId?: string;
      generatedAt?: number;
    }
  | {
      success: false;
      errorCode: "no_input_data" | "model_generation_failed";
      message: string;
    };

function toUserFacingSummaryGenerationErrorMessage(error: unknown): string {
  const fallback =
    "Summary generation is temporarily unavailable. Please try again later.";

  if (!(error instanceof Error) || !error.message.trim()) {
    return fallback;
  }

  const message = error.message.trim();

  if (/OpenAI authentication failed \((401|403)\)/i.test(message)) {
    return fallback;
  }

  if (/OpenAI rate limit reached \(429\)/i.test(message)) {
    return "Summary generation is busy right now. Please try again shortly.";
  }

  if (/OpenAI service is temporarily unavailable \(\d+\)/i.test(message)) {
    return "Summary generation is temporarily unavailable. Please try again shortly.";
  }

  return message;
}

export async function generateSummaryWithOpenAi(
  dayKey: string,
  modelInput: string,
) {
  const openAiKey = convexServerEnv.openAiApiKey;
  const adapter = resolveSummaryModelAdapter("openai");

  try {
    return await adapter.execute({
      dayKey,
      modelInput,
      apiKey: openAiKey,
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message);
    }

    throw new Error(
      "Summary generation failed after retries. Please try again in a moment.",
    );
  }
}

// Internal-only action for backend workflows (cron/jobs) to call later.
export const generateSummaryFromModel = internalAction({
  args: {
    dayKey: v.string(),
    modelInput: v.string(),
  },
  handler: async (_ctx, args) => {
    void _ctx;
    return await generateSummaryWithOpenAi(args.dayKey, args.modelInput);
  },
});

// Public action called by dashboard button.
export const generateSummaryForDay = action({
  args: {
    dayKey: v.string(),
  },
  handler: async (ctx, args): Promise<SummaryGenerationResult> => {
    const startedAt = Date.now();
    validateDayKey(args.dayKey);

    const runtimeFlags = (await ctx.runQuery(
      getMyResolvedFeatureFlagsRef,
      {},
    )) as {
      flags?: {
        aiSummaryEnabled?: boolean;
      };
    };

    if (!runtimeFlags.flags?.aiSummaryEnabled) {
      return {
        success: false,
        errorCode: "model_generation_failed",
        message:
          "AI summaries are temporarily unavailable. Please try again later.",
      };
    }

    logInfo("summary_generation.started", {
      dayKey: args.dayKey,
    });

    const memories = await ctx.runQuery(api.memories.listMemoriesByDay, {
      dayKey: args.dayKey,
    });
    const day = await ctx.runQuery(api.days.getDay, {
      dayKey: args.dayKey,
    });
    const integrationData = (await ctx.runQuery(
      api.integrations.listMyIntegrationDailyDataForDay,
      {
        dayKey: args.dayKey,
      },
    )) as IntegrationDailyData[];

    const hasDayMetadata =
      day?.rating !== undefined ||
      (day?.manualNotes?.length ?? 0) > 0 ||
      (day?.peopleTags?.length ?? 0) > 0;
    const hasIntegrationData = (integrationData?.length ?? 0) > 0;

    if (
      (memories?.length ?? 0) === 0 &&
      !hasDayMetadata &&
      !hasIntegrationData
    ) {
      return {
        success: false,
        errorCode: "no_input_data",
        message:
          "Add at least one memory, day note/rating/tag, or synced integration data before generating a summary.",
      };
    }

    const integrationContext = buildIntegrationContextForModel(
      integrationData ?? [],
    );

    const generationIdentity = (await ctx.runQuery(
      (api as any).summaries.getSummaryGenerationIdentity,
      {},
    )) as {
      userId: string;
    };

    await ctx.runMutation(
      (api as any).summaries.reserveSummaryGenerationSlot,
      {},
    );

    const modelInput = JSON.stringify({
      dayKey: args.dayKey,
      memories: (memories ?? [])
        .slice(0, 50)
        .map(
          (memory: {
            title: string;
            description?: string;
            mood?: string;
            happenedAt: number;
          }) => ({
            title: memory.title,
            description: memory.description,
            mood: memory.mood,
            happenedAt: memory.happenedAt,
          }),
        ),
      dayMetadata: {
        rating: day?.rating,
        manualNotes: day?.manualNotes ?? [],
        peopleTags: day?.peopleTags ?? [],
      },
      integrations: {
        providers: integrationContext.providers,
        keySignals: integrationContext.keySignals,
        providerSummaries: integrationContext.providerSummaries,
        metrics: integrationContext.mergedMetrics,
        contextSnapshots: integrationContext.contextSnapshots,
      },
    });

    let generated:
      | {
          story: string;
          highlights: string[];
          metrics?: {
            steps?: number;
            sleepMinutes?: number;
            screenTimeMinutes?: number;
            spendingTotal?: number;
          };
          sourcesUsed: string[];
        }
      | undefined;

    try {
      generated = await generateSummaryWithOpenAi(args.dayKey, modelInput);
    } catch (error) {
      captureException("summary_generation.failed", error, {
        dayKey: args.dayKey,
        userId: generationIdentity.userId,
      });

      try {
        await ctx.runMutation(
          (internal as any).summaryQuality
            .recordSummaryGenerationEvaluationInternal,
          {
            userId: generationIdentity.userId,
            dayKey: args.dayKey,
            modelProvider: "openai",
            modelName: "gpt-4o",
            modelInput,
            success: false,
            failureReason:
              error instanceof Error
                ? error.message
                : "Summary generation failed",
          },
        );
      } catch (qualityLoggingError) {
        logWarn("summary_generation.quality_logging_failed", {
          dayKey: args.dayKey,
          reason: "failure_logging",
          error:
            qualityLoggingError instanceof Error
              ? qualityLoggingError.message
              : "unknown",
        });
      }

      return {
        success: false,
        errorCode: "model_generation_failed",
        message: toUserFacingSummaryGenerationErrorMessage(error),
      };
    }

    const mergedMetrics = {
      steps:
        generated.metrics?.steps ?? integrationContext.mergedMetrics?.steps,
      sleepMinutes:
        generated.metrics?.sleepMinutes ??
        integrationContext.mergedMetrics?.sleepMinutes,
      screenTimeMinutes:
        generated.metrics?.screenTimeMinutes ??
        integrationContext.mergedMetrics?.screenTimeMinutes,
      spendingTotal:
        generated.metrics?.spendingTotal ??
        integrationContext.mergedMetrics?.spendingTotal,
    };

    const hasMergedMetrics = Object.values(mergedMetrics).some(
      (value) => value !== undefined,
    );
    const mergedSourcesUsed = Array.from(
      new Set([
        ...generated.sourcesUsed,
        ...(integrationContext.sources.length > 0 ? ["Integrations"] : []),
        ...integrationContext.sources,
      ]),
    );

    const saved = (await ctx.runMutation((api as any).summaries.upsertSummary, {
      dayKey: args.dayKey,
      story: generated.story,
      highlights: generated.highlights,
      metrics: hasMergedMetrics ? mergedMetrics : undefined,
      sourcesUsed: mergedSourcesUsed,
    })) as { _id?: string; generatedAt?: number } | null;

    try {
      await ctx.runMutation(
        (internal as any).summaryQuality
          .recordSummaryGenerationEvaluationInternal,
        {
          userId: generationIdentity.userId,
          dayKey: args.dayKey,
          modelProvider: "openai",
          modelName: "gpt-4o",
          modelInput,
          success: true,
          generatedStory: generated.story,
          generatedHighlights: generated.highlights,
          sourcesUsed: mergedSourcesUsed,
          summaryId: saved?._id,
        },
      );
    } catch (qualityLoggingError) {
      logWarn("summary_generation.quality_logging_failed", {
        dayKey: args.dayKey,
        reason: "success_logging",
        error:
          qualityLoggingError instanceof Error
            ? qualityLoggingError.message
            : "unknown",
      });
    }

    logInfo("summary_generation.succeeded", {
      dayKey: args.dayKey,
      userId: generationIdentity.userId,
      summaryId: saved?._id,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true,
      summaryId: saved?._id,
      generatedAt: saved?.generatedAt,
    };
  },
});
