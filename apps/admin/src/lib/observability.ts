import * as Sentry from "@sentry/nextjs";
import { sanitizeObservabilityContext } from "./sentry-sanitizer";

type StructuredContext = Record<string, unknown>;
type LogLevel = "info" | "warn" | "error";

type SerializableError = {
  name: string;
  message: string;
  stack?: string;
};

type StructuredLogEnvelope = {
  schemaVersion: 1;
  app: "daylog";
  surface: "admin";
  level: LogLevel;
  event: string;
  timestamp: string;
  userId: string | null;
  role: string | null;
  status: string;
  errorMessage: string | null;
  context: StructuredContext;
  error?: SerializableError;
};

const INFO_LOG_SAMPLE_RATE_DEFAULT = 1;

const adminEnvironment =
  process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? "development";
const infoLogSampleRate = toSampleRate(
  process.env.NEXT_PUBLIC_INFO_EVENT_SAMPLE_RATE,
  INFO_LOG_SAMPLE_RATE_DEFAULT,
);

let currentUserId: string | null = null;
let currentUserRole: string | null = null;

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

function resolveUserId(context: StructuredContext): string | null {
  return (
    toStringOrNull(context.userId) ??
    toStringOrNull(context.clerkUserId) ??
    currentUserId
  );
}

function resolveRole(context: StructuredContext): string | null {
  return toStringOrNull(context.role) ?? currentUserRole;
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

function withScopedSentry(
  userId: string | null,
  role: string | null,
  event: string,
  status: string,
  context: StructuredContext,
  errorMessage: string | null,
  run: () => void,
) {
  Sentry.withScope((scope) => {
    if (userId) {
      scope.setUser({ id: userId });
    }

    scope.setTag("surface", "admin");
    scope.setTag("event", event);
    scope.setTag("status", status);
    scope.setTag("environment", adminEnvironment);

    if (role) {
      scope.setTag("admin_role", role);
    }

    scope.setExtras({
      ...context,
      userId,
      role,
      status,
      errorMessage,
    });

    run();
  });
}

function writeStructuredLog(
  level: LogLevel,
  event: string,
  context: StructuredContext = {},
  error?: unknown,
) {
  const safeContext = sanitizeObservabilityContext(context);
  const serializedError =
    typeof error === "undefined" ? undefined : toSerializableError(error);
  const userId = resolveUserId(safeContext);
  const role = resolveRole(safeContext);
  const status = resolveStatus(level, safeContext);
  const errorMessage = resolveErrorMessage(serializedError, safeContext);

  const payload: StructuredLogEnvelope = {
    schemaVersion: 1,
    app: "daylog",
    surface: "admin",
    level,
    event,
    timestamp: new Date().toISOString(),
    userId,
    role,
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
  } else {
    console.info(line);
  }

  if (level !== "info" || shouldSample(infoLogSampleRate)) {
    Sentry.addBreadcrumb({
      category: "observability",
      message: event,
      level: toSentryLevel(level),
      data: {
        ...safeContext,
        userId,
        role,
        status,
        errorMessage,
      },
    });
  }

  if (level === "error") {
    withScopedSentry(
      userId,
      role,
      event,
      status,
      safeContext,
      errorMessage,
      () => {
        if (typeof error !== "undefined") {
          Sentry.captureException(error);
          return;
        }

        Sentry.captureMessage(event, { level: "error" });
      },
    );
    return;
  }

  if (level === "warn") {
    withScopedSentry(
      userId,
      role,
      event,
      status,
      safeContext,
      errorMessage,
      () => {
        Sentry.captureMessage(event, { level: "warning" });
      },
    );
  }
}

export function setSentryUserContext(context: {
  userId?: unknown;
  clerkUserId?: unknown;
  role?: unknown;
}) {
  const userId =
    toStringOrNull(context.userId) ?? toStringOrNull(context.clerkUserId);
  const role = toStringOrNull(context.role);

  currentUserId = userId;
  currentUserRole = role;

  if (userId) {
    Sentry.setUser({ id: userId });
  } else {
    Sentry.setUser(null);
  }

  Sentry.setTag("surface", "admin");
  if (role) {
    Sentry.setTag("admin_role", role);
  } else {
    Sentry.setTag("admin_role", "anonymous");
  }
}

export function clearSentryUserContext() {
  currentUserId = null;
  currentUserRole = null;
  Sentry.setUser(null);
  Sentry.setTag("admin_role", "anonymous");
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
