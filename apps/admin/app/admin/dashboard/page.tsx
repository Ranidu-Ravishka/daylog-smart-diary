"use client";

import AdminGuard from "@/components/admin-guard";
import dynamic from "next/dynamic";
import Link from "next/link";
import { memo, useMemo, useState } from "react";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { captureException, logInfo } from "@/lib/observability";

import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const DashboardVolumeChart = dynamic(
  () =>
    import("@/components/dashboard-volume-chart").then(
      (m) => m.DashboardVolumeChart,
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[280px] w-full rounded-2xl" />,
  },
);

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

  const volumeData = useMemo(() => {
    if (!metrics) {
      return [];
    }
    return [
      { name: "Users", value: metrics.totalUsers },
      { name: "Memories", value: metrics.totalMemories },
      { name: "Days", value: metrics.totalDays },
      { name: "Summaries", value: metrics.totalSummaries },
      { name: "Integrations", value: metrics.totalIntegrations },
      { name: "Preferences", value: metrics.totalPreferences },
      { name: "Audit", value: metrics.totalAuditLogs },
    ];
  }, [metrics]);

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
      <PageContainer
        title="Dashboard"
        description="Operational overview of DayLog data and governance surfaces."
      >
        {metrics === undefined ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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

        <Card>
          <CardHeader>
            <CardTitle>Entity volume</CardTitle>
            <p className="text-sm text-muted-foreground ">
              Distribution of primary record counts across the platform.
            </p>
          </CardHeader>
          <CardContent>
            {volumeData.length > 0 ? (
              <DashboardVolumeChart data={volumeData} />
            ) : (
              <Skeleton className="h-[280px] w-full rounded-2xl" />
            )}
          </CardContent>
        </Card>

        <div>
          <h2 className="text-lg font-semibold text-foreground ">
            Maturity layer
          </h2>
          <p className="mt-1 text-sm text-muted-foreground ">
            Observability, governance, and quality workflows.
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

          <Card className="mt-6 scroll-mt-24" id="legacy-unsupported-cleanup">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Legacy unsupported integration cleanup</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground ">
                  Monitors and cleans legacy rows for slack, strava, and
                  todoist.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={cleanupBusy !== null}
                  onClick={() => void executeLegacyCleanup(false)}
                >
                  {cleanupBusy === "soft"
                    ? "Running soft cleanup…"
                    : "Run soft cleanup"}
                </Button>
                <Button
                  type="button"
                  variant="outlineDestructive"
                  size="sm"
                  disabled={cleanupBusy !== null}
                  onClick={() => void executeLegacyCleanup(true)}
                >
                  {cleanupBusy === "hard"
                    ? "Running hard cleanup…"
                    : "Run hard cleanup"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {cleanupStatus ? (
                <div className="rounded-xl border border-border bg-muted px-3 py-2 text-xs text-foreground ">
                  {cleanupStatus}
                </div>
              ) : null}

              {cleanupError ? (
                <div className="rounded-xl border border-foreground/15 bg-muted px-3 py-2 text-xs text-foreground ">
                  {cleanupError}
                </div>
              ) : null}

              {legacyUnsupportedCounts === undefined ? (
                <p className="text-xs text-muted-foreground ">
                  Loading legacy cleanup metrics…
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MiniMetric
                    label="Total legacy rows"
                    value={legacyUnsupportedCounts.totalRows}
                  />
                  <MiniMetric
                    label="Pending cleanup"
                    value={legacyUnsupportedCounts.pendingCleanupRows}
                  />
                  <MiniMetric
                    label="Soft-deleted"
                    value={legacyUnsupportedCounts.softDeletedRows}
                  />
                  <MiniMetric
                    label="Affected users"
                    value={legacyUnsupportedCounts.affectedUsers}
                  />

                  <div className="rounded-xl border border-border bg-muted p-3 text-xs text-foreground sm:col-span-2 lg:col-span-4">
                    <span className="font-medium text-foreground ">
                      By provider:
                    </span>{" "}
                    slack {legacyUnsupportedCounts.rowsByProvider.slack} |
                    strava {legacyUnsupportedCounts.rowsByProvider.strava} |
                    todoist {legacyUnsupportedCounts.rowsByProvider.todoist}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PageContainer>
    </AdminGuard>
  );
}

const MetricCard = memo(function MetricCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-2xl"
    >
      <Card className="h-full transition hover:border-border ">
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground ">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground ">
            {value}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
});

const MaturityCard = memo(function MaturityCard({
  title,
  subtitle,
  href,
}: {
  title: string;
  subtitle: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-2xl"
    >
      <Card className="h-full transition hover:border-border ">
        <CardContent className="p-5">
          <p className="text-sm font-semibold text-foreground ">{title}</p>
          <p className="mt-2 text-xs text-muted-foreground ">{subtitle}</p>
        </CardContent>
      </Card>
    </Link>
  );
});

const MiniMetric = memo(function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted p-3  ">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground ">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground ">
        {value}
      </p>
    </div>
  );
});
