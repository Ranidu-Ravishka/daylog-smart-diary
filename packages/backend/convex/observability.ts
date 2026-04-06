type StructuredContext = Record<string, unknown>;

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
      stack: serialized.stack,
    },
  });
}
