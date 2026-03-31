import type { MutationCtx, QueryCtx } from "./_generated/server";

const DASHBOARD_METRICS_KEY = "global";

export type DashboardMetricsSnapshot = {
  totalUsers: number;
  totalMemories: number;
  totalDays: number;
  totalSummaries: number;
  totalIntegrations: number;
  totalPreferences: number;
  totalAuditLogs: number;
};

export type DashboardMetricsDelta = Partial<DashboardMetricsSnapshot>;

const DELTA_FIELDS: Array<keyof DashboardMetricsSnapshot> = [
  "totalUsers",
  "totalMemories",
  "totalDays",
  "totalSummaries",
  "totalIntegrations",
  "totalPreferences",
  "totalAuditLogs",
];

function clampCounter(value: number): number {
  return value < 0 ? 0 : value;
}

function hasNonZeroDelta(delta: DashboardMetricsDelta): boolean {
  return DELTA_FIELDS.some((field) => {
    const value = delta[field];
    return typeof value === "number" && value !== 0;
  });
}

function emptySnapshot(): DashboardMetricsSnapshot {
  return {
    totalUsers: 0,
    totalMemories: 0,
    totalDays: 0,
    totalSummaries: 0,
    totalIntegrations: 0,
    totalPreferences: 0,
    totalAuditLogs: 0,
  };
}

function normalizeSnapshot(
  source: DashboardMetricsSnapshot,
): DashboardMetricsSnapshot {
  return {
    totalUsers: clampCounter(source.totalUsers),
    totalMemories: clampCounter(source.totalMemories),
    totalDays: clampCounter(source.totalDays),
    totalSummaries: clampCounter(source.totalSummaries),
    totalIntegrations: clampCounter(source.totalIntegrations),
    totalPreferences: clampCounter(source.totalPreferences),
    totalAuditLogs: clampCounter(source.totalAuditLogs),
  };
}

function applyDelta(
  baseline: DashboardMetricsSnapshot,
  delta: DashboardMetricsDelta,
): DashboardMetricsSnapshot {
  const next: DashboardMetricsSnapshot = { ...baseline };

  for (const field of DELTA_FIELDS) {
    const change = delta[field] ?? 0;
    next[field] = clampCounter(next[field] + change);
  }

  return next;
}

async function getMetricsDocs(db: QueryCtx["db"] | MutationCtx["db"]) {
  return await db
    .query("adminDashboardMetrics")
    .withIndex("by_key", (q) => q.eq("key", DASHBOARD_METRICS_KEY))
    .collect();
}

function pickCanonicalDoc<T extends { _id: string; updatedAt: number }>(
  docs: T[],
): T {
  return docs.reduce((latest, current) =>
    current.updatedAt > latest.updatedAt ? current : latest,
  );
}

export async function getDashboardMetricsSnapshot(
  db: QueryCtx["db"] | MutationCtx["db"],
): Promise<DashboardMetricsSnapshot> {
  const docs = await getMetricsDocs(db);
  if (docs.length === 0) return emptySnapshot();

  const doc = pickCanonicalDoc(docs);

  return normalizeSnapshot({
    totalUsers: doc.totalUsers,
    totalMemories: doc.totalMemories,
    totalDays: doc.totalDays,
    totalSummaries: doc.totalSummaries,
    totalIntegrations: doc.totalIntegrations,
    totalPreferences: doc.totalPreferences,
    totalAuditLogs: doc.totalAuditLogs,
  });
}

export async function applyDashboardMetricsDelta(
  db: MutationCtx["db"],
  delta: DashboardMetricsDelta,
): Promise<DashboardMetricsSnapshot> {
  if (!hasNonZeroDelta(delta)) {
    return await getDashboardMetricsSnapshot(db);
  }

  const now = Date.now();
  const docs = await getMetricsDocs(db);
  const existing = docs.length > 0 ? pickCanonicalDoc(docs) : null;
  const baseline = existing
    ? normalizeSnapshot({
        totalUsers: existing.totalUsers,
        totalMemories: existing.totalMemories,
        totalDays: existing.totalDays,
        totalSummaries: existing.totalSummaries,
        totalIntegrations: existing.totalIntegrations,
        totalPreferences: existing.totalPreferences,
        totalAuditLogs: existing.totalAuditLogs,
      })
    : emptySnapshot();

  const next = applyDelta(baseline, delta);

  if (existing) {
    for (const doc of docs) {
      if (doc._id !== existing._id) {
        await db.delete(doc._id);
      }
    }

    await db.patch(existing._id, {
      ...next,
      updatedAt: now,
    });
    return next;
  }

  await db.insert("adminDashboardMetrics", {
    key: DASHBOARD_METRICS_KEY,
    ...next,
    updatedAt: now,
  });

  return next;
}

export async function replaceDashboardMetricsSnapshot(
  db: MutationCtx["db"],
  snapshot: DashboardMetricsSnapshot,
): Promise<DashboardMetricsSnapshot> {
  const normalized = normalizeSnapshot(snapshot);
  const now = Date.now();
  const docs = await getMetricsDocs(db);
  const existing = docs.length > 0 ? pickCanonicalDoc(docs) : null;

  if (existing) {
    for (const doc of docs) {
      if (doc._id !== existing._id) {
        await db.delete(doc._id);
      }
    }

    await db.patch(existing._id, {
      ...normalized,
      updatedAt: now,
    });
    return normalized;
  }

  await db.insert("adminDashboardMetrics", {
    key: DASHBOARD_METRICS_KEY,
    ...normalized,
    updatedAt: now,
  });

  return normalized;
}
