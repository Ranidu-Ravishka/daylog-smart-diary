export function dedupeSignals(signals: string[]): string[] {
  return Array.from(
    new Set(signals.map((signal) => signal.trim()).filter(Boolean)),
  ).slice(0, 24);
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Unknown error";
}
