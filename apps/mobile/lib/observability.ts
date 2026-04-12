import * as Sentry from "@sentry/react-native";

type StructuredContext = Record<string, unknown>;
type LogLevel = "info" | "warn" | "error";

const INFO_EVENT_SAMPLE_RATE_DEFAULT = 0.1;
const INFO_EVENT_MAX_CONTEXT_JSON_LENGTH = 4_000;

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

function resolveInfoEventEndpoint(
  convexUrl: string | undefined,
): string | undefined {
  const trimmed = convexUrl?.trim();
  if (!trimmed) {
    return undefined;
  }

  return `${trimmed.replace(/\/+$/, "")}/observability/info-event`;
}

function toContextJson(context: StructuredContext): string | undefined {
  try {
    const serialized = JSON.stringify(context);
    if (!serialized || serialized === "{}") {
      return undefined;
    }

    return serialized.slice(0, INFO_EVENT_MAX_CONTEXT_JSON_LENGTH);
  } catch {
    return undefined;
  }
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

  if (!durableInfoEventEndpoint || !shouldSample(durableInfoEventSampleRate)) {
    return;
  }

  const requestBody = JSON.stringify({
    schemaVersion: payload.schemaVersion,
    app: payload.app,
    surface: payload.surface,
    level: payload.level,
    event: payload.event,
    timestamp: payload.timestamp,
    sampleRate: durableInfoEventSampleRate,
    sourceEnvironment: mobileEnvironment,
    contextJson: toContextJson(payload.context),
  });

  void fetch(durableInfoEventEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: requestBody,
  }).catch(() => undefined);
}

function writeStructuredLog(
  level: LogLevel,
  event: string,
  context: StructuredContext = {},
  error?: unknown,
) {
  const serializedError =
    typeof error === "undefined" ? undefined : toSerializableError(error);

  const payload: StructuredLogEnvelope = {
    schemaVersion: 1,
    app: "daylog",
    surface: "mobile",
    level,
    event,
    timestamp: new Date().toISOString(),
    context,
    ...(serializedError ? { error: serializedError } : {}),
  };

  const line = JSON.stringify(payload);

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
    data: context,
  });

  if (level === "error") {
    if (typeof error !== "undefined") {
      Sentry.captureException(error, {
        tags: {
          surface: "mobile",
          event,
        },
        extra: context,
      });
      return;
    }

    Sentry.captureMessage(event, {
      level: "error",
      tags: {
        surface: "mobile",
      },
      extra: context,
    });
    return;
  }

  if (level === "warn") {
    Sentry.captureMessage(event, {
      level: "warning",
      tags: {
        surface: "mobile",
      },
      extra: context,
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
    tracesSampleRate: 0.2,
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
