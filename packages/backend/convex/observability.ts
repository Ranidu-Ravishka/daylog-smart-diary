import * as Sentry from "@sentry/node";

type StructuredContext = Record<string, unknown>;

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

let sentryInitialized = false;

function toSerializableError(error: unknown) {
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
    stack: undefined,
  };
}

function initializeSentryIfConfigured() {
  if (sentryInitialized) return;

  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  const tracesSampleRateRaw = process.env.SENTRY_TRACES_SAMPLE_RATE?.trim();
  const tracesSampleRate = tracesSampleRateRaw
    ? Number(tracesSampleRateRaw)
    : DEFAULT_TRACES_SAMPLE_RATE;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: Number.isFinite(tracesSampleRate)
      ? tracesSampleRate
      : DEFAULT_TRACES_SAMPLE_RATE,
  });

  sentryInitialized = true;
}

function writeStructured(
  level: "info" | "warn" | "error",
  event: string,
  context: StructuredContext = {},
) {
  const payload = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...context,
  };

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
}

export function logInfo(event: string, context: StructuredContext = {}) {
  writeStructured("info", event, context);
}

export function logWarn(event: string, context: StructuredContext = {}) {
  writeStructured("warn", event, context);
}

export function logError(event: string, context: StructuredContext = {}) {
  writeStructured("error", event, context);
}

export function captureException(
  event: string,
  error: unknown,
  context: StructuredContext = {},
) {
  const serialized = toSerializableError(error);

  writeStructured("error", event, {
    ...context,
    error: {
      name: serialized.name,
      message: serialized.message,
    },
  });

  initializeSentryIfConfigured();

  if (!sentryInitialized) {
    return;
  }

  const sentryError =
    error instanceof Error ? error : new Error(serialized.message);

  Sentry.captureException(sentryError, {
    tags: {
      event,
    },
    extra: context,
  });
}
