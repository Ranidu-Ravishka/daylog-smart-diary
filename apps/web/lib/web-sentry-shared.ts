import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
} from "@repo/sentry-sanitize";

function toSampleRate(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;
  return parsed;
}

export function webSentryEnvironment(): string {
  return (
    process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? "development"
  );
}

export function webSentryRelease(): string | undefined {
  const release =
    process.env.NEXT_PUBLIC_SENTRY_RELEASE?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.SENTRY_RELEASE?.trim();
  return release || undefined;
}

export function webSentryTracesSampleRate(serverSide: boolean): number {
  if (serverSide) {
    return toSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE ??
        process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
      0.1,
    );
  }

  return toSampleRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 0.1);
}

export const webSentryScrubbers = {
  beforeSend: (event: ErrorEvent): ErrorEvent | null =>
    sanitizeSentryEvent(event) as ErrorEvent,
  beforeBreadcrumb: (breadcrumb: Breadcrumb): Breadcrumb | null =>
    sanitizeSentryBreadcrumb(breadcrumb) as Breadcrumb,
};
