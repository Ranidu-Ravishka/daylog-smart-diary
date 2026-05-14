import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
} from "@repo/sentry-sanitize";

type StructuredContext = Record<string, unknown>;
type LogLevel = "info" | "warn" | "error";
type SentryLevel = "info" | "warning" | "error";

const BACKEND_INFO_EVENT_SAMPLE_RATE_DEFAULT = 0.1;
const backendEnvironment = process.env.NODE_ENV ?? "development";
const backendInfoEventSampleRate = toSampleRate(
  process.env.SENTRY_INFO_EVENT_SAMPLE_RATE,
  BACKEND_INFO_EVENT_SAMPLE_RATE_DEFAULT,
);
const backendSentryDsn = process.env.SENTRY_DSN?.trim();
const backendSentryTracesSampleRate = toSampleRate(
  process.env.SENTRY_TRACES_SAMPLE_RATE,
  BACKEND_INFO_EVENT_SAMPLE_RATE_DEFAULT,
);
const BACKEND_SENTRY_MODULE = ["@sentry", "node"].join("/");
const REDACTED = "<redacted>";
const SECRET_KEY_PATTERN =
  /(token|secret|password|authorization|api[-_]?key|cookie)/i;

type SerializableError = {
  name: string;
  message: string;
  stack?: string;
};

type StructuredLogEnvelope = {
  schemaVersion: 1;
  app: "daylog";
  surface: "backend";
  level: LogLevel;
  event: string;
  timestamp: string;
  userId: string | null;
  status: string;
  errorMessage: string | null;
  context: StructuredContext;
  error?: SerializableError;
};

type BackendSentryCaptureContext = {
  level?: SentryLevel;
  tags?: Record<string, string>;
  extra?: StructuredContext;
};

type BackendSentryModule = {
  init: (options: Record<string, unknown>) => void;
  addBreadcrumb: (breadcrumb: {
    category: string;
    message: string;
    level: SentryLevel;
    data: StructuredContext;
  }) => void;
  captureException: (
    error: unknown,
    context?: BackendSentryCaptureContext,
  ) => void;
  captureMessage: (
    message: string,
    context?: BackendSentryCaptureContext,
  ) => void;
};

let backendSentry: BackendSentryModule | null = null;
let backendSentryInitStarted = false;
let backendSentryInitPromise: Promise<void> | null = null;

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
    stack: undefined,
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

function toSafeCorrelationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 120);
}

function ensureCorrelationContext(
  context: StructuredContext,
): StructuredContext {
  const requestId =
    toSafeCorrelationId(context.requestId) ??
    toSafeCorrelationId(context.reqId) ??
    crypto.randomUUID();
  const traceId =
    toSafeCorrelationId(context.traceId) ??
    toSafeCorrelationId(context.sentryTrace) ??
    requestId;
  const userId = resolveUserId(context);
  return {
    ...context,
    requestId,
    traceId,
    userId: userId ?? context.userId ?? null,
  };
}

function sanitizeContext(context: StructuredContext): StructuredContext {
  const next: StructuredContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      next[key] = REDACTED;
      continue;
    }
    if (typeof value === "string" && value.length > 1_200) {
      next[key] = `${value.slice(0, 1_200)}…`;
      continue;
    }
    next[key] = value;
  }
  return next;
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

function toSentryLevel(level: LogLevel): SentryLevel {
  if (level === "warn") {
    return "warning";
  }

  return level;
}

function isKnownUnsupportedBackendSentryRuntimeError(
  serializedError: SerializableError,
): boolean {
  const normalizedMessage = [
    serializedError.name,
    serializedError.message,
    serializedError.stack ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return (
    normalizedMessage.includes("dynamic module import unsupported") ||
    normalizedMessage.includes("dynamic module import is unsupported") ||
    normalizedMessage.includes("dynamic import unsupported") ||
    normalizedMessage.includes("dynamic import callback was not specified")
  );
}

async function ensureBackendSentryInitialized(): Promise<void> {
  if (backendSentryInitStarted) {
    return backendSentryInitPromise ?? Promise.resolve();
  }

  backendSentryInitStarted = true;
  backendSentryInitPromise = (async () => {
    if (!backendSentryDsn) {
      return;
    }

    try {
      const module =
        ((await import(BACKEND_SENTRY_MODULE)) as BackendSentryModule) ?? null;

      if (!module) {
        return;
      }

      module.init({
        dsn: backendSentryDsn,
        environment: backendEnvironment,
        tracesSampleRate: backendSentryTracesSampleRate,
        enabled: true,
        sendDefaultPii: false,
        release:
          process.env.SENTRY_RELEASE?.trim() ||
          process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
          undefined,
        beforeSend: (event: unknown) => sanitizeSentryEvent(event),
        beforeBreadcrumb: (breadcrumb: unknown) =>
          sanitizeSentryBreadcrumb(breadcrumb),
      });

      backendSentry = module;
    } catch (error) {
      backendSentry = null;

      const serializedError = toSerializableError(error);
      // Convex runtime currently rejects dynamic import for user modules.
      if (isKnownUnsupportedBackendSentryRuntimeError(serializedError)) {
        return;
      }

      const fallbackContext: StructuredContext = {
        status: "failed",
        dsnConfigured: Boolean(backendSentryDsn),
      };

      const fallbackPayload: StructuredLogEnvelope = {
        schemaVersion: 1,
        app: "daylog",
        surface: "backend",
        level: "error",
        event: "sentry.init_failed",
        timestamp: new Date().toISOString(),
        userId: null,
        status: "failed",
        errorMessage: serializedError.message,
        context: fallbackContext,
        error: serializedError,
      };

      console.error(JSON.stringify(fallbackPayload));
    }
  })();

  return backendSentryInitPromise;
}

void ensureBackendSentryInitialized();

function emitSentryEvent(
  level: LogLevel,
  event: string,
  error: unknown,
  context: StructuredContext,
  userId: string | null,
  status: string,
  errorMessage: string | null,
) {
  const send = (module: BackendSentryModule) => {
    const extraContext: StructuredContext = {
      ...context,
      userId,
      status,
      errorMessage,
    };

    module.addBreadcrumb({
      category: "observability",
      message: event,
      level: toSentryLevel(level),
      data: extraContext,
    });

    if (level === "error") {
      if (typeof error !== "undefined") {
        module.captureException(error, {
          tags: {
            surface: "backend",
            event,
            status,
          },
          extra: extraContext,
        });
        return;
      }

      module.captureMessage(event, {
        level: "error",
        tags: {
          surface: "backend",
          status,
        },
        extra: extraContext,
      });
      return;
    }

    if (level === "warn") {
      module.captureMessage(event, {
        level: "warning",
        tags: {
          surface: "backend",
          status,
        },
        extra: extraContext,
      });
      return;
    }

    if (
      backendEnvironment === "production" &&
      (isLifecycleEvent(event) || shouldSample(backendInfoEventSampleRate))
    ) {
      module.captureMessage(event, {
        level: "info",
        tags: {
          surface: "backend",
          status,
        },
        extra: extraContext,
      });
    }
  };

  if (backendSentry) {
    send(backendSentry);
    return;
  }

  void ensureBackendSentryInitialized().then(() => {
    if (!backendSentry) {
      return;
    }

    send(backendSentry);
  });
}

function writeStructured(
  level: LogLevel,
  event: string,
  context: StructuredContext = {},
  error?: unknown,
) {
  const correlatedContext = ensureCorrelationContext(context);
  const safeContext = sanitizeContext(correlatedContext);
  const serializedError =
    typeof error === "undefined" ? undefined : toSerializableError(error);
  const userId = resolveUserId(safeContext);
  const status = resolveStatus(level, safeContext);
  const errorMessage = resolveErrorMessage(serializedError, safeContext);

  const payload: StructuredLogEnvelope = {
    schemaVersion: 1,
    app: "daylog",
    surface: "backend",
    level,
    event,
    timestamp: new Date().toISOString(),
    userId,
    status,
    errorMessage,
    context: safeContext,
    ...(serializedError ? { error: serializedError } : {}),
  };

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (backendEnvironment !== "production") {
    console.info(line);
  }

  emitSentryEvent(
    level,
    event,
    error,
    safeContext,
    userId,
    status,
    errorMessage,
  );
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
  writeStructured("error", event, context, error);
}
