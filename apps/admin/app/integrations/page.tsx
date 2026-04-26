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

import { PageContainerWide } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  tableActionsCellClass,
  tableActionsHeaderClass,
  tableActionsInnerClass,
} from "@/lib/table-actions";

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
      <PageContainerWide
        title="Integrations"
        description={
          <>
            All rows from the{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
              integrations
            </code>{" "}
            table.
          </>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link href="/admin/dashboard#legacy-unsupported-cleanup">
                Legacy cleanup
              </Link>
            </Button>
            <Button variant="primary" asChild>
              <Link href="/integrations/create">Create integration</Link>
            </Button>
          </div>
        }
      >
        {deleteError && (
          <div className="mb-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">
            {deleteError}
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          {(
            ["all", "connected", "disconnected", "error"] as StatusFilter[]
          ).map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={statusFilter === status ? "primary" : "secondary"}
              onClick={() => {
                setStatusFilter(status);
                setSelectedId(null);
              }}
            >
              {status}
            </Button>
          ))}
        </div>

        <div className="grid min-w-0 max-w-full gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {integrationsStatus === "LoadingFirstPage" ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ) : integrations.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No integrations match this filter.
              </div>
            ) : (
              <>
                <div className="max-w-full overflow-x-auto overscroll-x-contain">
                  <table className="min-w-[780px] w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
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
                        <th className={tableActionsHeaderClass}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {integrations.map((row) => (
                        <tr
                          key={row._id}
                          className={`cursor-pointer hover:bg-muted/50 ${selectedId === row._id ? "bg-muted/80" : ""}`}
                          onClick={() => setSelectedId(row._id)}
                        >
                          <td className="max-w-[180px] px-4 py-3 text-foreground sm:max-w-[220px]">
                            {row.provider}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                row.status === "connected"
                                  ? "bg-muted text-foreground"
                                  : row.status === "error"
                                    ? "bg-muted/80 text-foreground"
                                    : "bg-muted/60 text-muted-foreground"
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="max-w-[260px] wrap-break-word px-4 py-3 text-xs text-muted-foreground">
                            {row.scopes?.join(", ") ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {row.lastSyncAt
                              ? new Date(row.lastSyncAt).toLocaleString()
                              : "Never"}
                          </td>
                          <td className={tableActionsCellClass}>
                            <div className={tableActionsInnerClass}>
                              <Button variant="primary" size="sm" asChild>
                                <Link
                                  href={`/integrations/edit/${row._id}`}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  Edit
                                </Link>
                              </Button>
                              <Button
                                type="button"
                                variant="outlineDestructive"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onDelete(row._id);
                                }}
                              >
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {integrationsStatus === "CanLoadMore" && (
                  <div className="border-t border-border p-4">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => loadMore(25)}
                    >
                      Load more integrations
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="min-w-0 max-w-full rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <h2 className="mb-3 text-base font-semibold text-foreground">
              Integration detail
            </h2>
            {!selectedId ? (
              <p className="text-sm text-muted-foreground">
                Select an integration to view details.
              </p>
            ) : selectedIntegration === undefined ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-2/3 rounded-md" />
                <Skeleton className="h-4 w-full rounded-md" />
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Provider</p>
                  <p className="text-foreground font-medium">
                    {selectedIntegration.provider}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="text-foreground">
                    {selectedIntegration.status}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Sync</p>
                  <p className="text-foreground">
                    {selectedIntegration.lastSyncAt
                      ? new Date(
                          selectedIntegration.lastSyncAt,
                        ).toLocaleString()
                      : "Never"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Scopes</p>
                  <p className="wrap-break-word text-foreground">
                    {selectedIntegration.scopes?.join(", ") || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Token Ref</p>
                  <p className="break-all font-mono text-xs text-foreground">
                    {selectedIntegration.tokenRef || "—"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </PageContainerWide>
    </AdminGuard>
  );
}
