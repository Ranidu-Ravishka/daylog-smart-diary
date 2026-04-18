export type IntegrationDailyMetrics = {
  steps?: number;
  sleepMinutes?: number;
  screenTimeMinutes?: number;
  spendingTotal?: number;
};

export type IntegrationLocationStayPoint = {
  label: string;
  startedAt: number;
  endedAt: number;
  durationMinutes: number;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
};

export type IntegrationDailyContext = {
  schemaVersion?: number;
  location?: {
    mode: "foreground" | "background_controlled";
    totalTrackedMinutes?: number;
    totalDistanceMeters?: number;
    stayPoints?: IntegrationLocationStayPoint[];
  };
  fitness?: {
    steps?: number;
    distanceMeters?: number;
    activeMinutes?: number;
    idleMinutes?: number;
    source?: string;
  };
  calendar?: {
    meetingsCount?: number;
    busyMinutes?: number;
    remindersCount?: number;
    eventTitles?: string[];
  };
  activitySummary?: {
    callsCount?: number;
    callDurationMinutes?: number;
    mood?: string;
    moodConfidence?: number;
    activityLevel?: "active" | "mixed" | "idle";
  };
};

export type IntegrationContextAggregateRow = {
  provider: string;
  metrics?: IntegrationDailyMetrics;
  summary?: string;
  signals?: string[];
  context?: IntegrationDailyContext;
  syncedAt: number;
};

export type IntegrationContextAggregateSyncRun = {
  provider: string;
  status: "in_progress" | "success" | "error";
  updatedAt: number;
  lastError?: string;
};

function sanitizeNonNegativeNumber(
  value: number | undefined,
  maxValue: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return undefined;
  return Math.min(value, maxValue);
}

function toRounded(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sanitizeLatitude(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < -90 || value > 90) return undefined;
  return toRounded(value, 2);
}

function sanitizeLongitude(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < -180 || value > 180) return undefined;
  return toRounded(value, 2);
}

function sanitizeLocationMode(
  mode: string | undefined,
): "foreground" | "background_controlled" {
  return mode === "background_controlled"
    ? "background_controlled"
    : "foreground";
}

function toWholeMinutesLabel(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (remainder === 0) return `${hours}h`;
    return `${hours}h ${remainder}m`;
  }

  return `${minutes}m`;
}

function maxDefined(
  current: number | undefined,
  incoming: number | undefined,
): number | undefined {
  if (incoming === undefined) return current;
  if (current === undefined) return incoming;
  return Math.max(current, incoming);
}

export function sanitizeSignals(signals: string[] | undefined) {
  return (signals ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function sanitizeSummaryText(
  value: string | undefined,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const next = value.trim();
  if (!next) return undefined;
  return next.slice(0, 400);
}

export function sanitizeSignalText(value: string): string {
  return value.trim().slice(0, 160);
}

export function sanitizeContext(
  context: IntegrationDailyContext | undefined,
): IntegrationDailyContext | undefined {
  if (!context) return undefined;

  const locationStayPoints: IntegrationLocationStayPoint[] = [];
  for (const point of context.location?.stayPoints ?? []) {
    const label = sanitizeSummaryText(point.label)?.slice(0, 100);
    const startedAt = sanitizeNonNegativeNumber(point.startedAt, 1e16);
    const endedAt = sanitizeNonNegativeNumber(point.endedAt, 1e16);
    const durationMinutes = sanitizeNonNegativeNumber(
      point.durationMinutes,
      24 * 60,
    );

    if (!label || startedAt === undefined || endedAt === undefined) {
      continue;
    }

    if (endedAt < startedAt) {
      continue;
    }

    const normalized: IntegrationLocationStayPoint = {
      label,
      startedAt,
      endedAt,
      durationMinutes:
        durationMinutes ??
        Math.max(1, Math.round((endedAt - startedAt) / 60000)),
    };

    const latitude = sanitizeLatitude(point.latitude);
    const longitude = sanitizeLongitude(point.longitude);
    const radiusMeters = sanitizeNonNegativeNumber(point.radiusMeters, 5_000);

    if (latitude !== undefined) {
      normalized.latitude = latitude;
    }

    if (longitude !== undefined) {
      normalized.longitude = longitude;
    }

    if (radiusMeters !== undefined) {
      normalized.radiusMeters = radiusMeters;
    }

    locationStayPoints.push(normalized);

    if (locationStayPoints.length >= 24) {
      break;
    }
  }

  const location = context.location
    ? {
        mode: sanitizeLocationMode(context.location.mode),
        totalTrackedMinutes: sanitizeNonNegativeNumber(
          context.location.totalTrackedMinutes,
          24 * 60,
        ),
        totalDistanceMeters: sanitizeNonNegativeNumber(
          context.location.totalDistanceMeters,
          300_000,
        ),
        stayPoints:
          locationStayPoints.length > 0 ? locationStayPoints : undefined,
      }
    : undefined;

  const fitness = context.fitness
    ? {
        steps: sanitizeNonNegativeNumber(context.fitness.steps, 200_000),
        distanceMeters: sanitizeNonNegativeNumber(
          context.fitness.distanceMeters,
          300_000,
        ),
        activeMinutes: sanitizeNonNegativeNumber(
          context.fitness.activeMinutes,
          24 * 60,
        ),
        idleMinutes: sanitizeNonNegativeNumber(
          context.fitness.idleMinutes,
          24 * 60,
        ),
        source: sanitizeSummaryText(context.fitness.source)?.slice(0, 64),
      }
    : undefined;

  const calendarEventTitles = (context.calendar?.eventTitles ?? [])
    .map((title) => sanitizeSummaryText(title)?.slice(0, 100))
    .filter((value): value is string => Boolean(value))
    .slice(0, 10);

  const calendar = context.calendar
    ? {
        meetingsCount: sanitizeNonNegativeNumber(
          context.calendar.meetingsCount,
          100,
        ),
        busyMinutes: sanitizeNonNegativeNumber(
          context.calendar.busyMinutes,
          1440,
        ),
        remindersCount: sanitizeNonNegativeNumber(
          context.calendar.remindersCount,
          200,
        ),
        eventTitles:
          calendarEventTitles.length > 0 ? calendarEventTitles : undefined,
      }
    : undefined;

  const moodConfidence = context.activitySummary?.moodConfidence;
  const activitySummary = context.activitySummary
    ? {
        callsCount: sanitizeNonNegativeNumber(
          context.activitySummary.callsCount,
          200,
        ),
        callDurationMinutes: sanitizeNonNegativeNumber(
          context.activitySummary.callDurationMinutes,
          24 * 60,
        ),
        mood: sanitizeSummaryText(context.activitySummary.mood)?.slice(0, 32),
        moodConfidence:
          typeof moodConfidence === "number" &&
          Number.isFinite(moodConfidence) &&
          moodConfidence >= 0 &&
          moodConfidence <= 1
            ? toRounded(moodConfidence, 2)
            : undefined,
        activityLevel:
          context.activitySummary.activityLevel === "active" ||
          context.activitySummary.activityLevel === "mixed" ||
          context.activitySummary.activityLevel === "idle"
            ? context.activitySummary.activityLevel
            : undefined,
      }
    : undefined;

  const normalized: IntegrationDailyContext = {
    schemaVersion: 1,
    location,
    fitness,
    calendar,
    activitySummary,
  };

  if (
    !normalized.location &&
    !normalized.fitness &&
    !normalized.calendar &&
    !normalized.activitySummary
  ) {
    return undefined;
  }

  return normalized;
}

export function sanitizeMetrics(
  metrics: IntegrationDailyMetrics | undefined,
): IntegrationDailyMetrics | undefined {
  if (!metrics) return undefined;

  const normalized: IntegrationDailyMetrics = {
    steps: sanitizeNonNegativeNumber(metrics.steps, 200_000),
    sleepMinutes: sanitizeNonNegativeNumber(metrics.sleepMinutes, 24 * 60),
    screenTimeMinutes: sanitizeNonNegativeNumber(
      metrics.screenTimeMinutes,
      24 * 60,
    ),
    spendingTotal: sanitizeNonNegativeNumber(metrics.spendingTotal, 1_000_000),
  };

  if (Object.values(normalized).every((value) => value === undefined)) {
    return undefined;
  }

  return normalized;
}

export function buildIntegrationContextAggregate(args: {
  dayKey: string;
  rows: IntegrationContextAggregateRow[];
  syncRuns: IntegrationContextAggregateSyncRun[];
}) {
  const latestSyncRunByProvider = new Map<
    string,
    {
      provider: string;
      status: "in_progress" | "success" | "error";
      updatedAt: number;
      lastError?: string;
    }
  >();

  for (const run of args.syncRuns) {
    const existing = latestSyncRunByProvider.get(run.provider);
    if (!existing || run.updatedAt >= existing.updatedAt) {
      latestSyncRunByProvider.set(run.provider, run);
    }
  }

  const degradedProviders = [...latestSyncRunByProvider.values()]
    .filter((run) => run.status === "error")
    .map((run) => ({
      provider: run.provider,
      lastError: run.lastError,
      updatedAt: run.updatedAt,
    }));

  const pendingProviders = [...latestSyncRunByProvider.values()]
    .filter((run) => run.status === "in_progress")
    .map((run) => ({
      provider: run.provider,
      updatedAt: run.updatedAt,
    }));

  const providers = Array.from(new Set(args.rows.map((row) => row.provider)));

  let steps: number | undefined;
  let sleepMinutes: number | undefined;
  let screenTimeMinutes: number | undefined;
  let spendingTotal = 0;

  let distanceMeters: number | undefined;
  let activeMinutes: number | undefined;
  let idleMinutes: number | undefined;

  let meetingsCount = 0;
  let busyMinutes = 0;
  let remindersCount = 0;

  let callsCount = 0;
  let callDurationMinutes = 0;

  const locationStayPoints: IntegrationLocationStayPoint[] = [];
  let locationTrackedMinutes = 0;
  let locationDistanceMeters = 0;

  const activityLevelCounts: Record<"active" | "mixed" | "idle", number> = {
    active: 0,
    mixed: 0,
    idle: 0,
  };

  let preferredMood: string | undefined;
  let preferredMoodConfidence = -1;

  const mergedSignals: string[] = [];

  for (const row of args.rows) {
    steps = maxDefined(steps, row.metrics?.steps);
    sleepMinutes = maxDefined(sleepMinutes, row.metrics?.sleepMinutes);
    screenTimeMinutes = maxDefined(
      screenTimeMinutes,
      row.metrics?.screenTimeMinutes,
    );

    if (typeof row.metrics?.spendingTotal === "number") {
      spendingTotal += row.metrics.spendingTotal;
    }

    for (const signal of row.signals ?? []) {
      const cleaned = sanitizeSignalText(signal);
      if (cleaned) {
        mergedSignals.push(cleaned);
      }
    }

    const context = row.context;
    if (!context) continue;

    if (context.location) {
      locationTrackedMinutes += context.location.totalTrackedMinutes ?? 0;
      locationDistanceMeters += context.location.totalDistanceMeters ?? 0;
      for (const stayPoint of context.location.stayPoints ?? []) {
        locationStayPoints.push(stayPoint);
      }
    }

    if (context.fitness) {
      steps = maxDefined(steps, context.fitness.steps);
      distanceMeters = maxDefined(
        distanceMeters,
        context.fitness.distanceMeters,
      );
      activeMinutes = maxDefined(activeMinutes, context.fitness.activeMinutes);
      idleMinutes = maxDefined(idleMinutes, context.fitness.idleMinutes);
    }

    if (context.calendar) {
      meetingsCount += context.calendar.meetingsCount ?? 0;
      busyMinutes += context.calendar.busyMinutes ?? 0;
      remindersCount += context.calendar.remindersCount ?? 0;
    }

    if (context.activitySummary) {
      callsCount += context.activitySummary.callsCount ?? 0;
      callDurationMinutes += context.activitySummary.callDurationMinutes ?? 0;

      const level = context.activitySummary.activityLevel;
      if (level) {
        activityLevelCounts[level] += 1;
      }

      if (
        context.activitySummary.mood &&
        (context.activitySummary.moodConfidence ?? 0) >= preferredMoodConfidence
      ) {
        preferredMood = context.activitySummary.mood;
        preferredMoodConfidence = context.activitySummary.moodConfidence ?? 0;
      }
    }
  }

  const topStayPoints = [...locationStayPoints]
    .sort((a, b) => b.durationMinutes - a.durationMinutes)
    .slice(0, 8);

  const topLocationSummary = topStayPoints
    .slice(0, 3)
    .map(
      (stayPoint) =>
        `${toWholeMinutesLabel(stayPoint.durationMinutes)} at ${stayPoint.label}`,
    );

  const locationSummary =
    topLocationSummary.length > 0
      ? `Spent ${topLocationSummary.join(", ")}.`
      : locationTrackedMinutes > 0
        ? `Tracked coarse location for ${toWholeMinutesLabel(locationTrackedMinutes)}.`
        : undefined;

  const derivedSignals: string[] = [];
  if (locationSummary) {
    derivedSignals.push(locationSummary);
  }
  if (meetingsCount > 0) {
    derivedSignals.push(
      `${meetingsCount} meetings, ${busyMinutes} busy minutes`,
    );
  }
  if (callsCount > 0) {
    derivedSignals.push(
      `${callsCount} calls, ${callDurationMinutes} total call minutes`,
    );
  }

  const activityLevel =
    activityLevelCounts.active >= activityLevelCounts.mixed &&
    activityLevelCounts.active >= activityLevelCounts.idle
      ? activityLevelCounts.active > 0
        ? "active"
        : undefined
      : activityLevelCounts.mixed >= activityLevelCounts.idle
        ? "mixed"
        : "idle";

  return {
    dayKey: args.dayKey,
    providerCount: providers.length,
    providers,
    metrics: {
      steps,
      sleepMinutes,
      screenTimeMinutes,
      spendingTotal:
        spendingTotal > 0 ? Math.round(spendingTotal * 100) / 100 : undefined,
    },
    location: {
      totalTrackedMinutes:
        locationTrackedMinutes > 0 ? locationTrackedMinutes : undefined,
      totalDistanceMeters:
        locationDistanceMeters > 0 ? locationDistanceMeters : undefined,
      stayPoints: topStayPoints,
      humanSummary: locationSummary,
    },
    fitness: {
      steps,
      distanceMeters,
      activeMinutes,
      idleMinutes,
    },
    calendar: {
      meetingsCount: meetingsCount > 0 ? meetingsCount : undefined,
      busyMinutes: busyMinutes > 0 ? busyMinutes : undefined,
      remindersCount: remindersCount > 0 ? remindersCount : undefined,
    },
    activitySummary: {
      callsCount: callsCount > 0 ? callsCount : undefined,
      callDurationMinutes:
        callDurationMinutes > 0 ? callDurationMinutes : undefined,
      mood: preferredMood,
      moodConfidence:
        preferredMoodConfidence >= 0
          ? toRounded(preferredMoodConfidence, 2)
          : undefined,
      activityLevel,
    },
    signals: Array.from(new Set([...mergedSignals, ...derivedSignals])).slice(
      0,
      24,
    ),
    health: {
      isDegraded: degradedProviders.length > 0,
      degradedProviders,
      pendingProviders,
    },
    syncedAtMax: args.rows.reduce(
      (maxValue, row) => Math.max(maxValue, row.syncedAt),
      0,
    ),
  };
}
