/**
 * Deterministic, rule-based fallback summary generator.
 *
 * Used when the AI path (OpenAI + key rotation + retries) fails completely
 * or when the circuit breaker is open. Produces a structured summary from
 * the same inputs the AI would see so users never encounter an empty state.
 *
 * Characteristics:
 * - Pure (no side effects, no network I/O).
 * - Stable output for the same input (no randomness, no timestamps).
 * - Safe to call from queries, mutations, actions, or tests.
 */

export type FallbackMemoryInput = {
  title: string;
  description?: string;
  mood?: string;
  happenedAt: number;
};

export type FallbackDayMetadata = {
  rating?: number;
  manualNotes?: string[];
  peopleTags?: string[];
};

export type FallbackIntegrationContext = {
  providers: string[];
  keySignals: string[];
  mergedMetrics?: {
    steps?: number;
    sleepMinutes?: number;
    screenTimeMinutes?: number;
    spendingTotal?: number;
  };
  sources: string[];
};

export type FallbackSummaryOutput = {
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

const FALLBACK_SOURCE_LABEL = "Deterministic fallback";
const MAX_HIGHLIGHTS = 5;
const MAX_STORY_WORDS = 90;

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function clampString(raw: string, maxLength: number): string {
  const trimmed = raw.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trim()}…`;
}

function limitWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ").trim()}…`;
}

function describeMood(memories: readonly FallbackMemoryInput[]): string | null {
  const moodCounts = new Map<string, number>();
  for (const memory of memories) {
    const mood = memory.mood?.trim();
    if (!mood) continue;
    moodCounts.set(mood, (moodCounts.get(mood) ?? 0) + 1);
  }
  if (moodCounts.size === 0) return null;

  const ranked = Array.from(moodCounts.entries()).sort(
    (left, right) => right[1] - left[1],
  );
  const top = ranked[0];
  if (!top) return null;
  const [topMood, topCount] = top;
  if (moodCounts.size === 1 || topCount > (ranked[1]?.[1] ?? 0)) {
    return `mostly ${topMood}`;
  }
  return "a mix of moods";
}

function summarizeMetrics(
  metrics: FallbackIntegrationContext["mergedMetrics"],
): string[] {
  const parts: string[] = [];
  if (!metrics) return parts;

  if (typeof metrics.steps === "number" && metrics.steps > 0) {
    parts.push(`${formatInteger(metrics.steps)} steps`);
  }
  if (typeof metrics.sleepMinutes === "number" && metrics.sleepMinutes > 0) {
    const hours = (metrics.sleepMinutes / 60).toFixed(1);
    parts.push(`${hours}h sleep`);
  }
  if (
    typeof metrics.screenTimeMinutes === "number" &&
    metrics.screenTimeMinutes > 0
  ) {
    const hours = (metrics.screenTimeMinutes / 60).toFixed(1);
    parts.push(`${hours}h screen time`);
  }
  if (
    typeof metrics.spendingTotal === "number" &&
    Math.abs(metrics.spendingTotal) > 0
  ) {
    parts.push(`spend ${metrics.spendingTotal.toFixed(2)}`);
  }
  return parts;
}

export function buildRuleBasedSummary(input: {
  dayKey: string;
  memories: readonly FallbackMemoryInput[];
  dayMetadata: FallbackDayMetadata;
  integrationContext: FallbackIntegrationContext;
}): FallbackSummaryOutput {
  const { memories, dayMetadata, integrationContext } = input;

  const memoryCount = memories.length;
  const metricParts = summarizeMetrics(integrationContext.mergedMetrics);
  const moodLine = describeMood(memories);

  const storyParts: string[] = [];
  if (memoryCount === 0) {
    storyParts.push("No memories were captured today.");
  } else if (memoryCount === 1) {
    storyParts.push("You captured one memory today.");
  } else {
    storyParts.push(`You captured ${memoryCount} memories today.`);
  }

  if (moodLine) {
    storyParts.push(`The day felt ${moodLine}.`);
  }

  if (typeof dayMetadata.rating === "number") {
    storyParts.push(`You rated it ${dayMetadata.rating.toFixed(1)}/5.`);
  }

  if (metricParts.length > 0) {
    storyParts.push(`Activity: ${metricParts.join(", ")}.`);
  }

  if (integrationContext.providers.length > 0) {
    const providerList = integrationContext.providers.slice(0, 4).join(", ");
    storyParts.push(`Connected data: ${providerList}.`);
  }

  if (
    storyParts.length === 1 &&
    memoryCount === 0 &&
    metricParts.length === 0
  ) {
    storyParts.push(
      "Add a memory, note, rating, or integration sync to build a richer picture.",
    );
  }

  const story = limitWords(storyParts.join(" "), MAX_STORY_WORDS);

  const highlights: string[] = [];

  for (const memory of memories.slice(0, MAX_HIGHLIGHTS)) {
    const title = memory.title?.trim();
    if (title) {
      highlights.push(clampString(title, 80));
    }
  }

  for (const note of dayMetadata.manualNotes ?? []) {
    if (highlights.length >= MAX_HIGHLIGHTS) break;
    const trimmed = note?.trim();
    if (trimmed) {
      highlights.push(clampString(trimmed, 80));
    }
  }

  for (const signal of integrationContext.keySignals) {
    if (highlights.length >= MAX_HIGHLIGHTS) break;
    const trimmed = signal?.trim();
    if (trimmed) {
      highlights.push(clampString(trimmed, 80));
    }
  }

  const metrics = integrationContext.mergedMetrics
    ? {
        steps: integrationContext.mergedMetrics.steps,
        sleepMinutes: integrationContext.mergedMetrics.sleepMinutes,
        screenTimeMinutes: integrationContext.mergedMetrics.screenTimeMinutes,
        spendingTotal: integrationContext.mergedMetrics.spendingTotal,
      }
    : undefined;

  const sourcesUsed = Array.from(
    new Set([FALLBACK_SOURCE_LABEL, ...integrationContext.sources]),
  );

  return {
    story,
    highlights: highlights.slice(0, MAX_HIGHLIGHTS),
    metrics,
    sourcesUsed,
  };
}

export const DETERMINISTIC_FALLBACK_SOURCE_LABEL = FALLBACK_SOURCE_LABEL;
