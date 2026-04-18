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
const durableInfoEventIngestToken =
  process.env.NEXT_PUBLIC_OBSERVABILITY_INGEST_TOKEN?.trim() ?? "";
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
  userId: string | null;
  status: string;
  errorMessage: string | null;
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

function buildInfoEventHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Daylog-Ingest-Token": durableInfoEventIngestToken,
  };
}

function emitDurableInfoEvent(payload: StructuredLogEnvelope) {
  if (payload.level !== "info") {
    return;
  }

  if (webEnvironment !== "production") {
    return;
  }

  if (
    !durableInfoEventIngestToken ||
    !durableInfoEventEndpoint ||
    (!isLifecycleEvent(payload.event) &&
      !shouldSample(durableInfoEventSampleRate))
  ) {
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
    contextJson: toContextJson({
      ...payload.context,
      userId: payload.userId,
      status: payload.status,
      errorMessage: payload.errorMessage,
    }),
  });

  if (typeof window !== "undefined") {
    void fetch(durableInfoEventEndpoint, {
      method: "POST",
      headers: buildInfoEventHeaders(),
      body: requestBody,
      keepalive: true,
    }).catch(() => undefined);
    return;
  }

  void fetch(durableInfoEventEndpoint, {
    method: "POST",
    headers: buildInfoEventHeaders(),
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

function writeStructuredLog(
  level: LogLevel,
  event: string,
  context: StructuredContext = {},
  error?: unknown,
) {
  const serializedError =
    typeof error === "undefined" ? undefined : toSerializableError(error);
  const userId = resolveUserId(context);
  const status = resolveStatus(level, context);
  const errorMessage = resolveErrorMessage(serializedError, context);

  const payload: StructuredLogEnvelope = {
    schemaVersion: 1,
    app: "daylog",
    surface: "web",
    level,
    event,
    timestamp: new Date().toISOString(),
    userId,
    status,
    errorMessage,
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
    data: {
      ...context,
      userId,
      status,
      errorMessage,
    },
  });

  if (level === "error") {
    if (typeof error !== "undefined") {
      Sentry.captureException(error, {
        tags: {
          surface: "web",
          event,
          status,
        },
        extra: {
          ...context,
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
        surface: "web",
        status,
      },
      extra: {
        ...context,
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
        surface: "web",
        status,
      },
      extra: {
        ...context,
        userId,
        status,
        errorMessage,
      },
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
