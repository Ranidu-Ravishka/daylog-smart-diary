"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

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

function statusBadge(status: "connected" | "degraded" | "failed") {
  if (status === "connected") {
    return "bg-green-100 text-green-700";
  }

  if (status === "degraded") {
    return "bg-amber-100 text-amber-700";
  }

  return "bg-red-100 text-red-700";
}

function tokenBadge(status: "valid" | "expiring_soon" | "expired" | "unknown") {
  if (status === "valid") {
    return "bg-green-50 text-green-700";
  }

  if (status === "expiring_soon") {
    return "bg-amber-50 text-amber-700";
  }

  if (status === "expired") {
    return "bg-red-50 text-red-700";
  }

  return "bg-gray-100 text-gray-700";
}

export default function IntegrationHealthPage() {
  const listEventsForProviderRef = makeFunctionReference<"query">(
    "integrationHealth:listIntegrationHealthEventsForProvider",
  );

  const { isAuthenticated } = useConvexAuth();
  const [statusFilter, setStatusFilter] = useState<HealthStatusFilter>("all");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const healthRows = useQuery(
    api.integrationHealth.listIntegrationProviderHealth,
    isAdmin ? {} : "skip",
  ) as ProviderHealthRow[] | undefined;

  const {
    results: providerEvents,
    status: providerEventsStatus,
    loadMore,
  } = usePaginatedQuery(
    listEventsForProviderRef,
    isAdmin && selectedProvider
      ? {
          provider: selectedProvider,
        }
      : "skip",
    { initialNumItems: 20 },
  );

  const filteredRows = useMemo(() => {
    if (!healthRows) return [];
    if (statusFilter === "all") return healthRows;
    return healthRows.filter((row) => row.status === statusFilter);
  }, [healthRows, statusFilter]);

  const selectedRow = useMemo(() => {
    if (!selectedProvider || !healthRows) return null;
    return healthRows.find((row) => row.provider === selectedProvider) ?? null;
  }, [selectedProvider, healthRows]);

  const totals = useMemo(() => {
    const rows = healthRows ?? [];
    return {
      connected: rows.filter((row) => row.status === "connected").length,
      degraded: rows.filter((row) => row.status === "degraded").length,
      failed: rows.filter((row) => row.status === "failed").length,
    };
  }, [healthRows]);

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Integration Health
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Provider-level operational status, token validity, and recent
                sync outcomes.
              </p>
            </div>
            <Link
              href="/integrations"
              className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              Back to Integrations
            </Link>
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <HealthCountCard label="Connected" value={totals.connected} />
            <HealthCountCard label="Degraded" value={totals.degraded} />
            <HealthCountCard label="Failed" value={totals.failed} />
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {(["all", "connected", "degraded", "failed"] as const).map(
              (status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${statusFilter === status ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
                >
                  {status}
                </button>
              ),
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              {!healthRows ? (
                <div className="p-6 text-sm text-gray-600">
                  Loading integration health snapshots…
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="p-6 text-sm text-gray-600">
                  No providers match this status filter.
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
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
                    <tbody className="divide-y divide-gray-100">
                      {filteredRows.map((row) => (
                        <tr
                          key={row._id}
                          className={`cursor-pointer hover:bg-gray-50 ${selectedProvider === row.provider ? "bg-blue-50/50" : ""}`}
                          onClick={() => setSelectedProvider(row.provider)}
                        >
                          <td className="px-4 py-3 font-medium text-gray-900">
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
                          <td className="px-4 py-3 text-gray-700">
                            {(row.errorRate * 100).toFixed(0)}%
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {row.lastSyncAt
                              ? new Date(row.lastSyncAt).toLocaleString()
                              : "Never"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-gray-900">
                Provider Detail
              </h2>
              {!selectedProvider || !selectedRow ? (
                <p className="text-sm text-gray-600">
                  Select a provider row to inspect health events.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="text-sm">
                    <p className="text-xs text-gray-500">Provider</p>
                    <p className="font-medium text-gray-900">
                      {selectedRow.provider}
                    </p>
                  </div>
                  <div className="text-sm">
                    <p className="text-xs text-gray-500">Attempts</p>
                    <p className="text-gray-800">
                      {selectedRow.failedSyncAttempts} failed /{" "}
                      {selectedRow.totalSyncAttempts} total
                    </p>
                  </div>
                  <div className="text-sm">
                    <p className="text-xs text-gray-500">Last Failure</p>
                    <p className="text-gray-800">
                      {selectedRow.lastFailureAt
                        ? new Date(selectedRow.lastFailureAt).toLocaleString()
                        : "None"}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-gray-500">
                      Recent Failures
                    </p>
                    {selectedRow.recentFailures.length === 0 ? (
                      <p className="text-sm text-gray-600">
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
                              className="rounded-lg border border-red-100 bg-red-50 p-2"
                            >
                              <p className="text-xs font-medium text-red-700">
                                {new Date(failure.at).toLocaleString()}
                              </p>
                              <p className="mt-0.5 text-xs text-red-700">
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

          <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Recent Health Events
              </h3>
            </div>
            {!selectedProvider ? (
              <div className="p-6 text-sm text-gray-600">
                Select a provider to view event stream.
              </div>
            ) : providerEventsStatus === "LoadingFirstPage" ? (
              <div className="p-6 text-sm text-gray-600">Loading events…</div>
            ) : providerEvents.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">
                No health events for this provider yet.
              </div>
            ) : (
              <>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">
                          Time
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Outcome
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Token
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Latency
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Error
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(providerEvents as HealthEventRow[]).map((event) => (
                        <tr key={event._id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-700">
                            {new Date(event.at).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {event.outcome}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {event.status}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {event.tokenValidityStatus}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {typeof event.latencyMs === "number"
                              ? `${event.latencyMs} ms`
                              : "—"}
                          </td>
                          <td className="max-w-xs px-4 py-3 text-xs text-gray-600">
                            {event.error ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {providerEventsStatus === "CanLoadMore" && (
                  <div className="border-t border-gray-100 p-4">
                    <button
                      onClick={() => loadMore(20)}
                      className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                    >
                      Load more events
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}

function HealthCountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}
