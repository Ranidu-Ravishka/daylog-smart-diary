type StayPointDetectionOptions = {
  minStayDurationMinutes?: number;
  maxStayRadiusMeters?: number;
  maxAcceptedAccuracyMeters?: number;
  maxGapMinutesForDistance?: number;
};

export type LocationTrackPoint = {
  latitude: number;
  longitude: number;
  timestampMs: number;
  accuracyMeters?: number;
};

export type LocationStayPoint = {
  label: string;
  startedAt: number;
  endedAt: number;
  durationMinutes: number;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
};

export type LocationContextPayload = {
  schemaVersion: number;
  location: {
    mode: "foreground" | "background_controlled";
    totalTrackedMinutes?: number;
    totalDistanceMeters?: number;
    stayPoints?: LocationStayPoint[];
  };
};

export type LocationContextComputation = {
  context: LocationContextPayload;
  summary: string;
  signals: string[];
};

const DEFAULT_MIN_STAY_DURATION_MINUTES = 15;
const DEFAULT_MAX_STAY_RADIUS_METERS = 120;
const DEFAULT_MAX_ACCEPTED_ACCURACY_METERS = 150;
const DEFAULT_MAX_GAP_MINUTES_FOR_DISTANCE = 45;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineMeters(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): number {
  const earthRadiusMeters = 6_371_000;
  const dLat = toRadians(toLat - fromLat);
  const dLon = toRadians(toLon - fromLon);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) *
      Math.cos(toRadians(toLat)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isValidTrackPoint(point: LocationTrackPoint): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Number.isFinite(point.timestampMs) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

function formatMinutes(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;

    if (remainder === 0) {
      return `${hours}h`;
    }

    return `${hours}h ${remainder}m`;
  }

  return `${minutes}m`;
}

function toAreaLabel(latitude: number, longitude: number): string {
  return `${roundTo(latitude, 2)}, ${roundTo(longitude, 2)}`;
}

function sanitizePoints(
  points: LocationTrackPoint[],
  maxAcceptedAccuracyMeters: number,
): LocationTrackPoint[] {
  return points
    .filter(isValidTrackPoint)
    .filter((point) => {
      if (point.accuracyMeters === undefined) return true;
      if (!Number.isFinite(point.accuracyMeters)) return false;
      return point.accuracyMeters <= maxAcceptedAccuracyMeters;
    })
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

function totalTrackedMinutes(points: LocationTrackPoint[]): number | undefined {
  if (points.length < 2) return undefined;

  const first = points[0]?.timestampMs;
  const last = points[points.length - 1]?.timestampMs;
  if (first === undefined || last === undefined || last <= first) {
    return undefined;
  }

  return Math.max(1, Math.round((last - first) / 60000));
}

function totalDistanceMeters(
  points: LocationTrackPoint[],
  maxGapMinutesForDistance: number,
): number | undefined {
  if (points.length < 2) return undefined;

  const maxGapMs = maxGapMinutesForDistance * 60_000;
  let distance = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;

    const gap = current.timestampMs - previous.timestampMs;
    if (!Number.isFinite(gap) || gap <= 0 || gap > maxGapMs) {
      continue;
    }

    const delta = haversineMeters(
      previous.latitude,
      previous.longitude,
      current.latitude,
      current.longitude,
    );

    // Filter obvious GPS jumps from coarse foreground tracking.
    if (delta <= 5_000) {
      distance += delta;
    }
  }

  if (distance <= 0) return undefined;
  return Math.round(distance);
}

export function detectStayPoints(
  rawPoints: LocationTrackPoint[],
  options: StayPointDetectionOptions = {},
): LocationStayPoint[] {
  const minStayDurationMinutes =
    options.minStayDurationMinutes ?? DEFAULT_MIN_STAY_DURATION_MINUTES;
  const maxStayRadiusMeters =
    options.maxStayRadiusMeters ?? DEFAULT_MAX_STAY_RADIUS_METERS;
  const maxAcceptedAccuracyMeters =
    options.maxAcceptedAccuracyMeters ?? DEFAULT_MAX_ACCEPTED_ACCURACY_METERS;

  const points = sanitizePoints(rawPoints, maxAcceptedAccuracyMeters);
  if (points.length < 2) return [];

  const minStayDurationMs = minStayDurationMinutes * 60_000;
  const stayPoints: LocationStayPoint[] = [];

  let index = 0;
  while (index < points.length - 1) {
    let nextIndex = index + 1;

    while (nextIndex < points.length) {
      const from = points[index];
      const to = points[nextIndex];
      if (!from || !to) break;

      const distance = haversineMeters(
        from.latitude,
        from.longitude,
        to.latitude,
        to.longitude,
      );

      if (distance > maxStayRadiusMeters) {
        break;
      }

      nextIndex += 1;
    }

    const endIndex = Math.max(index, nextIndex - 1);
    const startPoint = points[index];
    const endPoint = points[endIndex];

    if (!startPoint || !endPoint) {
      index += 1;
      continue;
    }

    const durationMs = endPoint.timestampMs - startPoint.timestampMs;
    if (durationMs < minStayDurationMs) {
      index += 1;
      continue;
    }

    const cluster = points.slice(index, endIndex + 1);
    const centroid = cluster.reduce(
      (acc, point) => {
        return {
          latitude: acc.latitude + point.latitude,
          longitude: acc.longitude + point.longitude,
        };
      },
      { latitude: 0, longitude: 0 },
    );

    const latitude = centroid.latitude / cluster.length;
    const longitude = centroid.longitude / cluster.length;

    stayPoints.push({
      label: toAreaLabel(latitude, longitude),
      startedAt: startPoint.timestampMs,
      endedAt: endPoint.timestampMs,
      durationMinutes: Math.max(1, Math.round(durationMs / 60000)),
      latitude: roundTo(latitude, 2),
      longitude: roundTo(longitude, 2),
      radiusMeters: maxStayRadiusMeters,
    });

    index = endIndex + 1;
  }

  return stayPoints;
}

export function buildLocationContextFromPoints(
  rawPoints: LocationTrackPoint[],
  options: StayPointDetectionOptions = {},
): LocationContextComputation {
  const maxAcceptedAccuracyMeters =
    options.maxAcceptedAccuracyMeters ?? DEFAULT_MAX_ACCEPTED_ACCURACY_METERS;
  const maxGapMinutesForDistance =
    options.maxGapMinutesForDistance ?? DEFAULT_MAX_GAP_MINUTES_FOR_DISTANCE;

  const points = sanitizePoints(rawPoints, maxAcceptedAccuracyMeters);
  const stayPoints = detectStayPoints(points, options)
    .sort((a, b) => b.durationMinutes - a.durationMinutes)
    .slice(0, 8);

  const trackedMinutes = totalTrackedMinutes(points);
  const distanceMeters = totalDistanceMeters(points, maxGapMinutesForDistance);

  const summaryParts = stayPoints
    .slice(0, 3)
    .map((stay) => `${formatMinutes(stay.durationMinutes)} at ${stay.label}`);

  const summary =
    summaryParts.length > 0
      ? `Spent ${summaryParts.join(", ")}.`
      : trackedMinutes
        ? `Tracked coarse foreground movement for ${formatMinutes(trackedMinutes)}.`
        : "Recorded a coarse foreground location update.";

  const signals = [
    trackedMinutes
      ? `Foreground location tracked for ${formatMinutes(trackedMinutes)}`
      : "Foreground location tracking active",
    distanceMeters
      ? `Approx ${distanceMeters}m movement`
      : "Low movement detected",
    ...stayPoints
      .slice(0, 3)
      .map(
        (stay) =>
          `Stayed ${formatMinutes(stay.durationMinutes)} near ${stay.label}`,
      ),
  ];

  return {
    context: {
      schemaVersion: 1,
      location: {
        mode: "foreground",
        totalTrackedMinutes: trackedMinutes,
        totalDistanceMeters: distanceMeters,
        stayPoints: stayPoints.length > 0 ? stayPoints : undefined,
      },
    },
    summary,
    signals,
  };
}
