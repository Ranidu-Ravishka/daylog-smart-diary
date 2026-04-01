"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import { useConvexAuth, useQuery } from "convex/react";
import { usePaginatedQuery } from "convex/react";

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

  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const metrics = useQuery(
    api.admin.getDashboardMetrics,
    isAdmin ? {} : "skip",
  );

  const healthSummary = useQuery(healthSummaryRef, isAdmin ? {} : "skip") as
    | HealthSummary
    | undefined;

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

            <div className="mt-4 grid gap-4 md:grid-cols-3">
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
