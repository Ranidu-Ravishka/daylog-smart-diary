import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api } from "./_generated/api";
import { validateDayKey } from "./validators";

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

async function generateSummaryWithOpenAi(dayKey: string, modelInput: string) {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    throw new Error("Missing OPENAI_API_KEY in Convex environment");
  }

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

    const hasDayMetadata =
      day?.rating !== undefined ||
      (day?.manualNotes?.length ?? 0) > 0 ||
      (day?.peopleTags?.length ?? 0) > 0;

    if ((memories?.length ?? 0) === 0 && !hasDayMetadata) {
      throw new Error(
        "No memories or day metadata found for this date. Add data before generating a summary.",
      );
    }

    await ctx.runMutation(
      (api as any).summaries.reserveSummaryGenerationSlot,
      {},
    );

    const modelInput = JSON.stringify({
      dayKey: args.dayKey,
      memories: (memories ?? []).slice(0, 50).map((memory) => ({
        title: memory.title,
        description: memory.description,
        mood: memory.mood,
        happenedAt: memory.happenedAt,
      })),
      dayMetadata: {
        rating: day?.rating,
        manualNotes: day?.manualNotes ?? [],
        peopleTags: day?.peopleTags ?? [],
      },
    });

    const generated = await generateSummaryWithOpenAi(args.dayKey, modelInput);

    const saved = (await ctx.runMutation((api as any).summaries.upsertSummary, {
      dayKey: args.dayKey,
      story: generated.story,
      highlights: generated.highlights,
      metrics: generated.metrics,
      sourcesUsed: generated.sourcesUsed,
    })) as { _id?: string; generatedAt?: number } | null;

    return {
      success: true,
      summaryId: saved?._id,
      generatedAt: saved?.generatedAt,
    };
  },
});
