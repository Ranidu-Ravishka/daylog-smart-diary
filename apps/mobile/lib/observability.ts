import {
  sanitizeObservabilityContext,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
} from "@repo/sentry-sanitize";
import * as Sentry from "@sentry/react-native";

type StructuredContext = Record<string, unknown>;
type LogLevel = "info" | "warn" | "error";

const INFO_EVENT_SAMPLE_RATE_DEFAULT = 0.1;

type SerializableError = {
  name: string;
  message: string;
  stack?: string;
};

type StructuredLogEnvelope = {
  schemaVersion: 1;
  app: "daylog";
  surface: "mobile";
  level: LogLevel;
  event: string;
  timestamp: string;
  userId: string | null;
  status: string;
  errorMessage: string | null;
  context: StructuredContext;
  error?: SerializableError;
};

const mobileEnvironment =
  process.env.EXPO_PUBLIC_APP_ENV ?? (__DEV__ ? "development" : "production");
const forceTestException =
  process.env.EXPO_PUBLIC_SENTRY_FORCE_TEST_EXCEPTION === "true";
const durableInfoEventSampleRate = toSampleRate(
  process.env.EXPO_PUBLIC_INFO_EVENT_SAMPLE_RATE,
  INFO_EVENT_SAMPLE_RATE_DEFAULT,
);
const durableInfoEventEndpoint = resolveInfoEventEndpoint(
  process.env.EXPO_PUBLIC_CONVEX_URL,
);

let crashReportingInitialized = false;

function toSampleRate(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;
  return parsed;
}

function shouldSample(rate: number): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() < rate;
}

function isLifecycleEvent(event: string): boolean {
  return /(^|[._-])(started|succeeded|failed)($|[._-])/.test(event);
}

function resolveInfoEventEndpoint(
  convexUrl: string | undefined,
): string | undefined {
  const trimmed = convexUrl?.trim();
  if (!trimmed) {
    return undefined;
  }

  return `${trimmed.replace(/\/+$/, "")}/observability/info-event`;
}

function toSerializableError(error: unknown): SerializableError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return null;
}

function resolveUserId(context: StructuredContext): string | null {
  return (
    toStringOrNull(context.userId) ??
    toStringOrNull(context.clerkUserId) ??
    toStringOrNull(context.actorUserId) ??
    null
  );
}

function resolveStatus(level: LogLevel, context: StructuredContext): string {
  const explicit = toStringOrNull(context.status);
  if (explicit) {
    return explicit;
  }

  if (level === "error") {
    return "failed";
  }

  if (level === "warn") {
    return "warning";
  }

  return "info";
}

function resolveErrorMessage(
  serializedError: SerializableError | undefined,
  context: StructuredContext,
): string | null {
  return serializedError?.message ?? toStringOrNull(context.errorMessage);
}

function toSentryLevel(level: LogLevel): "info" | "warning" | "error" {
  if (level === "warn") {
    return "warning";
  }

  return level;
}

function emitDurableInfoEvent(payload: StructuredLogEnvelope) {
  if (payload.level !== "info") {
    return;
  }

  if (__DEV__) {
    return;
  }

  if (
    !durableInfoEventEndpoint ||
    (!isLifecycleEvent(payload.event) &&
      !shouldSample(durableInfoEventSampleRate))
  ) {
    return;
  }

  // Native transport is intentionally disabled until mobile receives
  // server-issued short-lived ingest JWTs.
  return;
}

function writeStructuredLog(
  level: LogLevel,
  event: string,
  context: StructuredContext = {},
  error?: unknown,
) {
  const safeContext = sanitizeObservabilityContext(
    context as Record<string, unknown>,
  ) as StructuredContext;
  const serializedError =
    typeof error === "undefined" ? undefined : toSerializableError(error);
  const userId = resolveUserId(safeContext);
  const status = resolveStatus(level, safeContext);
  const errorMessage = resolveErrorMessage(serializedError, safeContext);

  const payload: StructuredLogEnvelope = {
    schemaVersion: 1,
    app: "daylog",
    surface: "mobile",
    level,
    event,
    timestamp: new Date().toISOString(),
    userId,
    status,
    errorMessage,
    context: safeContext,
    ...(serializedError ? { error: serializedError } : {}),
  };

  let line = "";
  try {
    line = JSON.stringify(payload);
  } catch {
    line = JSON.stringify({
      schemaVersion: 1,
      app: "daylog",
      surface: "mobile",
      level,
      event,
      timestamp: new Date().toISOString(),
      status,
      errorMessage,
      context: { serializationFailed: true },
    });
  }

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (__DEV__) {
    console.info(line);
  }

  emitDurableInfoEvent(payload);

  Sentry.addBreadcrumb({
    category: "observability",
    message: event,
    level: toSentryLevel(level),
    data: {
      ...safeContext,
      userId,
      status,
      errorMessage,
    },
  });

  if (level === "error") {
    if (typeof error !== "undefined") {
      Sentry.captureException(error, {
        tags: {
          surface: "mobile",
          event,
          status,
        },
        extra: {
          ...safeContext,
          userId,
          status,
          errorMessage,
        },
      });
      return;
    }

    Sentry.captureMessage(event, {
      level: "error",
      tags: {
        surface: "mobile",
        status,
      },
      extra: {
        ...safeContext,
        userId,
        status,
        errorMessage,
      },
    });
    return;
  }

  if (level === "warn") {
    Sentry.captureMessage(event, {
      level: "warning",
      tags: {
        surface: "mobile",
        status,
      },
      extra: {
        ...safeContext,
        userId,
        status,
        errorMessage,
      },
    });
  }
}

export function initCrashReporting() {
  if (crashReportingInitialized) {
    return;
  }

  const hasDsn = Boolean(process.env.EXPO_PUBLIC_SENTRY_DSN);
  const sentryEnabled = hasDsn && (!__DEV__ || forceTestException);

  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    enabled: sentryEnabled,
    environment: mobileEnvironment,
    release:
      process.env.EXPO_PUBLIC_SENTRY_RELEASE?.trim() ||
      process.env.EAS_BUILD_GIT_COMMIT_HASH?.trim() ||
      undefined,
    tracesSampleRate: 0.2,
    enableNative: true,
    enableAutoSessionTracking: true,
    attachStacktrace: true,
    sendDefaultPii: false,
    beforeSend: (event) => sanitizeSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => sanitizeSentryBreadcrumb(breadcrumb),
  });

  crashReportingInitialized = true;

  logInfo("mobile_crash_reporting_initialized", {
    enabled: sentryEnabled,
    hasDsn,
    environment: mobileEnvironment,
  });

  if (forceTestException && sentryEnabled) {
    const forcedError = new Error("mobile_forced_sentry_test_exception");
    const eventId = Sentry.captureException(forcedError, {
      tags: {
        surface: "mobile",
        event: "mobile_forced_test_exception",
      },
      extra: {
        mobileEnvironment,
      },
    });

    void Sentry.flush().then((flushed) => {
      logInfo("mobile_forced_test_exception_emitted", {
        eventId,
        flushed,
      });
    });
  }
}

export function logInfo(event: string, context: StructuredContext = {}) {
  writeStructuredLog("info", event, context);
}

export function logWarn(event: string, context: StructuredContext = {}) {
  writeStructuredLog("warn", event, context);
}

export function logError(event: string, context: StructuredContext = {}) {
  writeStructuredLog("error", event, context);
}

export function captureException(
  event: string,
  error: unknown,
  context: StructuredContext = {},
) {
  writeStructuredLog("error", event, context, error);
}
