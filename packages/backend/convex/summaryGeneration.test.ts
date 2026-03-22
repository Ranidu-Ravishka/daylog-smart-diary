import { describe, expect, it } from "vitest";
import {
  OpenAiRequestError,
  isRetryableOpenAiError,
  isRetryableOpenAiStatus,
  normalizeModelOutput,
} from "./summaryGeneration";

describe("summary generation retry behavior", () => {
  it("marks 429 and 5xx statuses as retryable", () => {
    expect(isRetryableOpenAiStatus(429)).toBe(true);
    expect(isRetryableOpenAiStatus(500)).toBe(true);
    expect(isRetryableOpenAiStatus(503)).toBe(true);
  });

  it("marks other 4xx statuses as non-retryable", () => {
    expect(isRetryableOpenAiStatus(400)).toBe(false);
    expect(isRetryableOpenAiStatus(401)).toBe(false);
    expect(isRetryableOpenAiStatus(404)).toBe(false);
  });

  it("treats retryable error types correctly", () => {
    expect(
      isRetryableOpenAiError(new OpenAiRequestError(429, "rate limit", true)),
    ).toBe(true);
    expect(
      isRetryableOpenAiError(new OpenAiRequestError(400, "bad request", false)),
    ).toBe(false);
    expect(isRetryableOpenAiError(new TypeError("network error"))).toBe(true);
    expect(isRetryableOpenAiError(new Error("other error"))).toBe(false);
  });
});

describe("summary generation output normalization", () => {
  it("falls back to safe defaults when payload shape is invalid", () => {
    const output = normalizeModelOutput({
      story: "",
      highlights: ["ok", 1, "  ", "great day"],
      sourcesUsed: ["", "Memories"],
      metrics: {
        steps: Number.NaN,
        sleepMinutes: 450,
        spendingTotal: Infinity,
      },
    });

    expect(output.story).toContain("meaningful day");
    expect(output.highlights).toEqual(["ok", "great day"]);
    expect(output.sourcesUsed).toEqual(["Memories"]);
    expect(output.metrics).toEqual({
      steps: undefined,
      sleepMinutes: 450,
      screenTimeMinutes: undefined,
      spendingTotal: undefined,
    });
  });

  it("supplies default sources when none are provided", () => {
    const output = normalizeModelOutput({
      story: "A short story",
      highlights: [],
      sourcesUsed: [],
    });

    expect(output.sourcesUsed).toEqual([
      "Memories",
      "Day metadata",
      "OpenAI GPT-4o",
    ]);
  });
});
