import type { GenerateSummaryForDayResult } from "@/lib/types/dashboard";

function redactPotentialSecrets(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-[redacted]")
    .replace(/(api key provided\s*:?\s*)[A-Za-z0-9_*.-]+/gi, "$1[redacted]");
}

export function getSummaryGenerationErrorMessage(error: unknown): string {
  const fallback = "Failed to generate summary. Please try again.";
  if (!(error instanceof Error) || !error.message) return fallback;

  const rawMessage = error.message;
  const noDataSignature =
    "No memories, day metadata, or integration sync data found for this date";

  if (rawMessage.includes(noDataSignature)) {
    return "Add at least one memory, day note/rating/tag, or synced integration data before generating a summary.";
  }

  const lines = rawMessage
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const candidate = lines.find(
    (line) =>
      !line.startsWith("[CONVEX ") &&
      !line.startsWith("[Request ID:") &&
      !line.startsWith("Called by client") &&
      !line.startsWith("at handler"),
  );

  if (!candidate) return fallback;

  const cleaned = candidate
    .replace(/^Uncaught Error:\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  const redacted = redactPotentialSecrets(cleaned);

  if (/OpenAI authentication failed \((401|403)\)/i.test(redacted)) {
    return "Summary generation is temporarily unavailable. Please try again later.";
  }

  return redacted || fallback;
}

export function getSummaryGenerationFailureResultMessage(
  result: GenerateSummaryForDayResult,
): string | null {
  if (result.success !== false) return null;

  if (typeof result.message === "string" && result.message.trim()) {
    return result.message.trim();
  }

  return "Failed to generate summary. Please try again.";
}
