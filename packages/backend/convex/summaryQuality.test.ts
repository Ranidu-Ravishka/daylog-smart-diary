import { describe, expect, it } from "vitest";
import { evaluateSummaryQuality } from "./summaryQuality";

describe("summary quality evaluation", () => {
  it("marks concise, coherent outputs as healthy", () => {
    const evaluation = evaluateSummaryQuality({
      story:
        "I started the morning with a focused walk and then finished a key project task. In the afternoon, I had two short meetings and wrapped up by planning tomorrow with clear priorities.",
      highlights: [
        "Morning walk before work",
        "Completed project milestone",
        "Planned priorities for tomorrow",
      ],
      sourcesUsed: ["Memories", "Google Calendar"],
    });

    expect(evaluation.lowQuality).toBe(false);
    expect(evaluation.scores.overall).toBeGreaterThan(0.55);
    expect(evaluation.scores.failure).toBe(0);
  });

  it("flags low-quality, duplicated or failing outputs", () => {
    const evaluation = evaluateSummaryQuality({
      story: "Meaningful day. Meaningful day. Meaningful day.",
      highlights: ["Meaningful day", "Meaningful day"],
      sourcesUsed: ["Memories"],
      failureReason: "OpenAI request failed (500)",
    });

    expect(evaluation.lowQuality).toBe(true);
    expect(evaluation.scores.failure).toBeGreaterThanOrEqual(0.8);
    expect(evaluation.flags).toContain("failure_risk");
  });
});
