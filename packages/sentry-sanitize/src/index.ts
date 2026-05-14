const REDACTED_VALUE = "[REDACTED]";
const TRUNCATED_VALUE = "[TRUNCATED]";
const MAX_STRING_LENGTH = 512;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 6;

/** Keys that may carry credentials, sessions, or long-form user-generated content (journals, notes). */
const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|authorization|cookie|session|api[-_]?key|client[-_]?secret|refresh[-_]?token|access[-_]?token|private[-_]?key|set-cookie|cvv|ssn|social[-_]?security|dsn|journal|reflection|transcript|storytext|memorybody|notebody|daycontent|manualnotes|peopletags|rawentry|caption|plaintext)/i;

const SENSITIVE_QUERY_KEY_PATTERN =
  /(token|secret|password|api[-_]?key|signature|session|code|state|credential)/i;

const SAFE_HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-language",
  "content-language",
  "content-length",
  "content-type",
  "host",
  "origin",
  "referer",
  "traceparent",
  "baggage",
  "user-agent",
  "x-forwarded-for",
  "x-real-ip",
  "x-request-id",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function sanitizeString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_STRING_LENGTH)}...${TRUNCATED_VALUE}`;
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);

    for (const [key] of url.searchParams.entries()) {
      if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, REDACTED_VALUE);
      }
    }

    return sanitizeString(url.toString());
  } catch {
    return sanitizeString(rawUrl);
  }
}

function sanitizeHeaders(
  headers: Record<string, unknown>,
  path: string[],
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const entries = Object.entries(headers).slice(0, MAX_OBJECT_KEYS);

  for (const [key, value] of entries) {
    const normalized = key.toLowerCase();

    if (
      SENSITIVE_KEY_PATTERN.test(normalized) ||
      !SAFE_HEADER_ALLOWLIST.has(normalized)
    ) {
      output[key] = REDACTED_VALUE;
      continue;
    }

    output[key] = sanitizeUnknown(value, [...path, key], depth + 1, seen);
  }

  return output;
}

function sanitizeUnknown(
  value: unknown,
  path: string[],
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value === "undefined") {
    return value;
  }

  const key = path[path.length - 1] ?? "";

  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED_VALUE;
  }

  if (typeof value === "string") {
    if (key.toLowerCase() === "url") {
      return sanitizeUrl(value);
    }

    if (/^bearer\s+/i.test(value)) {
      return REDACTED_VALUE;
    }

    return sanitizeString(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: sanitizeString(value.name),
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }

  if (depth >= MAX_DEPTH) {
    return TRUNCATED_VALUE;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item, index) =>
        sanitizeUnknown(item, [...path, String(index)], depth + 1, seen),
      );
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }

    seen.add(value);

    if (value instanceof URL) {
      return sanitizeUrl(value.toString());
    }

    if (value instanceof Map) {
      const mapped: Record<string, unknown> = {};
      for (const [mapKey, mapValue] of Array.from(value.entries()).slice(
        0,
        MAX_OBJECT_KEYS,
      )) {
        mapped[String(mapKey)] = sanitizeUnknown(
          mapValue,
          [...path, String(mapKey)],
          depth + 1,
          seen,
        );
      }
      return mapped;
    }

    if (value instanceof Set) {
      return Array.from(value.values())
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item, index) =>
          sanitizeUnknown(item, [...path, String(index)], depth + 1, seen),
        );
    }

    if (!isPlainObject(value)) {
      return sanitizeString(String(value));
    }

    if (key.toLowerCase() === "headers") {
      return sanitizeHeaders(value, path, depth, seen);
    }

    const output: Record<string, unknown> = {};
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);

    for (const [entryKey, entryValue] of entries) {
      output[entryKey] = sanitizeUnknown(
        entryValue,
        [...path, entryKey],
        depth + 1,
        seen,
      );
    }

    return output;
  }

  return sanitizeString(String(value));
}

function sanitizeRoot<T>(input: T, path: string): T {
  return sanitizeUnknown(input, [path], 0, new WeakSet<object>()) as T;
}

export function sanitizeObservabilityContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeRoot(context, "context");
}

export function sanitizeSentryEvent<T>(event: T): T {
  const sanitized = sanitizeRoot(event, "event") as unknown;

  if (isPlainObject(sanitized)) {
    const user = sanitized.user;
    if (isPlainObject(user)) {
      sanitized.user = {
        id: typeof user.id === "string" ? user.id : undefined,
      };
    }
  }

  return sanitized as T;
}

export function sanitizeSentryBreadcrumb<T>(breadcrumb: T): T {
  return sanitizeRoot(breadcrumb, "breadcrumb");
}
