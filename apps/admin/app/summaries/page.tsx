"use client";

import AdminGuard from "@/components/admin-guard";
import type { SummaryId } from "@/lib/admin-ids";
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

export default function SummariesPage() {
  const listSummariesPaginatedRef = makeFunctionReference<"query">(
    "admin:listSummariesPaginated",
  );
  const { isAuthenticated } = useConvexAuth();
  const [selectedId, setSelectedId] = useState<SummaryId | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const {
    results: summaries,
    status: summariesStatus,
    loadMore,
  } = usePaginatedQuery(listSummariesPaginatedRef, isAdmin ? {} : "skip", {
    initialNumItems: 25,
  });
  const selectedSummary = useQuery(
    api.admin.adminGetSummary,
    isAdmin && selectedId ? { summaryId: selectedId } : "skip",
  );
  const deleteSummary = useMutation(api.admin.adminDeleteSummary);

  const onDelete = async (summaryId: SummaryId) => {
    setDeleteError(null);
    if (!window.confirm("Delete this summary record?")) return;

    try {
      await deleteSummary({ summaryId });
      if (selectedId === summaryId) setSelectedId(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete summary.",
      );
    }
  };

  return (
    <AdminGuard>
      <PageContainerWide
        title="Day summaries"
        description={
          <>
            All rows from the{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
              daySummaries
            </code>{" "}
            table.
          </>
        }
        action={
          <Button variant="primary" asChild>
            <Link href="/summaries/create">Create summary</Link>
          </Button>
        }
      >
        {deleteError && (
          <div className="mb-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">
            {deleteError}
          </div>
        )}

        <div className="grid min-w-0 max-w-full gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {summariesStatus === "LoadingFirstPage" ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ) : summaries.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No summaries yet.
              </div>
            ) : (
              <>
                <div className="max-w-full overflow-x-auto overscroll-x-contain">
                  <table className="min-w-[860px] w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="text-left font-medium px-4 py-3">
                          Day Key
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Story (preview)
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Highlights
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Generated
                        </th>
                        <th className={tableActionsHeaderClass}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {summaries.map((row) => (
                        <tr
                          key={row._id}
                          className={`cursor-pointer hover:bg-muted/50 ${selectedId === row._id ? "bg-muted/80" : ""}`}
                          onClick={() => setSelectedId(row._id)}
                        >
                          <td className="px-4 py-3 font-mono text-xs text-foreground">
                            {row.dayKey}
                          </td>
                          <td className="max-w-[280px] truncate px-4 py-3 text-foreground">
                            {row.story.length > 80
                              ? `${row.story.slice(0, 80)}...`
                              : row.story}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {row.highlights.length} item(s)
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(row.generatedAt).toLocaleString()}
                          </td>
                          <td className={tableActionsCellClass}>
                            <div className={tableActionsInnerClass}>
                              <Button variant="primary" size="sm" asChild>
                                <Link
                                  href={`/summaries/edit/${row._id}`}
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

                {summariesStatus === "CanLoadMore" && (
                  <div className="border-t border-border p-4">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => loadMore(25)}
                    >
                      Load more summaries
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="min-w-0 max-w-full rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <h2 className="mb-3 text-base font-semibold text-foreground">
              Summary detail
            </h2>
            {!selectedId ? (
              <p className="text-sm text-muted-foreground">
                Select a summary row to inspect details.
              </p>
            ) : selectedSummary === undefined ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4 rounded-md" />
                <Skeleton className="h-4 w-full rounded-md" />
                <Skeleton className="h-20 w-full rounded-md" />
              </div>
            ) : selectedSummary === null ? (
              <p className="text-sm text-muted-foreground">
                Summary not found.
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Day Key</p>
                  <p className="font-mono text-xs text-foreground">
                    {selectedSummary.dayKey}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Generated</p>
                  <p className="text-foreground">
                    {new Date(selectedSummary.generatedAt).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Story</p>
                  <p className="whitespace-pre-wrap text-foreground">
                    {selectedSummary.story}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Highlights</p>
                  {selectedSummary.highlights.length === 0 ? (
                    <p className="text-muted-foreground">No highlights.</p>
                  ) : (
                    <ul className="list-disc space-y-1 pl-5 text-foreground">
                      {selectedSummary.highlights.map((item, idx) => (
                        <li key={`${item}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Sources</p>
                  <p className="wrap-break-word text-foreground">
                    {selectedSummary.sourcesUsed.join(", ") || "—"}
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
