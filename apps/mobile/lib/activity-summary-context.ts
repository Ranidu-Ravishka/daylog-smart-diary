type ActivityLevel = "active" | "mixed" | "idle";

type ActivitySummaryContext = {
  schemaVersion: number;
  activitySummary: {
    callsCount?: number;
    callDurationMinutes?: number;
    mood?: string;
    moodConfidence?: number;
    activityLevel?: ActivityLevel;
  };
};

export type ActivitySummaryBuildInput = {
  nowMs?: number;
  steps?: number;
  activeMinutes?: number;
  callsCount?: number;
  callDurationMinutes?: number;
  moodAssistanceEnabled?: boolean;
};

export type ActivitySummaryBuildOutput = {
  context: ActivitySummaryContext;
  summary: string;
  signals: string[];
};

function sanitizePositiveNumber(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.round(value);
}

function inferActivityLevel(input: {
  steps?: number;
  activeMinutes?: number;
}): ActivityLevel {
  const steps = sanitizePositiveNumber(input.steps) ?? 0;
  const activeMinutes = sanitizePositiveNumber(input.activeMinutes) ?? 0;

  if (steps >= 7000 || activeMinutes >= 45) {
    return "active";
  }

  if (steps <= 1500 && activeMinutes <= 15) {
    return "idle";
  }

  return "mixed";
}

function inferMood(input: {
  nowMs: number;
  activityLevel: ActivityLevel;
  callsCount?: number;
}): { mood: string; moodConfidence: number } {
  const now = new Date(input.nowMs);
  const hour = now.getHours();

  if (input.callsCount && input.callsCount >= 4) {
    return {
      mood: "social",
      moodConfidence: 0.33,
    };
  }

  if (input.activityLevel === "active") {
    return {
      mood: "energized",
      moodConfidence: 0.34,
    };
  }

  if (hour >= 22 || hour <= 5) {
    return {
      mood: "tired",
      moodConfidence: 0.28,
    };
  }

  if (input.activityLevel === "idle") {
    return {
      mood: "calm",
      moodConfidence: 0.24,
    };
  }

  return {
    mood: "steady",
    moodConfidence: 0.22,
  };
}

export function buildActivitySummaryContext(
  input: ActivitySummaryBuildInput,
): ActivitySummaryBuildOutput {
  const steps = sanitizePositiveNumber(input.steps);
  const activeMinutes = sanitizePositiveNumber(input.activeMinutes);
  const callsCount = sanitizePositiveNumber(input.callsCount);
  const callDurationMinutes = sanitizePositiveNumber(input.callDurationMinutes);

  const activityLevel = inferActivityLevel({
    steps,
    activeMinutes,
  });

  const nowMs = input.nowMs ?? Date.now();
  const inferredMood = input.moodAssistanceEnabled
    ? inferMood({
        nowMs,
        activityLevel,
        callsCount,
      })
    : null;

  const summaryParts: string[] = [];

  if (steps || activeMinutes) {
    summaryParts.push(
      `Activity level appears ${activityLevel}${steps ? ` with ${steps.toLocaleString()} steps` : ""}${activeMinutes ? ` and ${activeMinutes} active minutes` : ""}.`,
    );
  }

  if (callsCount || callDurationMinutes) {
    summaryParts.push(
      `Communication summary: ${callsCount ?? 0} calls, ${callDurationMinutes ?? 0} total call minutes.`,
    );
  }

  if (inferredMood) {
    summaryParts.push(
      `Inferred mood hint: ${inferredMood.mood} (${Math.round(inferredMood.moodConfidence * 100)}% confidence).`,
    );
  }

  const summary =
    summaryParts.length > 0
      ? summaryParts.join(" ")
      : "No additional activity summary context was detected.";

  const signals = [
    `Activity level ${activityLevel}`,
    steps ? `${steps.toLocaleString()} steps` : "No step signal",
    activeMinutes
      ? `${activeMinutes} active minutes`
      : "No active minute signal",
    callsCount ? `${callsCount} calls` : "No call count signal",
    callDurationMinutes
      ? `${callDurationMinutes} call minutes`
      : "No call duration signal",
    inferredMood
      ? `Mood hint ${inferredMood.mood} (${Math.round(inferredMood.moodConfidence * 100)}%)`
      : "Mood inference disabled",
  ];

  return {
    context: {
      schemaVersion: 1,
      activitySummary: {
        callsCount,
        callDurationMinutes,
        mood: inferredMood?.mood,
        moodConfidence: inferredMood?.moodConfidence,
        activityLevel,
      },
    },
    summary,
    signals,
  };
}
