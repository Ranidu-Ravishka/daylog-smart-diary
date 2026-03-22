"use client";

import AdminGuard from "@/components/admin-guard";
import type { IntegrationId } from "@/lib/admin-ids";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { useState } from "react";
import Link from "next/link";

type StatusFilter = "all" | "connected" | "disconnected" | "error";

export default function IntegrationsPage() {
  const listIntegrationsPaginatedRef = makeFunctionReference<"query">(
    "admin:listIntegrationsPaginated",
  );
  const { isAuthenticated } = useConvexAuth();
  const [selectedId, setSelectedId] = useState<IntegrationId | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const {
    results: integrations,
    status: integrationsStatus,
    loadMore,
  } = usePaginatedQuery(
    listIntegrationsPaginatedRef,
    isAdmin
      ? {
          status: statusFilter === "all" ? undefined : statusFilter,
        }
      : "skip",
    { initialNumItems: 25 },
  );
  const selectedIntegration = useQuery(
    api.admin.adminGetIntegration,
    isAdmin && selectedId ? { integrationId: selectedId } : "skip",
  );
  const deleteIntegration = useMutation(api.admin.adminDeleteIntegration);

  const onDelete = async (integrationId: IntegrationId) => {
    setDeleteError(null);
    if (!window.confirm("Delete this integration record?")) return;

    try {
      await deleteIntegration({ integrationId });
      if (selectedId === integrationId) setSelectedId(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Failed to delete integration.",
      );
    }
  };

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Integrations
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                All rows from the <code>integrations</code> table.
              </p>
            </div>

            <Link
              href="/integrations/create"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Create Integration
            </Link>
          </div>

          {deleteError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {deleteError}
            </div>
          )}

          <div className="mb-4 flex flex-wrap gap-2">
            {(
              ["all", "connected", "disconnected", "error"] as StatusFilter[]
            ).map((status) => (
              <button
                key={status}
                onClick={() => {
                  setStatusFilter(status);
                  setSelectedId(null);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${statusFilter === status ? "bg-blue-600 text-white" : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"}`}
              >
                {status}
              </button>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              {integrationsStatus === "LoadingFirstPage" ? (
                <div className="p-6 text-sm text-gray-600">
                  Loading integrations…
                </div>
              ) : integrations.length === 0 ? (
                <div className="p-6 text-sm text-gray-600">
                  No integrations match this filter.
                </div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="text-left font-medium px-4 py-3">
                            Provider
                          </th>
                          <th className="text-left font-medium px-4 py-3">
                            Status
                          </th>
                          <th className="text-left font-medium px-4 py-3">
                            Scopes
                          </th>
                          <th className="text-left font-medium px-4 py-3">
                            Last Sync
                          </th>
                          <th className="text-left font-medium px-4 py-3">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {integrations.map((row) => (
                          <tr
                            key={row._id}
                            className={`cursor-pointer hover:bg-gray-50 ${selectedId === row._id ? "bg-blue-50/50" : ""}`}
                            onClick={() => setSelectedId(row._id)}
                          >
                            <td className="px-4 py-3 text-gray-900">
                              {row.provider}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                  row.status === "connected"
                                    ? "bg-green-100 text-green-700"
                                    : row.status === "error"
                                      ? "bg-red-100 text-red-700"
                                      : "bg-gray-100 text-gray-700"
                                }`}
                              >
                                {row.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600">
                              {row.scopes?.join(", ") ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {row.lastSyncAt
                                ? new Date(row.lastSyncAt).toLocaleString()
                                : "Never"}
                            </td>
                            <td className="px-4 py-3">
                              <Link
                                href={`/integrations/edit/${row._id}`}
                                className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
                                onClick={(event) => event.stopPropagation()}
                              >
                                Edit
                              </Link>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDelete(row._id);
                                }}
                                className="ml-2 inline-flex items-center rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {integrationsStatus === "CanLoadMore" && (
                    <div className="border-t border-gray-100 p-4">
                      <button
                        onClick={() => loadMore(25)}
                        className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                      >
                        Load more integrations
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <h2 className="mb-3 text-base font-semibold text-gray-900">
                Integration Detail
              </h2>
              {!selectedId ? (
                <p className="text-sm text-gray-600">
                  Select an integration to view details.
                </p>
              ) : selectedIntegration === undefined ? (
                <p className="text-sm text-gray-600">Loading detail…</p>
              ) : (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Provider</p>
                    <p className="text-gray-900 font-medium">
                      {selectedIntegration.provider}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Status</p>
                    <p className="text-gray-800">
                      {selectedIntegration.status}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Last Sync</p>
                    <p className="text-gray-800">
                      {selectedIntegration.lastSyncAt
                        ? new Date(
                            selectedIntegration.lastSyncAt,
                          ).toLocaleString()
                        : "Never"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Scopes</p>
                    <p className="text-gray-800">
                      {selectedIntegration.scopes?.join(", ") || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Token Ref</p>
                    <p className="font-mono text-xs text-gray-800">
                      {selectedIntegration.tokenRef || "—"}
                    </p>
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
