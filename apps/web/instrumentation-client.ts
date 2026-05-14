import * as Sentry from "@sentry/nextjs";
import {
  webSentryEnvironment,
  webSentryRelease,
  webSentryScrubbers,
  webSentryTracesSampleRate,
} from "@/lib/web-sentry-shared";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: webSentryEnvironment(),
  release: webSentryRelease(),
  sendDefaultPii: false,
  tracesSampleRate: webSentryTracesSampleRate(false),
  ...webSentryScrubbers,
});
