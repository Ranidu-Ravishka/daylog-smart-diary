import type { ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import {
  resolveIntegrationSyncAdapter,
  type NormalizedIntegrationDailySync,
} from "./providerAdapters";
import type { IntegrationProvider } from "./integrationProviders";
import {
  sanitizeSignals,
  sanitizeSummaryText,
  type IntegrationDailyContext,
} from "./integrations.dailyData";

const PROVIDER_SYNC_MAX_ATTEMPTS = 3;
const PROVIDER_SYNC_BASE_BACKOFF_MS = 300;
const PROVIDER_SYNC_TIMEOUT_MS = 8_000;
const PROVIDER_SYNC_TOTAL_BUDGET_MS = 20_000;

type IntegrationDailyRow = {
  provider: string;
  summary?: string;
  signals?: string[];
  context?: IntegrationDailyContext;
};

export class ProviderRequestError extends Error {
  status: number;
  retryable: boolean;

  constructor(status: number, message: string, retryable: boolean) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
    this.retryable = retryable;
  }
}

function isRetryableProviderStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderRequestError) return error.retryable;
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

function jitteredBackoff(attempt: number): number {
  const base = PROVIDER_SYNC_BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 180);
  return base + jitter;
}

function remainingBudget(syncStartedAt: number): number {
  return PROVIDER_SYNC_TOTAL_BUDGET_MS - (Date.now() - syncStartedAt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson<T>(
  url: string,
  accessToken: string,
  syncStartedAt: number,
  init?: RequestInit,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= PROVIDER_SYNC_MAX_ATTEMPTS; attempt++) {
    const budgetMs = remainingBudget(syncStartedAt);
    if (budgetMs <= 0) {
      throw new Error("Provider sync timed out before request could complete.");
    }

    const timeoutMs = Math.max(
      250,
      Math.min(PROVIDER_SYNC_TIMEOUT_MS, budgetMs),
    );
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...(init ?? {}),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ProviderRequestError(
          response.status,
          `Provider request failed (${response.status})`,
          isRetryableProviderStatus(response.status),
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      const shouldRetry =
        attempt < PROVIDER_SYNC_MAX_ATTEMPTS &&
        isRetryableProviderError(error) &&
        remainingBudget(syncStartedAt) > 0;

      if (!shouldRetry) {
        throw error;
      }

      const backoffMs = Math.min(
        jitteredBackoff(attempt),
        Math.max(50, remainingBudget(syncStartedAt) - 50),
      );
      await sleep(backoffMs);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Provider sync failed after retries.");
}

export async function syncProviderForDay(
  provider: IntegrationProvider,
  accessToken: string,
  dayKey: string,
  timeZone: string,
  syncStartedAt: number,
): Promise<NormalizedIntegrationDailySync> {
  const adapter = resolveIntegrationSyncAdapter(provider);
  return await adapter.execute({
    accessToken,
    dayKey,
    timeZone,
    syncStartedAt,
    requestJson: fetchJson,
  });
}

export async function syncDerivedAppleCalendarForDay(
  ctx: Pick<ActionCtx, "runQuery">,
  dayKey: string,
): Promise<NormalizedIntegrationDailySync> {
  const dailyRows = (await ctx.runQuery(
    api.integrations.listMyIntegrationDailyDataForDay,
    {
      dayKey,
    },
  )) as IntegrationDailyRow[];

  const calendarRow = dailyRows.find((row) => row.provider === "calendar");
  if (!calendarRow) {
    return {
      summary: "Apple Calendar: no calendar context captured for this day.",
      signals: ["No calendar context captured for this day"],
    };
  }

  const calendarContext = calendarRow.context?.calendar;
  const summaryFromSource = sanitizeSummaryText(calendarRow.summary);
  const summary = summaryFromSource
    ? `Apple Calendar: ${summaryFromSource}`
    : calendarContext?.meetingsCount
      ? `Apple Calendar: ${calendarContext.meetingsCount} event${calendarContext.meetingsCount === 1 ? "" : "s"} captured from device context.`
      : "Apple Calendar: calendar context captured for this day.";

  return {
    summary,
    signals: sanitizeSignals([
      ...(calendarRow.signals ?? []),
      calendarContext?.meetingsCount
        ? `${calendarContext.meetingsCount} calendar events`
        : "No calendar events captured",
      calendarContext?.busyMinutes
        ? `${calendarContext.busyMinutes} busy minutes`
        : "No busy-time data",
      calendarContext?.remindersCount
        ? `${calendarContext.remindersCount} reminders`
        : "No reminder count",
    ]),
    context: calendarContext
      ? {
          schemaVersion: 1,
          calendar: {
            meetingsCount: calendarContext.meetingsCount,
            busyMinutes: calendarContext.busyMinutes,
            remindersCount: calendarContext.remindersCount,
            eventTitles: calendarContext.eventTitles,
          },
        }
      : undefined,
  };
}
