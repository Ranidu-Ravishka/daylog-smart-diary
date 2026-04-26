"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageContainerWide } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type HealthStatusFilter = "all" | "connected" | "degraded" | "failed";

type ProviderHealthRow = {
  _id: string;
  provider: string;
  status: "connected" | "degraded" | "failed";
  tokenValidityStatus: "valid" | "expiring_soon" | "expired" | "unknown";
  lastSyncAt?: number;
  lastFailureAt?: number;
  totalSyncAttempts: number;
  failedSyncAttempts: number;
  errorRate: number;
  recentFailures: Array<{
    at: number;
    error: string;
    dayKey?: string;
    userId?: string;
  }>;
  updatedAt: number;
};

type HealthEventRow = {
  _id: string;
  outcome: "success" | "error" | "skipped";
  status: "connected" | "degraded" | "failed";
  tokenValidityStatus: "valid" | "expiring_soon" | "expired" | "unknown";
  error?: string;
  latencyMs?: number;
  dayKey?: string;
  at: number;
};

type ProviderHealthSummary = {
  connected: number;
  degraded: number;
  failed: number;
};

function statusBadge(status: "connected" | "degraded" | "failed") {
  if (status === "connected") {
    return "bg-muted text-foreground";
  }

  if (status === "degraded") {
    return "bg-muted/80 text-foreground";
  }

  return "bg-muted font-medium text-foreground ring-1 ring-border";
}

function tokenBadge(status: "valid" | "expiring_soon" | "expired" | "unknown") {
  if (status === "valid") {
    return "bg-muted/70 text-foreground";
  }

  if (status === "expiring_soon") {
    return "bg-muted text-foreground";
  }

  if (status === "expired") {
    return "bg-muted font-medium text-foreground ring-1 ring-border";
  }

  return "bg-muted/50 text-muted-foreground";
}

export default function IntegrationHealthPage() {
  const listProviderHealthRef = makeFunctionReference<"query">(
    "integrationHealth:listIntegrationProviderHealthPaginated",
  );
  const listEventsForProviderRef = makeFunctionReference<"query">(
    "integrationHealth:listIntegrationHealthEventsForProvider",
  );
  const providerHealthSummaryRef = makeFunctionReference<"query">(
    "integrationHealth:getIntegrationHealthSummary",
  );

  const { isAuthenticated } = useConvexAuth();
  const [statusFilter, setStatusFilter] = useState<HealthStatusFilter>("all");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const {
    results: healthRows,
    status: healthRowsStatus,
    loadMore: loadMoreHealthRows,
  } = usePaginatedQuery(
    listProviderHealthRef,
    isAdmin
      ? {
          status: statusFilter === "all" ? undefined : statusFilter,
        }
      : "skip",
    { initialNumItems: 20 },
  );

  const healthSummary = useQuery(
    providerHealthSummaryRef,
    isAdmin ? {} : "skip",
  ) as ProviderHealthSummary | undefined;

  const {
    results: providerEvents,
    status: providerEventsStatus,
    loadMore: loadMoreEvents,
  } = usePaginatedQuery(
    listEventsForProviderRef,
    isAdmin && selectedProvider
      ? {
          provider: selectedProvider,
        }
      : "skip",
    { initialNumItems: 20 },
  );

  const selectedRow = useMemo(() => {
    if (!selectedProvider) return null;
    return (
      (healthRows as ProviderHealthRow[]).find(
        (row) => row.provider === selectedProvider,
      ) ?? null
    );
  }, [selectedProvider, healthRows]);

  const totals = {
    connected: healthSummary?.connected ?? 0,
    degraded: healthSummary?.degraded ?? 0,
    failed: healthSummary?.failed ?? 0,
  };

  return (
    <AdminGuard>
      <PageContainerWide
        title="Integration health"
        description="Provider-level operational status, token validity, and recent sync outcomes."
        action={
          <Button variant="secondary" size="sm" asChild>
            <Link href="/integrations">Back to integrations</Link>
          </Button>
        }
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <HealthCountCard label="Connected" value={totals.connected} />
          <HealthCountCard label="Degraded" value={totals.degraded} />
          <HealthCountCard label="Failed" value={totals.failed} />
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(["all", "connected", "degraded", "failed"] as const).map(
            (status) => (
              <Button
                key={status}
                type="button"
                size="sm"
                variant={statusFilter === status ? "primary" : "secondary"}
                onClick={() => setStatusFilter(status)}
              >
                {status}
              </Button>
            ),
          )}
        </div>

        <div className="grid min-w-0 max-w-full gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {healthRowsStatus === "LoadingFirstPage" ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ) : healthRows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No providers match this status filter.
              </div>
            ) : (
              <>
                <div className="max-w-full overflow-x-auto overscroll-x-contain">
                  <table className="min-w-[820px] w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">
                          Provider
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Token
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Error Rate
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Last Sync
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(healthRows as ProviderHealthRow[]).map((row) => (
                        <tr
                          key={row._id}
                          className={`cursor-pointer hover:bg-muted/50 ${selectedProvider === row.provider ? "bg-muted/80" : ""}`}
                          onClick={() => setSelectedProvider(row.provider)}
                        >
                          <td className="px-4 py-3 font-medium text-foreground">
                            {row.provider}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge(row.status)}`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tokenBadge(row.tokenValidityStatus)}`}
                            >
                              {row.tokenValidityStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-foreground">
                            {(row.errorRate * 100).toFixed(0)}%
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {row.lastSyncAt
                              ? new Date(row.lastSyncAt).toLocaleString()
                              : "Never"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {healthRowsStatus === "CanLoadMore" && (
                  <div className="border-t border-border p-4">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => loadMoreHealthRows(20)}
                    >
                      Load more providers
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="min-w-0 max-w-full rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <h2 className="mb-3 text-base font-semibold text-foreground">
              Provider detail
            </h2>
            {!selectedProvider || !selectedRow ? (
              <p className="text-sm text-muted-foreground">
                Select a provider row to inspect health events.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground">Provider</p>
                  <p className="font-medium text-foreground">
                    {selectedRow.provider}
                  </p>
                </div>
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground">Attempts</p>
                  <p className="text-foreground">
                    {selectedRow.failedSyncAttempts} failed /{" "}
                    {selectedRow.totalSyncAttempts} total
                  </p>
                </div>
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground">Last failure</p>
                  <p className="text-foreground">
                    {selectedRow.lastFailureAt
                      ? new Date(selectedRow.lastFailureAt).toLocaleString()
                      : "None"}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">
                    Recent failures
                  </p>
                  {selectedRow.recentFailures.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No recent failures.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedRow.recentFailures
                        .slice(-5)
                        .reverse()
                        .map((failure) => (
                          <li
                            key={`${failure.at}-${failure.error}`}
                            className="rounded-lg border border-border bg-muted/50 p-2"
                          >
                            <p className="text-xs font-medium text-foreground">
                              {new Date(failure.at).toLocaleString()}
                            </p>
                            <p className="mt-0.5 text-xs text-foreground">
                              {failure.error}
                            </p>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              Recent health events
            </h3>
          </div>
          {!selectedProvider ? (
            <div className="p-6 text-sm text-muted-foreground">
              Select a provider to view event stream.
            </div>
          ) : providerEventsStatus === "LoadingFirstPage" ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full rounded-lg" />
              <Skeleton className="h-8 w-full rounded-lg" />
            </div>
          ) : providerEvents.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No health events for this provider yet.
            </div>
          ) : (
            <>
              <div className="max-w-full overflow-x-auto overscroll-x-contain">
                <table className="min-w-[900px] w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Time</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Outcome
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Token</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Latency
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(providerEvents as HealthEventRow[]).map((event) => (
                      <tr key={event._id} className="hover:bg-muted/50">
                        <td className="px-4 py-3 text-foreground">
                          {new Date(event.at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {event.outcome}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {event.status}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {event.tokenValidityStatus}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {typeof event.latencyMs === "number"
                            ? `${event.latencyMs} ms`
                            : "—"}
                        </td>
                        <td className="max-w-[240px] wrap-break-word px-4 py-3 text-xs text-muted-foreground">
                          {event.error ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {providerEventsStatus === "CanLoadMore" && (
                <div className="border-t border-border p-4">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => loadMoreEvents(20)}
                  >
                    Load more events
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </PageContainerWide>
    </AdminGuard>
  );
}

function HealthCountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
