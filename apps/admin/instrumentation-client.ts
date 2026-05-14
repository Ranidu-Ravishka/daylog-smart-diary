import * as Sentry from "@sentry/nextjs";
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

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

const release =
  process.env.NEXT_PUBLIC_SENTRY_RELEASE?.trim() ||
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  process.env.SENTRY_RELEASE?.trim();

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment:
    process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? "development",
  release: release || undefined,
  sendDefaultPii: false,
  tracesSampleRate: toSampleRate(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ??
      process.env.SENTRY_TRACES_SAMPLE_RATE,
    0.1,
  ),
  beforeSend: (event) => sanitizeSentryEvent(event),
  beforeBreadcrumb: (breadcrumb) => sanitizeSentryBreadcrumb(breadcrumb),
});
