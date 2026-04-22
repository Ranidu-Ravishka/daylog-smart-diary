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
const listMemoriesByDayForSummaryGenerationRef = makeFunctionReference<"query">(
  "memories:listMemoriesByDayForSummaryGeneration",
);
const listMyIntegrationDailyDataForSummaryGenerationRef =
  makeFunctionReference<"query">(
    "integrations:listMyIntegrationDailyDataForDayForSummaryGeneration",
  );

const SUMMARY_GENERATION_MEMORY_LIMIT = 50;
const SUMMARY_GENERATION_INTEGRATION_LIMIT = 32;
const MAX_SUMMARY_MEMORY_INPUT_BYTES = 64_000;

const textEncoder = new TextEncoder();

type SummaryMemoryInput = {
  title: string;
  description?: string;
  mood?: string;
  happenedAt: number;
};

function toSummaryMemoryInput(
  memories: SummaryMemoryInput[],
  maxBytes: number,
): SummaryMemoryInput[] {
  const next: SummaryMemoryInput[] = [];
  let bytesUsed = 2; // []

  for (const memory of memories) {
    const normalizedMemory: SummaryMemoryInput = {
      title: memory.title,
      description: memory.description,
      mood: memory.mood,
      happenedAt: memory.happenedAt,
    };

    const serialized = JSON.stringify(normalizedMemory);
    const serializedBytes = textEncoder.encode(serialized).length;
    const additionalCommaBytes = next.length > 0 ? 1 : 0;

    if (bytesUsed + additionalCommaBytes + serializedBytes > maxBytes) {
      if (next.length === 0) {
        const compactMemory: SummaryMemoryInput = {
          title: memory.title,
          mood: memory.mood,
          happenedAt: memory.happenedAt,
        };
        const compactSerializedBytes = textEncoder.encode(
          JSON.stringify(compactMemory),
        ).length;

        if (bytesUsed + compactSerializedBytes <= maxBytes) {
          next.push(compactMemory);
        }
      }

      break;
    }

    next.push(normalizedMemory);
    bytesUsed += additionalCommaBytes + serializedBytes;
  }

  return next;
}

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
    gmail_summary: "Gmail Summary",
    spotify: "Spotify",
    apple_health: "Apple Health",
    apple_calendar: "Apple Calendar",
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

type SummaryRemediationStrategy =
  | "default"
  | "concise"
  | "factual_bias"
  | "source_grounded"
  | "structured_output";

type SummaryAttemptOutcome = {
  attemptId?: string;
  generationEventId?: string;
  attemptNumber: number;
  strategy: SummaryRemediationStrategy;
  modelInput: string;
  qualityScore: number;
  evaluationFlags: string[];
  lowQuality: boolean;
  generated?: {
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
  failed: boolean;
  failureReason?: string;
};

const AUTOPILOT_MAX_RETRIES = 2;
const AUTOPILOT_BASE_BACKOFF_MS = 250;

const PROMPT_STRATEGY_GUIDANCE: Record<SummaryRemediationStrategy, string> = {
  default:
    "Balanced baseline summary. Stay accurate and concise with clear language.",
  concise:
    "Prefer concise output: 60-90 words total, 2-4 sharp highlights, no filler.",
  factual_bias:
    "Bias toward explicit facts and measurable details. Avoid interpretation when uncertain.",
  source_grounded:
    "Ground every claim in provided memories/day metadata/integration context only.",
  structured_output:
    "Use clear structure: opening sentence, evidence-backed body, and practical close.",
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAttemptChainId(
  userId: string,
  dayKey: string,
  now: number,
): string {
  const random = Math.floor(Math.random() * 1_000_000)
    .toString(16)
    .padStart(5, "0");
  return `${userId}:${dayKey}:${now}:${random}`;
}

function hashInput(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}`;
}

export function shouldRetrySummary(evaluation: {
  lowQuality?: boolean;
  overallScore?: number;
  flags?: string[];
  attemptNumber: number;
}): boolean {
  if (evaluation.attemptNumber > AUTOPILOT_MAX_RETRIES) {
    return false;
  }

  if (evaluation.lowQuality) {
    return true;
  }

  const score = evaluation.overallScore ?? 1;
  if (score < 0.6) {
    return true;
  }

  const retryableFlags = new Set([
    "too_long",
    "too_short",
    "high_duplication",
    "failure_risk",
    "low_quality",
    "too_vague",
    "hallucination_risk",
  ]);
  return (evaluation.flags ?? []).some((flag) => retryableFlags.has(flag));
}

function chooseNextStrategy(flags: string[]): SummaryRemediationStrategy {
  if (flags.includes("too_long")) return "concise";
  if (flags.includes("failure_risk")) return "factual_bias";
  if (flags.includes("high_duplication")) return "structured_output";
  if (flags.includes("low_quality")) return "source_grounded";
  return "default";
}

function buildModelInputWithStrategy(
  baseModelInput: string,
  strategy: SummaryRemediationStrategy,
): string {
  const base = JSON.parse(baseModelInput) as Record<string, unknown>;
  const strategyGuidance = PROMPT_STRATEGY_GUIDANCE[strategy];
  return JSON.stringify({
    ...base,
    autopilot: {
      strategy,
      strategyGuidance,
    },
  });
}

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
  strategy: SummaryRemediationStrategy = "default",
) {
  const openAiKey = convexServerEnv.openAiApiKey;
  const adapter = resolveSummaryModelAdapter("openai");

  try {
    return await adapter.execute({
      dayKey,
      modelInput,
      apiKey: openAiKey,
      strategyGuidance: PROMPT_STRATEGY_GUIDANCE[strategy],
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
    strategy: v.optional(
      v.union(
        v.literal("default"),
        v.literal("concise"),
        v.literal("factual_bias"),
        v.literal("source_grounded"),
        v.literal("structured_output"),
      ),
    ),
  },
  handler: async (_ctx, args) => {
    void _ctx;
    return await generateSummaryWithOpenAi(
      args.dayKey,
      args.modelInput,
      args.strategy ?? "default",
    );
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
        aiSummaryAutopilotEnabled?: boolean;
      };
    };

    if (!runtimeFlags.flags?.aiSummaryEnabled) {
      logWarn("summary_generation.skipped_disabled", {
        status: "skipped",
        dayKey: args.dayKey,
      });

      return {
        success: false,
        errorCode: "model_generation_failed",
        message:
          "AI summaries are temporarily unavailable. Please try again later.",
      };
    }

    logInfo("summary_generation.started", {
      status: "started",
      dayKey: args.dayKey,
    });

    const memories = (await ctx.runQuery(
      listMemoriesByDayForSummaryGenerationRef,
      {
        dayKey: args.dayKey,
        limit: SUMMARY_GENERATION_MEMORY_LIMIT,
      },
    )) as SummaryMemoryInput[];
    const day = await ctx.runQuery(api.days.getDay, {
      dayKey: args.dayKey,
    });
    const integrationData = (await ctx.runQuery(
      listMyIntegrationDailyDataForSummaryGenerationRef,
      {
        dayKey: args.dayKey,
        limit: SUMMARY_GENERATION_INTEGRATION_LIMIT,
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
      logWarn("summary_generation.skipped_no_input", {
        status: "skipped",
        dayKey: args.dayKey,
      });

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

    const summaryMemoryInput = toSummaryMemoryInput(
      memories ?? [],
      MAX_SUMMARY_MEMORY_INPUT_BYTES,
    );

    if ((memories?.length ?? 0) > summaryMemoryInput.length) {
      logWarn("summary_generation.memory_input_truncated", {
        status: "degraded",
        dayKey: args.dayKey,
        fetchedMemoryCount: memories.length,
        includedMemoryCount: summaryMemoryInput.length,
        maxMemoryInputBytes: MAX_SUMMARY_MEMORY_INPUT_BYTES,
      });
    }

    const modelInput = JSON.stringify({
      dayKey: args.dayKey,
      memories: summaryMemoryInput,
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

    const attemptChainId = buildAttemptChainId(
      generationIdentity.userId,
      args.dayKey,
      startedAt,
    );
    const autopilotEnabled = Boolean(
      runtimeFlags.flags?.aiSummaryAutopilotEnabled,
    );
    const maxAttempts = autopilotEnabled ? AUTOPILOT_MAX_RETRIES + 1 : 1;
    const attempts: SummaryAttemptOutcome[] = [];
    let nextStrategy: SummaryRemediationStrategy = "default";
    let latestError: unknown;

    for (
      let attemptNumber = 1;
      attemptNumber <= maxAttempts;
      attemptNumber += 1
    ) {
      const strategy = attemptNumber === 1 ? "default" : nextStrategy;
      const attemptModelInput =
        strategy === "default"
          ? modelInput
          : buildModelInputWithStrategy(modelInput, strategy);

      logInfo("summary_generation.attempt_started", {
        event: "attempt_started",
        dayKey: args.dayKey,
        userId: generationIdentity.userId,
        attemptChainId,
        attemptNumber,
        strategy,
      });

      try {
        await ctx.runMutation(
          (api as any).summaries.reserveSummaryGenerationSlot,
          {},
        );
      } catch (quotaError) {
        logWarn("summary_generation.retry_blocked_quota", {
          event: "retry_triggered",
          dayKey: args.dayKey,
          userId: generationIdentity.userId,
          attemptChainId,
          attemptNumber,
          strategy,
          reason: "quota_exceeded",
        });
        latestError = quotaError;
        break;
      }

      try {
        const generated = await generateSummaryWithOpenAi(
          args.dayKey,
          attemptModelInput,
          strategy,
        );
        const mergedSourcesUsed = Array.from(
          new Set([
            ...generated.sourcesUsed,
            ...(integrationContext.sources.length > 0 ? ["Integrations"] : []),
            ...integrationContext.sources,
          ]),
        );

        const qualityResult = await ctx.runMutation(
          (internal as any).summaryQuality
            .recordSummaryGenerationEvaluationInternal,
          {
            userId: generationIdentity.userId,
            dayKey: args.dayKey,
            modelProvider: "openai",
            modelName: "gpt-4o",
            modelInput: attemptModelInput,
            success: true,
            generatedStory: generated.story,
            generatedHighlights: generated.highlights,
            sourcesUsed: mergedSourcesUsed,
            attemptChainId,
          },
        );

        const attemptId = await ctx.runMutation(
          (internal as any).summaryQuality.recordSummaryAttemptInternal,
          {
            userId: generationIdentity.userId,
            dayKey: args.dayKey,
            attemptChainId,
            generationEventId: qualityResult.generationEventId,
            attemptNumber,
            strategy,
            inputHash: hashInput(attemptModelInput),
            qualityScore: qualityResult.overallScore ?? 0,
            evaluationFlags: qualityResult.flags ?? [],
          },
        );

        const attemptOutcome: SummaryAttemptOutcome = {
          attemptId,
          generationEventId: qualityResult.generationEventId,
          attemptNumber,
          strategy,
          modelInput: attemptModelInput,
          qualityScore: qualityResult.overallScore ?? 0,
          evaluationFlags: qualityResult.flags ?? [],
          lowQuality: Boolean(qualityResult.lowQuality),
          generated,
          failed: false,
        };
        attempts.push(attemptOutcome);

        logInfo("summary_generation.attempt_completed", {
          event: "attempt_completed",
          dayKey: args.dayKey,
          userId: generationIdentity.userId,
          attemptChainId,
          attemptNumber,
          strategy,
          qualityScore: attemptOutcome.qualityScore,
          lowQuality: attemptOutcome.lowQuality,
        });

        const shouldRetry = autopilotEnabled
          ? shouldRetrySummary({
              lowQuality: attemptOutcome.lowQuality,
              overallScore: attemptOutcome.qualityScore,
              flags: attemptOutcome.evaluationFlags,
              attemptNumber,
            })
          : false;

        if (!shouldRetry) {
          break;
        }

        nextStrategy = chooseNextStrategy(attemptOutcome.evaluationFlags);
        logWarn("summary_generation.retry_triggered", {
          event: "retry_triggered",
          dayKey: args.dayKey,
          userId: generationIdentity.userId,
          attemptChainId,
          attemptNumber,
          strategy,
          nextStrategy,
          qualityScore: attemptOutcome.qualityScore,
        });
        await wait(AUTOPILOT_BASE_BACKOFF_MS * 2 ** (attemptNumber - 1));
      } catch (error) {
        latestError = error;
        captureException("summary_generation.failed", error, {
          status: "failed",
          dayKey: args.dayKey,
          userId: generationIdentity.userId,
          attemptChainId,
          attemptNumber,
          strategy,
          durationMs: Date.now() - startedAt,
        });

        const failureReason =
          error instanceof Error ? error.message : "Summary generation failed";
        try {
          const qualityFailure = await ctx.runMutation(
            (internal as any).summaryQuality
              .recordSummaryGenerationEvaluationInternal,
            {
              userId: generationIdentity.userId,
              dayKey: args.dayKey,
              modelProvider: "openai",
              modelName: "gpt-4o",
              modelInput: attemptModelInput,
              success: false,
              failureReason,
              attemptChainId,
            },
          );

          const attemptId = await ctx.runMutation(
            (internal as any).summaryQuality.recordSummaryAttemptInternal,
            {
              userId: generationIdentity.userId,
              dayKey: args.dayKey,
              attemptChainId,
              generationEventId: qualityFailure.generationEventId,
              attemptNumber,
              strategy,
              inputHash: hashInput(attemptModelInput),
              evaluationFlags: ["generation_failed"],
              failureReason,
            },
          );

          attempts.push({
            attemptId,
            generationEventId: qualityFailure.generationEventId,
            attemptNumber,
            strategy,
            modelInput: attemptModelInput,
            qualityScore: 0,
            evaluationFlags: ["generation_failed"],
            lowQuality: true,
            failed: true,
            failureReason,
          });
        } catch (qualityLoggingError) {
          logWarn("summary_generation.quality_logging_failed", {
            status: "degraded",
            dayKey: args.dayKey,
            userId: generationIdentity.userId,
            reason: "failure_logging",
            error:
              qualityLoggingError instanceof Error
                ? qualityLoggingError.message
                : "unknown",
          });
        }

        if (attemptNumber >= maxAttempts || !autopilotEnabled) {
          break;
        }
      }
    }

    const successfulAttempts = attempts.filter(
      (
        attempt,
      ): attempt is SummaryAttemptOutcome & {
        generated: NonNullable<SummaryAttemptOutcome["generated"]>;
      } => Boolean(attempt.generated),
    );

    if (successfulAttempts.length === 0) {
      return {
        success: false,
        errorCode: "model_generation_failed",
        message: toUserFacingSummaryGenerationErrorMessage(latestError),
      };
    }

    const sortedAttempts = successfulAttempts.slice().sort((left, right) => {
      if (right.qualityScore !== left.qualityScore) {
        return right.qualityScore - left.qualityScore;
      }
      return left.attemptNumber - right.attemptNumber;
    });
    const selectedAttempt = sortedAttempts[0] ?? successfulAttempts[0];
    if (!selectedAttempt) {
      // Unreachable: successfulAttempts.length > 0 was just asserted.
      return {
        success: false,
        errorCode: "model_generation_failed",
        message: toUserFacingSummaryGenerationErrorMessage(latestError),
      };
    }

    const mergedMetrics = {
      steps:
        selectedAttempt.generated.metrics?.steps ??
        integrationContext.mergedMetrics?.steps,
      sleepMinutes:
        selectedAttempt.generated.metrics?.sleepMinutes ??
        integrationContext.mergedMetrics?.sleepMinutes,
      screenTimeMinutes:
        selectedAttempt.generated.metrics?.screenTimeMinutes ??
        integrationContext.mergedMetrics?.screenTimeMinutes,
      spendingTotal:
        selectedAttempt.generated.metrics?.spendingTotal ??
        integrationContext.mergedMetrics?.spendingTotal,
    };

    const hasMergedMetrics = Object.values(mergedMetrics).some(
      (value) => value !== undefined,
    );
    const mergedSourcesUsed = Array.from(
      new Set([
        ...selectedAttempt.generated.sourcesUsed,
        ...(integrationContext.sources.length > 0 ? ["Integrations"] : []),
        ...integrationContext.sources,
      ]),
    );

    const saved = (await ctx.runMutation((api as any).summaries.upsertSummary, {
      dayKey: args.dayKey,
      story: selectedAttempt.generated.story,
      highlights: selectedAttempt.generated.highlights,
      metrics: hasMergedMetrics ? mergedMetrics : undefined,
      sourcesUsed: mergedSourcesUsed,
    })) as { _id?: string; generatedAt?: number } | null;

    if (selectedAttempt.generationEventId && selectedAttempt.attemptId) {
      await ctx.runMutation(
        (internal as any).summaryQuality
          .markSummaryGenerationBestAttemptInternal,
        {
          generationEventId: selectedAttempt.generationEventId,
          selectedBestAttemptId: selectedAttempt.attemptId,
        },
      );
    }

    logInfo("summary_generation.best_attempt_selected", {
      event: "best_attempt_selected",
      dayKey: args.dayKey,
      userId: generationIdentity.userId,
      attemptChainId,
      selectedAttemptNumber: selectedAttempt.attemptNumber,
      selectedStrategy: selectedAttempt.strategy,
      selectedQualityScore: selectedAttempt.qualityScore,
      attemptsEvaluated: attempts.length,
    });

    logInfo("summary_generation.succeeded", {
      status: "succeeded",
      dayKey: args.dayKey,
      userId: generationIdentity.userId,
      summaryId: saved?._id,
      attemptChainId,
      selectedAttemptNumber: selectedAttempt.attemptNumber,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true,
      summaryId: saved?._id,
      generatedAt: saved?.generatedAt,
    };
  },
});
