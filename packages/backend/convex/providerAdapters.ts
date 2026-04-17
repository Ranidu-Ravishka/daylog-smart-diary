import {
  assertIntegrationProvider,
  type IntegrationProvider,
  sanitizeProviderInput,
} from "./integrationProviders";
import { getDayWindow } from "../../ui/lib/day-window";

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
  timeZone: string;
  syncStartedAt: number;
  requestJson: ProviderRequestJson;
};

type IntegrationSyncAdapter = ProviderAdapter<
  IntegrationSyncAdapterInput,
  NormalizedIntegrationDailySync
>;

function getProviderDayRange(dayKey: string, timeZone: string) {
  const window = getDayWindow(dayKey, timeZone);
  return {
    start: window.startMs,
    end: window.endMs,
  };
}

function sanitizeSignals(signals: string[] | undefined) {
  return (signals ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function extractNotionPageTitle(
  result: Record<string, unknown>,
): string | null {
  const titleRoot = result.title;
  if (Array.isArray(titleRoot)) {
    const joined = titleRoot
      .map((segment) => {
        if (
          segment &&
          typeof segment === "object" &&
          "plain_text" in segment &&
          typeof (segment as { plain_text?: unknown }).plain_text === "string"
        ) {
          return (segment as { plain_text: string }).plain_text;
        }

        return "";
      })
      .join("")
      .trim();

    if (joined) {
      return joined;
    }
  }

  const properties = result.properties;
  if (!properties || typeof properties !== "object") {
    return null;
  }

  for (const value of Object.values(properties)) {
    if (!value || typeof value !== "object") continue;

    const candidate = value as {
      type?: unknown;
      title?: Array<{ plain_text?: unknown }>;
    };

    if (candidate.type !== "title" || !Array.isArray(candidate.title)) {
      continue;
    }

    const joined = candidate.title
      .map((segment) =>
        typeof segment?.plain_text === "string" ? segment.plain_text : "",
      )
      .join("")
      .trim();

    if (joined) {
      return joined;
    }
  }

  return null;
}

function readGmailHeader(
  headers: Array<{ name?: string; value?: string }> | undefined,
  headerName: string,
): string | null {
  if (!Array.isArray(headers)) return null;

  const expected = headerName.toLowerCase();
  for (const header of headers) {
    if (header.name?.toLowerCase() !== expected) continue;
    const value = header.value?.trim();
    if (value) return value;
  }

  return null;
}

function normalizeEmailSender(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const emailMatch = trimmed.match(/<([^>]+)>/);
  if (emailMatch?.[1]) {
    return emailMatch[1].trim().toLowerCase();
  }

  return trimmed.toLowerCase();
}

function normalizeCompactText(
  value: string | undefined,
  maxLength = 100,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function formatDistanceKm(distanceMeters: number): string {
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function formatDateOnly(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

const googleCalendarAdapter: IntegrationSyncAdapter = {
  id: "google_calendar",
  execute: async ({
    accessToken,
    dayKey,
    timeZone,
    syncStartedAt,
    requestJson,
  }) => {
    const { start, end } = getProviderDayRange(dayKey, timeZone);

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
  execute: async ({
    accessToken,
    dayKey,
    timeZone,
    syncStartedAt,
    requestJson,
  }) => {
    const { start, end } = getProviderDayRange(dayKey, timeZone);

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

const slackAdapter: IntegrationSyncAdapter = {
  id: "slack",
  execute: async ({
    accessToken,
    dayKey,
    timeZone,
    syncStartedAt,
    requestJson,
  }) => {
    const { start, end } = getProviderDayRange(dayKey, timeZone);
    const nextDayStart = end + 1;
    const query = encodeURIComponent(
      `after:${formatDateOnly(start)} before:${formatDateOnly(nextDayStart)}`,
    );

    const payload = await requestJson<{
      ok?: boolean;
      error?: string;
      messages?: {
        total?: number;
        matches?: Array<{
          text?: string;
          channel?: { name?: string };
        }>;
      };
    }>(
      `https://slack.com/api/search.messages?count=20&sort=timestamp&sort_dir=desc&query=${query}`,
      accessToken,
      syncStartedAt,
    );

    if (payload.ok === false) {
      throw new ProviderAdapterError({
        provider: "slack",
        operation: "daily_sync",
        retryable: false,
        message: `Slack API error: ${payload.error ?? "unknown_error"}`,
      });
    }

    const matches = payload.messages?.matches ?? [];
    const totalMessages =
      typeof payload.messages?.total === "number" &&
      Number.isFinite(payload.messages.total)
        ? payload.messages.total
        : matches.length;

    const channels = new Set<string>();
    for (const match of matches) {
      const channel = normalizeCompactText(match.channel?.name, 64);
      if (channel) {
        channels.add(channel);
      }
    }

    const snippets = matches
      .map((match) => normalizeCompactText(match.text))
      .filter((value): value is string => Boolean(value))
      .slice(0, 5);

    return {
      summary:
        totalMessages > 0
          ? `Slack: ${totalMessages} matched message${totalMessages === 1 ? "" : "s"} across ${channels.size} channel${channels.size === 1 ? "" : "s"}.`
          : "Slack: no message activity for this day.",
      signals: sanitizeSignals([
        totalMessages > 0
          ? `${totalMessages} Slack messages`
          : "No Slack messages",
        channels.size > 0
          ? `${channels.size} active Slack channels`
          : "No channel activity",
        ...snippets,
      ]),
    };
  },
};

const stravaAdapter: IntegrationSyncAdapter = {
  id: "strava",
  execute: async ({
    accessToken,
    dayKey,
    timeZone,
    syncStartedAt,
    requestJson,
  }) => {
    const { start, end } = getProviderDayRange(dayKey, timeZone);
    const afterSeconds = Math.floor(start / 1000);
    const beforeSeconds = Math.floor(end / 1000);

    const payload = await requestJson<
      Array<{
        name?: string;
        type?: string;
        distance?: number;
        moving_time?: number;
        start_date?: string;
      }>
    >(
      `https://www.strava.com/api/v3/athlete/activities?after=${afterSeconds}&before=${beforeSeconds}&per_page=30&page=1`,
      accessToken,
      syncStartedAt,
    );

    const activities = (payload ?? []).filter((activity) => {
      const startedAt = activity.start_date
        ? new Date(activity.start_date).getTime()
        : NaN;
      return (
        Number.isFinite(startedAt) && startedAt >= start && startedAt <= end
      );
    });

    const totalDistanceMeters = activities.reduce((sum, activity) => {
      if (
        typeof activity.distance === "number" &&
        Number.isFinite(activity.distance) &&
        activity.distance > 0
      ) {
        return sum + activity.distance;
      }

      return sum;
    }, 0);

    const totalMovingMinutes = activities.reduce((sum, activity) => {
      if (
        typeof activity.moving_time === "number" &&
        Number.isFinite(activity.moving_time) &&
        activity.moving_time > 0
      ) {
        return sum + Math.round(activity.moving_time / 60);
      }

      return sum;
    }, 0);

    const activityTypes = Array.from(
      new Set(
        activities
          .map((activity) => normalizeCompactText(activity.type, 48))
          .filter((value): value is string => Boolean(value)),
      ),
    ).slice(0, 5);

    const activityNames = activities
      .map((activity) => normalizeCompactText(activity.name, 80))
      .filter((value): value is string => Boolean(value))
      .slice(0, 5);

    return {
      summary:
        activities.length > 0
          ? `Strava: ${activities.length} activit${activities.length === 1 ? "y" : "ies"}, ${formatDistanceKm(totalDistanceMeters)}, ${totalMovingMinutes} active minutes.`
          : "Strava: no recorded activities for this day.",
      signals: sanitizeSignals([
        activities.length > 0
          ? `${activities.length} Strava activities`
          : "No Strava activities",
        totalDistanceMeters > 0
          ? `${formatDistanceKm(totalDistanceMeters)} total distance`
          : "No distance data",
        totalMovingMinutes > 0
          ? `${totalMovingMinutes} active minutes`
          : "No moving-time data",
        ...activityTypes,
        ...activityNames,
      ]),
      context:
        totalDistanceMeters > 0 || totalMovingMinutes > 0
          ? {
              schemaVersion: 1,
              fitness: {
                distanceMeters:
                  totalDistanceMeters > 0 ? totalDistanceMeters : undefined,
                activeMinutes:
                  totalMovingMinutes > 0 ? totalMovingMinutes : undefined,
                source: "strava",
              },
            }
          : undefined,
    };
  },
};

const todoistAdapter: IntegrationSyncAdapter = {
  id: "todoist",
  execute: async ({
    accessToken,
    dayKey,
    timeZone,
    syncStartedAt,
    requestJson,
  }) => {
    const { start, end } = getProviderDayRange(dayKey, timeZone);

    const payload = await requestJson<{
      items?: Array<{
        content?: string;
        completed_date?: string;
        project_id?: string | number;
      }>;
      projects?: Array<{
        id?: string | number;
        name?: string;
      }>;
    }>(
      `https://api.todoist.com/sync/v9/completed/get_all?since=${encodeURIComponent(new Date(start).toISOString())}&until=${encodeURIComponent(new Date(end).toISOString())}&limit=30`,
      accessToken,
      syncStartedAt,
    );

    const projectsById = new Map<string, string>();
    for (const project of payload.projects ?? []) {
      const id = project.id;
      const key = id === undefined ? "" : String(id).trim();
      const name = normalizeCompactText(project.name, 80);
      if (key && name) {
        projectsById.set(key, name);
      }
    }

    const completedItems = (payload.items ?? []).filter((item) => {
      const completedAt = item.completed_date
        ? new Date(item.completed_date).getTime()
        : NaN;
      return (
        Number.isFinite(completedAt) &&
        completedAt >= start &&
        completedAt <= end
      );
    });

    const completedTaskNames = completedItems
      .map((item) => normalizeCompactText(item.content))
      .filter((value): value is string => Boolean(value))
      .slice(0, 5);

    const activeProjects = new Set<string>();
    for (const item of completedItems) {
      const projectKey =
        item.project_id === undefined ? "" : String(item.project_id).trim();
      if (!projectKey) continue;

      const projectName = projectsById.get(projectKey);
      if (projectName) {
        activeProjects.add(projectName);
      }
    }

    return {
      summary:
        completedItems.length > 0
          ? `Todoist: ${completedItems.length} task${completedItems.length === 1 ? "" : "s"} completed across ${activeProjects.size} project${activeProjects.size === 1 ? "" : "s"}.`
          : "Todoist: no completed tasks for this day.",
      signals: sanitizeSignals([
        completedItems.length > 0
          ? `${completedItems.length} completed Todoist tasks`
          : "No completed Todoist tasks",
        activeProjects.size > 0
          ? `${activeProjects.size} active Todoist projects`
          : "No project activity",
        ...Array.from(activeProjects).slice(0, 5),
        ...completedTaskNames,
      ]),
    };
  },
};

const googleFitAdapter: IntegrationSyncAdapter = {
  id: "google_fit",
  execute: async ({
    accessToken,
    dayKey,
    timeZone,
    syncStartedAt,
    requestJson,
  }) => {
    const { start, end } = getProviderDayRange(dayKey, timeZone);

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

const notionAdapter: IntegrationSyncAdapter = {
  id: "notion",
  execute: async ({
    accessToken,
    dayKey,
    timeZone,
    syncStartedAt,
    requestJson,
  }) => {
    const { start, end } = getProviderDayRange(dayKey, timeZone);

    const payload = await requestJson<{
      results?: Array<{
        object?: string;
        last_edited_time?: string;
        title?: Array<{ plain_text?: string }>;
        properties?: Record<string, unknown>;
      }>;
    }>("https://api.notion.com/v1/search", accessToken, syncStartedAt, {
      method: "POST",
      headers: {
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        page_size: 25,
        filter: {
          property: "object",
          value: "page",
        },
        sort: {
          direction: "descending",
          timestamp: "last_edited_time",
        },
      }),
    });

    const pages = (payload.results ?? []).filter((item) => {
      const editedAt = item.last_edited_time
        ? new Date(item.last_edited_time).getTime()
        : NaN;
      return Number.isFinite(editedAt) && editedAt >= start && editedAt <= end;
    });

    const topTitles = pages
      .map((page) => extractNotionPageTitle(page as Record<string, unknown>))
      .filter((value): value is string => Boolean(value))
      .slice(0, 5);

    return {
      summary:
        pages.length > 0
          ? `Notion: ${pages.length} recently updated page${pages.length === 1 ? "" : "s"}.`
          : "Notion: no recently updated pages for this day.",
      signals: sanitizeSignals([
        pages.length > 0
          ? `${pages.length} updated Notion pages`
          : "No updated Notion pages",
        ...topTitles,
      ]),
    };
  },
};

const gmailSummaryAdapter: IntegrationSyncAdapter = {
  id: "gmail_summary",
  execute: async ({
    accessToken,
    dayKey,
    timeZone,
    syncStartedAt,
    requestJson,
  }) => {
    const { start, end } = getProviderDayRange(dayKey, timeZone);
    const afterSeconds = Math.floor(start / 1000);
    const beforeSeconds = Math.floor(end / 1000);
    const query = encodeURIComponent(
      `after:${afterSeconds} before:${beforeSeconds}`,
    );

    const messageList = await requestJson<{
      messages?: Array<{ id?: string }>;
      resultSizeEstimate?: number;
    }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${query}`,
      accessToken,
      syncStartedAt,
    );

    const messageIds = (messageList.messages ?? [])
      .map((message) => message.id?.trim())
      .filter((value): value is string => Boolean(value))
      .slice(0, 10);

    const messageDetails = await Promise.all(
      messageIds.map(async (messageId) => {
        return await requestJson<{
          payload?: {
            headers?: Array<{ name?: string; value?: string }>;
          };
        }>(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
          accessToken,
          syncStartedAt,
        );
      }),
    );

    const senders = new Set<string>();
    const subjects: string[] = [];

    for (const detail of messageDetails) {
      const headers = detail.payload?.headers;
      const sender = normalizeEmailSender(readGmailHeader(headers, "From"));
      if (sender) {
        senders.add(sender);
      }

      const subject = readGmailHeader(headers, "Subject");
      if (subject) {
        subjects.push(subject);
      }
    }

    const totalMessages =
      typeof messageList.resultSizeEstimate === "number" &&
      Number.isFinite(messageList.resultSizeEstimate)
        ? messageList.resultSizeEstimate
        : messageIds.length;

    return {
      summary:
        totalMessages > 0
          ? `Gmail: ${totalMessages} message${totalMessages === 1 ? "" : "s"} from ${senders.size} sender${senders.size === 1 ? "" : "s"}.`
          : "Gmail: no messages for this day.",
      signals: sanitizeSignals([
        totalMessages > 0
          ? `${totalMessages} Gmail messages`
          : "No Gmail messages",
        senders.size > 0
          ? `${senders.size} unique senders`
          : "No sender activity",
        ...subjects.slice(0, 5),
      ]),
    };
  },
};

const integrationSyncAdapterRegistry: Record<
  IntegrationProvider,
  IntegrationSyncAdapter
> = {
  google_calendar: googleCalendarAdapter,
  google_fit: googleFitAdapter,
  gmail_summary: gmailSummaryAdapter,
  slack: slackAdapter,
  strava: stravaAdapter,
  todoist: todoistAdapter,
  spotify: spotifyAdapter,
  notion: notionAdapter,
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
  apple_calendar: {
    id: "apple_calendar",
    execute: async () => {
      throw new ProviderAdapterError({
        provider: "apple_calendar",
        operation: "daily_sync",
        retryable: false,
        message:
          "Apple Calendar sync requires client-device calendar context upload.",
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
