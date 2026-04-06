import {
  assertIntegrationProvider,
  type IntegrationProvider,
  sanitizeProviderInput,
} from "./integrationProviders";

export type ProviderAdapter<Input, Output> = {
  id: string;
  execute: (input: Input) => Promise<Output>;
};

export class ProviderAdapterError extends Error {
  provider: string;
  operation: string;
  retryable: boolean;
  statusCode?: number;

  constructor(args: {
    provider: string;
    operation: string;
    message: string;
    retryable: boolean;
    statusCode?: number;
  }) {
    super(args.message);
    this.name = "ProviderAdapterError";
    this.provider = args.provider;
    this.operation = args.operation;
    this.retryable = args.retryable;
    this.statusCode = args.statusCode;
  }
}

export function isRetryableProviderAdapterError(error: unknown): boolean {
  if (error instanceof ProviderAdapterError) return error.retryable;
  if (error instanceof TypeError) return true;

  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  ) {
    return true;
  }

  return false;
}

export async function executeWithProviderRetry<T>(args: {
  maxAttempts: number;
  baseBackoffMs: number;
  execute: () => Promise<T>;
  isRetryable: (error: unknown) => boolean;
}): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= args.maxAttempts; attempt++) {
    try {
      return await args.execute();
    } catch (error) {
      lastError = error;

      const shouldRetry = attempt < args.maxAttempts && args.isRetryable(error);

      if (!shouldRetry) break;

      const backoffMs =
        args.baseBackoffMs * 2 ** (attempt - 1) +
        Math.floor(Math.random() * 180);

      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Provider execution failed unexpectedly.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type IntegrationDailySyncMetrics = {
  steps?: number;
  sleepMinutes?: number;
  screenTimeMinutes?: number;
  spendingTotal?: number;
};

type NormalizedIntegrationDailyContext = {
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
      latitude?: number;
      longitude?: number;
      radiusMeters?: number;
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

export type NormalizedIntegrationDailySync = {
  metrics?: IntegrationDailySyncMetrics;
  summary?: string;
  signals?: string[];
  context?: NormalizedIntegrationDailyContext;
};

type ProviderRequestJson = <T>(
  url: string,
  accessToken: string,
  syncStartedAt: number,
  init?: RequestInit,
) => Promise<T>;

type IntegrationSyncAdapterInput = {
  accessToken: string;
  dayKey: string;
  syncStartedAt: number;
  requestJson: ProviderRequestJson;
};

type IntegrationSyncAdapter = ProviderAdapter<
  IntegrationSyncAdapterInput,
  NormalizedIntegrationDailySync
>;

function getUtcDayRange(dayKey: string) {
  const start = new Date(`${dayKey}T00:00:00.000Z`).getTime();
  const end = new Date(`${dayKey}T23:59:59.999Z`).getTime();
  return { start, end };
}

function sanitizeSignals(signals: string[] | undefined) {
  return (signals ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

const googleCalendarAdapter: IntegrationSyncAdapter = {
  id: "google_calendar",
  execute: async ({ accessToken, dayKey, syncStartedAt, requestJson }) => {
    const { start, end } = getUtcDayRange(dayKey);

    const result = await requestJson<{
      items?: Array<{
        summary?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      }>;
    }>(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(new Date(start).toISOString())}&timeMax=${encodeURIComponent(new Date(end).toISOString())}&maxResults=100`,
      accessToken,
      syncStartedAt,
    );

    const events = result.items ?? [];
    let busyMinutes = 0;

    for (const event of events) {
      const from = event.start?.dateTime
        ? new Date(event.start.dateTime).getTime()
        : null;
      const to = event.end?.dateTime
        ? new Date(event.end.dateTime).getTime()
        : null;
      if (
        !from ||
        !to ||
        Number.isNaN(from) ||
        Number.isNaN(to) ||
        to <= from
      ) {
        continue;
      }
      busyMinutes += Math.round((to - from) / 60000);
    }

    const topEventTitles = events
      .map((event) => event.summary?.trim())
      .filter((value): value is string => Boolean(value))
      .slice(0, 5);

    return {
      summary:
        events.length > 0
          ? `Google Calendar: ${events.length} events, ~${busyMinutes} busy minutes.`
          : "Google Calendar: no events for this day.",
      signals: sanitizeSignals([
        events.length > 0
          ? `${events.length} calendar events`
          : "No calendar events",
        busyMinutes > 0 ? `${busyMinutes} busy minutes` : "No timed events",
        ...topEventTitles,
      ]),
      context: {
        schemaVersion: 1,
        calendar: {
          meetingsCount: events.length > 0 ? events.length : undefined,
          busyMinutes: busyMinutes > 0 ? busyMinutes : undefined,
          eventTitles: topEventTitles,
        },
      },
    };
  },
};

const spotifyAdapter: IntegrationSyncAdapter = {
  id: "spotify",
  execute: async ({ accessToken, dayKey, syncStartedAt, requestJson }) => {
    const { start, end } = getUtcDayRange(dayKey);

    const result = await requestJson<{
      items?: Array<{
        played_at?: string;
        track?: {
          name?: string;
          artists?: Array<{ name?: string }>;
        };
      }>;
    }>(
      `https://api.spotify.com/v1/me/player/recently-played?limit=50&after=${Math.max(start - 1, 0)}`,
      accessToken,
      syncStartedAt,
    );

    const plays = (result.items ?? []).filter((item) => {
      const playedAt = item.played_at
        ? new Date(item.played_at).getTime()
        : NaN;
      return Number.isFinite(playedAt) && playedAt >= start && playedAt <= end;
    });

    const uniqueArtists = new Set<string>();
    for (const play of plays) {
      for (const artist of play.track?.artists ?? []) {
        if (artist.name?.trim()) uniqueArtists.add(artist.name.trim());
      }
    }

    const topTracks = plays
      .map((play) => play.track?.name?.trim())
      .filter((name): name is string => Boolean(name))
      .slice(0, 5);

    return {
      summary:
        plays.length > 0
          ? `Spotify: ${plays.length} recent plays from ${uniqueArtists.size} artist(s).`
          : "Spotify: no recent playback for this day.",
      signals: sanitizeSignals([
        plays.length > 0
          ? `${plays.length} tracks played`
          : "No track playback",
        uniqueArtists.size > 0
          ? `${uniqueArtists.size} unique artists`
          : "No artist activity",
        ...topTracks,
      ]),
    };
  },
};

const googleFitAdapter: IntegrationSyncAdapter = {
  id: "google_fit",
  execute: async ({ accessToken, dayKey, syncStartedAt, requestJson }) => {
    const { start, end } = getUtcDayRange(dayKey);

    const aggregateResponse = await requestJson<{
      bucket?: Array<{
        dataset?: Array<{
          point?: Array<{
            startTimeNanos?: string;
            endTimeNanos?: string;
            value?: Array<{ intVal?: number }>;
            dataTypeName?: string;
          }>;
        }>;
      }>;
    }>(
      "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate",
      accessToken,
      syncStartedAt,
      {
        method: "POST",
        body: JSON.stringify({
          aggregateBy: [
            { dataTypeName: "com.google.step_count.delta" },
            { dataTypeName: "com.google.sleep.segment" },
          ],
          bucketByTime: { durationMillis: 86_400_000 },
          startTimeMillis: start,
          endTimeMillis: end,
        }),
      },
    );

    const points = (aggregateResponse.bucket ?? []).flatMap((bucket) =>
      (bucket.dataset ?? []).flatMap((dataset) => dataset.point ?? []),
    );

    const steps = points.reduce((acc, point) => {
      const value = point.value?.[0]?.intVal;
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return acc + value;
      }
      return acc;
    }, 0);

    const sleepMinutes = points.reduce((acc, point) => {
      const startNanos = Number(point.startTimeNanos ?? 0);
      const endNanos = Number(point.endTimeNanos ?? 0);
      if (!Number.isFinite(startNanos) || !Number.isFinite(endNanos))
        return acc;
      if (endNanos <= startNanos) return acc;
      return acc + Math.round((endNanos - startNanos) / 1_000_000_000 / 60);
    }, 0);

    return {
      metrics: {
        steps: steps > 0 ? steps : undefined,
        sleepMinutes: sleepMinutes > 0 ? sleepMinutes : undefined,
      },
      summary:
        steps > 0 || sleepMinutes > 0
          ? `Google Fit: ${steps.toLocaleString()} steps, ${sleepMinutes} sleep minutes.`
          : "Google Fit: no measurable activity for this day.",
      signals: sanitizeSignals([
        steps > 0 ? `${steps.toLocaleString()} steps` : "No step count",
        sleepMinutes > 0
          ? `${sleepMinutes} sleep minutes`
          : "No sleep segments",
      ]),
      context: {
        schemaVersion: 1,
        fitness: {
          steps: steps > 0 ? steps : undefined,
          source: "google_fit",
        },
      },
    };
  },
};

const integrationSyncAdapterRegistry: Record<
  IntegrationProvider,
  IntegrationSyncAdapter
> = {
  google_calendar: googleCalendarAdapter,
  google_fit: googleFitAdapter,
  spotify: spotifyAdapter,
  apple_health: {
    id: "apple_health",
    execute: async () => {
      throw new ProviderAdapterError({
        provider: "apple_health",
        operation: "daily_sync",
        retryable: false,
        message:
          "Apple Health sync requires client-device upload. Use syncAppleHealthDailyData from mobile.",
      });
    },
  },
};

export function resolveIntegrationSyncAdapter(provider: string) {
  const normalized = assertIntegrationProvider(provider);
  return integrationSyncAdapterRegistry[normalized];
}

export type SummaryModelOutput = {
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

type SummaryModelAdapterInput = {
  dayKey: string;
  modelInput: string;
  apiKey: string;
};

type SummaryModelAdapter = ProviderAdapter<
  SummaryModelAdapterInput,
  SummaryModelOutput
>;

function isRetryableSummaryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function getSafeOpenAiErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return `OpenAI authentication failed (${status})`;
  }

  if (status === 429) {
    return "OpenAI rate limit reached (429). Please try again shortly.";
  }

  if (status >= 500) {
    return `OpenAI service is temporarily unavailable (${status}). Please try again shortly.`;
  }

  return `OpenAI request failed (${status})`;
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

function normalizeSummaryModelOutput(payload: unknown): SummaryModelOutput {
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

const openAiSummaryAdapter: SummaryModelAdapter = {
  id: "openai",
  execute: async ({ dayKey, modelInput, apiKey }) => {
    const responseJson = await executeWithProviderRetry<{
      choices?: Array<{ message?: { content?: string } }>;
    }>({
      maxAttempts: 3,
      baseBackoffMs: 400,
      isRetryable: isRetryableProviderAdapterError,
      execute: async () => {
        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
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
          },
        );

        if (!response.ok) {
          const status = response.status;

          // Drain the response body without propagating provider payloads to callers.
          try {
            await response.text();
          } catch {
            // Ignore body read failures; the status code is enough for safe handling.
          }

          throw new ProviderAdapterError({
            provider: "openai",
            operation: "summary_generation",
            statusCode: status,
            retryable: isRetryableSummaryStatus(status),
            message: getSafeOpenAiErrorMessage(status),
          });
        }

        return (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
      },
    });

    const content = responseJson.choices?.[0]?.message?.content;
    if (!content) {
      throw new ProviderAdapterError({
        provider: "openai",
        operation: "summary_generation",
        retryable: false,
        message: "OpenAI summary output was empty.",
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ProviderAdapterError({
        provider: "openai",
        operation: "summary_generation",
        retryable: false,
        message: "OpenAI summary output was not valid JSON.",
      });
    }

    return normalizeSummaryModelOutput(parsed);
  },
};

const summaryModelAdapterRegistry: Record<string, SummaryModelAdapter> = {
  openai: openAiSummaryAdapter,
};

export function resolveSummaryModelAdapter(
  provider: string,
): SummaryModelAdapter {
  const normalized = sanitizeProviderInput(provider);
  const adapter = summaryModelAdapterRegistry[normalized];
  if (!adapter) {
    throw new Error(`Unsupported summary model provider: ${provider}`);
  }

  return adapter;
}
