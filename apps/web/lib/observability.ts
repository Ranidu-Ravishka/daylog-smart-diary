import * as Sentry from "@sentry/nextjs";

type StructuredContext = Record<string, unknown>;
type LogLevel = "info" | "warn" | "error";

const INFO_EVENT_SAMPLE_RATE_DEFAULT = 0.1;
const INFO_EVENT_MAX_CONTEXT_JSON_LENGTH = 4_000;

const webEnvironment = process.env.NODE_ENV ?? "development";
const durableInfoEventSampleRate = toSampleRate(
  process.env.NEXT_PUBLIC_INFO_EVENT_SAMPLE_RATE,
  INFO_EVENT_SAMPLE_RATE_DEFAULT,
);
const durableInfoEventEndpoint = resolveInfoEventEndpoint(
  process.env.NEXT_PUBLIC_CONVEX_URL,
);

type SerializableError = {
  name: string;
  message: string;
  stack?: string;
};

type StructuredLogEnvelope = {
  schemaVersion: 1;
  app: "daylog";
  surface: "web";
  level: LogLevel;
  event: string;
  timestamp: string;
  context: StructuredContext;
  error?: SerializableError;
};

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

function emitDurableInfoEvent(payload: StructuredLogEnvelope) {
  if (payload.level !== "info") {
    return;
  }

  if (webEnvironment !== "production") {
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
    sourceEnvironment: webEnvironment,
    contextJson: toContextJson(payload.context),
  });

  if (typeof window !== "undefined") {
    void fetch(durableInfoEventEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
      keepalive: true,
    }).catch(() => undefined);
    return;
  }

  void fetch(durableInfoEventEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: requestBody,
  }).catch(() => undefined);
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
    surface: "web",
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
  } else if (process.env.NODE_ENV !== "production") {
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
          surface: "web",
          event,
        },
        extra: context,
      });
      return;
    }

    Sentry.captureMessage(event, {
      level: "error",
      tags: {
        surface: "web",
      },
      extra: context,
    });
    return;
  }

  if (level === "warn") {
    Sentry.captureMessage(event, {
      level: "warning",
      tags: {
        surface: "web",
      },
      extra: context,
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
