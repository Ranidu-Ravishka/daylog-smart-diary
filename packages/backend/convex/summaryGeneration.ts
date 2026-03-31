import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api } from "./_generated/api";
import { validateDayKey } from "./validators";
import { convexServerEnv } from "./env";

const OPENAI_MAX_ATTEMPTS = 3;
const OPENAI_BASE_BACKOFF_MS = 400;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  syncedAt: number;
};

function toSourceLabel(provider: string): string {
  const labels: Record<string, string> = {
    google_calendar: "Google Calendar",
    google_fit: "Google Fit",
    spotify: "Spotify",
    apple_health: "Apple Health",
    location: "Location (foreground)",
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
  const uniqueSignals = Array.from(new Set(flattenedSignals)).slice(0, 16);

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
  };
}

export async function generateSummaryWithOpenAi(
  dayKey: string,
  modelInput: string,
) {
  const openAiKey = convexServerEnv.openAiApiKey;

  const callOpenAi = async () => {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.3,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "day_summary",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                story: { type: "string" },
                highlights: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 6,
                },
                metrics: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    steps: { type: "number" },
                    sleepMinutes: { type: "number" },
                    screenTimeMinutes: { type: "number" },
                    spendingTotal: { type: "number" },
                  },
                },
                sourcesUsed: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 8,
                },
              },
              required: ["story", "highlights", "sourcesUsed"],
            },
          },
        },
        messages: [
          {
            role: "system",
            content:
              "You are a concise wellbeing journaling assistant. Create an honest, grounded summary with no invented facts. Keep the narrative under 120 words and highlights short.",
          },
          {
            role: "user",
            content: `Generate a summary for ${dayKey}. Use only this JSON input:\n${modelInput}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const status = response.status;
      const retryable = isRetryableOpenAiStatus(status);
      throw new OpenAiRequestError(
        status,
        `OpenAI request failed (${status}): ${errorText.slice(0, 300)}`,
        retryable,
      );
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content;
  };

  let content: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt++) {
    try {
      content = await callOpenAi();
      break;
    } catch (error) {
      lastError = error;
      const shouldRetry =
        attempt < OPENAI_MAX_ATTEMPTS && isRetryableOpenAiError(error);

      if (!shouldRetry) {
        break;
      }

      const backoffMs = OPENAI_BASE_BACKOFF_MS * 2 ** (attempt - 1);
      console.warn(
        `[summaryGeneration] OpenAI attempt ${attempt} failed; retrying in ${backoffMs}ms`,
      );
      await sleep(backoffMs);
    }
  }

  if (!content) {
    if (lastError instanceof OpenAiRequestError) {
      throw new Error(lastError.message);
    }

    throw new Error(
      "Summary generation failed after retries. Please try again in a moment.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI summary output was not valid JSON");
  }

  return normalizeModelOutput(parsed);
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
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    summaryId?: string;
    generatedAt?: number;
  }> => {
    validateDayKey(args.dayKey);

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
      throw new Error(
        "No memories, day metadata, or integration sync data found for this date. Add data before generating a summary.",
      );
    }

    const integrationContext = buildIntegrationContextForModel(
      integrationData ?? [],
    );

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
      },
    });

    const generated = await generateSummaryWithOpenAi(args.dayKey, modelInput);

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

    return {
      success: true,
      summaryId: saved?._id,
      generatedAt: saved?.generatedAt,
    };
  },
});
