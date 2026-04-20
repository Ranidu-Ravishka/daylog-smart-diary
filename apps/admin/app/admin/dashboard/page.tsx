"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { useState } from "react";
import { captureException, logInfo } from "@/lib/observability";

type HealthSummary = {
  connected: number;
  degraded: number;
  failed: number;
};

type RetentionRun = {
  status: "success" | "error";
  finishedAt: number;
};

type QualityEval = {
  lowQuality: boolean;
};

type TransportHealthSummary = {
  overall: {
    ingestedCount: number;
    estimatedDropRate: number;
    lastReceivedAt: number | null;
  };
};

type LegacyUnsupportedCountSummary = {
  totalRows: number;
  pendingCleanupRows: number;
  softDeletedRows: number;
  affectedUsers: number;
  rowsByProvider: {
    slack: number;
    strava: number;
    todoist: number;
  };
};

type LegacyUnsupportedCleanupResult = {
  force: boolean;
  isDone: boolean;
  matchedRows: number;
  softDeletedRows: number;
  hardDeletedRows: number;
  deletedSecretRows: number;
  deletedSyncRunRows: number;
  affectedUsers: number;
};

export default function AdminDashboardPage() {
  const retentionRunsRef = makeFunctionReference<"query">(
    "retention:listRetentionRunsPaginated",
  );
  const qualityQueueRef = makeFunctionReference<"query">(
    "summaryQuality:listSummaryQualityEvaluationsPaginated",
  );
  const healthSummaryRef = makeFunctionReference<"query">(
    "integrationHealth:getIntegrationHealthSummary",
  );
  const transportHealthRef = makeFunctionReference<"query">(
    "observabilityIngestion:getObservabilityInfoTransportHealth",
  );
  const legacyUnsupportedCountRef = makeFunctionReference<"query">(
    "integrations:adminCountLegacyUnsupportedIntegrations",
  );
  const legacyUnsupportedCleanupRef = makeFunctionReference<"mutation">(
    "integrations:adminCleanupLegacyUnsupportedIntegrations",
  );

  const { isAuthenticated } = useConvexAuth();
  const [cleanupBusy, setCleanupBusy] = useState<"soft" | "hard" | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const runLegacyUnsupportedCleanup = useMutation(legacyUnsupportedCleanupRef);
  const metrics = useQuery(
    api.admin.getDashboardMetrics,
    isAdmin ? {} : "skip",
  );

  const healthSummary = useQuery(healthSummaryRef, isAdmin ? {} : "skip") as
    | HealthSummary
    | undefined;
  const transportHealth = useQuery(
    transportHealthRef,
    isAdmin
      ? {
          windowHours: 24,
        }
      : "skip",
  ) as TransportHealthSummary | undefined;
  const legacyUnsupportedCounts = useQuery(
    legacyUnsupportedCountRef,
    isAdmin ? {} : "skip",
  ) as LegacyUnsupportedCountSummary | undefined;

  const { results: retentionRuns } = usePaginatedQuery(
    retentionRunsRef,
    isAdmin ? {} : "skip",
    { initialNumItems: 1 },
  );

  const { results: lowQualityQueue } = usePaginatedQuery(
    qualityQueueRef,
    isAdmin
      ? {
          onlyLowQuality: true,
        }
      : "skip",
    { initialNumItems: 20 },
  );

  const connectedCount = healthSummary?.connected ?? 0;
  const degradedCount = healthSummary?.degraded ?? 0;
  const failedCount = healthSummary?.failed ?? 0;

  const lastRetentionRun = (retentionRuns as RetentionRun[])[0];
  const lowQualityOpen = (lowQualityQueue as QualityEval[]).filter(
    (row) => row.lowQuality,
  ).length;

  const lastInfoEventAt = transportHealth?.overall.lastReceivedAt;
  const infoTransportDropRate = transportHealth?.overall.estimatedDropRate ?? 0;

  const executeLegacyCleanup = async (force: boolean) => {
    const mode = force ? "hard" : "soft";

    if (force) {
      const confirmed = window.confirm(
        "Force mode permanently deletes legacy unsupported integration rows. Continue?",
      );
      if (!confirmed) {
        return;
      }
    }

    logInfo("admin_legacy_unsupported_cleanup_started", {
      status: "started",
      mode,
    });

    setCleanupError(null);
    setCleanupStatus(null);
    setCleanupBusy(force ? "hard" : "soft");

    try {
      const result = (await runLegacyUnsupportedCleanup({
        force,
      })) as LegacyUnsupportedCleanupResult;

      setCleanupStatus(
        result.force
          ? `Hard cleanup complete: deleted ${result.hardDeletedRows} legacy rows (${result.deletedSecretRows} secrets, ${result.deletedSyncRunRows} sync runs) across ${result.affectedUsers} users.`
          : `Soft cleanup complete: updated ${result.softDeletedRows} legacy rows (${result.deletedSecretRows} secrets, ${result.deletedSyncRunRows} sync runs) across ${result.affectedUsers} users.${result.isDone ? "" : " More rows remain; run again."}`,
      );

      logInfo("admin_legacy_unsupported_cleanup_succeeded", {
        status: "succeeded",
        mode,
        isDone: result.isDone,
        matchedRows: result.matchedRows,
        softDeletedRows: result.softDeletedRows,
        hardDeletedRows: result.hardDeletedRows,
        deletedSecretRows: result.deletedSecretRows,
        deletedSyncRunRows: result.deletedSyncRunRows,
        affectedUsers: result.affectedUsers,
      });
    } catch (error) {
      captureException("admin_legacy_unsupported_cleanup_failed", error, {
        status: "failed",
        mode,
      });
      setCleanupError(
        error instanceof Error
          ? error.message
          : "Legacy cleanup failed unexpectedly.",
      );
    } finally {
      setCleanupBusy(null);
    }
  };

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-5xl mx-auto px-6">
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="mt-2 text-sm text-gray-600">
            Admin overview of all tables.
          </p>

          {metrics === undefined ? (
            <div className="mt-6 text-sm text-gray-500">Loading metrics…</div>
          ) : (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <MetricCard
                label="Users"
                value={metrics.totalUsers}
                href="/users"
              />
              <MetricCard
                label="Memories"
                value={metrics.totalMemories}
                href="/memories"
              />
              <MetricCard label="Days" value={metrics.totalDays} href="/days" />
              <MetricCard
                label="Summaries"
                value={metrics.totalSummaries}
                href="/summaries"
              />
              <MetricCard
                label="Integrations"
                value={metrics.totalIntegrations}
                href="/integrations"
              />
              <MetricCard
                label="Preferences"
                value={metrics.totalPreferences}
                href="/preferences"
              />
              <MetricCard
                label="Audit Logs"
                value={metrics.totalAuditLogs}
                href="/audit-logs"
              />
            </div>
          )}

          <div className="mt-10">
            <h2 className="text-lg font-semibold text-gray-900">
              Maturity Layer
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Operational surfaces for observability, governance, and quality.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <MaturityCard
                title="Integration Health"
                subtitle={`${connectedCount} connected • ${degradedCount} degraded • ${failedCount} failed`}
                href="/integrations/health"
              />
              <MaturityCard
                title="Retention Policies"
                subtitle={
                  lastRetentionRun
                    ? `Last run: ${lastRetentionRun.status} at ${new Date(lastRetentionRun.finishedAt).toLocaleString()}`
                    : "No retention runs yet"
                }
                href="/retention"
              />
              <MaturityCard
                title="Summary Quality Queue"
                subtitle={`Low-quality queue (first page): ${lowQualityOpen}`}
                href="/summaries/quality"
              />
              <MaturityCard
                title="Info Transport Health"
                subtitle={
                  lastInfoEventAt
                    ? `${transportHealth?.overall.ingestedCount ?? 0} ingested / 24h • ${(infoTransportDropRate * 100).toFixed(1)}% est. drop • last ${new Date(lastInfoEventAt).toLocaleString()}`
                    : "No recent info transport events"
                }
                href="/observability/info-events"
              />
            </div>

            <div
              id="legacy-unsupported-cleanup"
              className="mt-6 scroll-mt-24 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Legacy Unsupported Integration Cleanup
                  </h3>
                  <p className="mt-1 text-xs text-gray-600">
                    Monitors and cleans legacy rows for slack, strava, and
                    todoist.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => void executeLegacyCleanup(false)}
                    disabled={cleanupBusy !== null}
                    className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cleanupBusy === "soft"
                      ? "Running Soft Cleanup..."
                      : "Run Soft Cleanup"}
                  </button>
                  <button
                    onClick={() => void executeLegacyCleanup(true)}
                    disabled={cleanupBusy !== null}
                    className="inline-flex items-center rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cleanupBusy === "hard"
                      ? "Running Hard Cleanup..."
                      : "Run Hard Cleanup"}
                  </button>
                </div>
              </div>

              {cleanupStatus ? (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                  {cleanupStatus}
                </div>
              ) : null}

              {cleanupError ? (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {cleanupError}
                </div>
              ) : null}

              {legacyUnsupportedCounts === undefined ? (
                <p className="mt-3 text-xs text-gray-500">
                  Loading legacy cleanup metrics...
                </p>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MiniMetric
                    label="Total Legacy Rows"
                    value={legacyUnsupportedCounts.totalRows}
                  />
                  <MiniMetric
                    label="Pending Cleanup"
                    value={legacyUnsupportedCounts.pendingCleanupRows}
                  />
                  <MiniMetric
                    label="Soft-Deleted"
                    value={legacyUnsupportedCounts.softDeletedRows}
                  />
                  <MiniMetric
                    label="Affected Users"
                    value={legacyUnsupportedCounts.affectedUsers}
                  />

                  <div className="sm:col-span-2 lg:col-span-4 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-700">
                    <span className="font-medium text-gray-900">
                      By Provider:
                    </span>{" "}
                    slack {legacyUnsupportedCounts.rowsByProvider.slack} |
                    strava {legacyUnsupportedCounts.rowsByProvider.strava} |
                    todoist {legacyUnsupportedCounts.rowsByProvider.todoist}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}

function MetricCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <a
      href={href}
      className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 hover:border-blue-300 transition"
    >
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </a>
  );
}

function MaturityCard({
  title,
  subtitle,
  href,
}: {
  title: string;
  subtitle: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-300"
    >
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-2 text-xs text-gray-600">{subtitle}</p>
    </a>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}
