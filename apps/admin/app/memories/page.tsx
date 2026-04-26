"use client";

import AdminGuard from "@/components/admin-guard";
import type { MemoryId } from "@/lib/admin-ids";
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

export default function MemoriesPage() {
  const listMemoriesPaginatedRef = makeFunctionReference<"query">(
    "admin:listMemoriesPaginated",
  );
  const { isAuthenticated } = useConvexAuth();
  const [selectedId, setSelectedId] = useState<MemoryId | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const {
    results: memories,
    status: memoriesStatus,
    loadMore,
  } = usePaginatedQuery(listMemoriesPaginatedRef, isAdmin ? {} : "skip", {
    initialNumItems: 25,
  });
  const memoryDetail = useQuery(
    api.admin.adminGetMemory,
    isAdmin && selectedId ? { memoryId: selectedId } : "skip",
  );
  const deleteMemory = useMutation(api.admin.adminDeleteMemory);

  const onDelete = async (memoryId: MemoryId, title: string) => {
    setDeleteError(null);
    if (!window.confirm(`Delete memory "${title}"? This cannot be undone.`)) {
      return;
    }

    try {
      setIsDeletingId(memoryId);
      await deleteMemory({ memoryId });
      if (selectedId === memoryId) setSelectedId(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete memory.",
      );
    } finally {
      setIsDeletingId(null);
    }
  };

  return (
    <AdminGuard>
      <PageContainerWide
        title="Memories"
        description="Browse, inspect, edit, and remove memory entries."
        action={
          <Button variant="primary" asChild>
            <Link href="/memories/create">Create memory</Link>
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
            {memoriesStatus === "LoadingFirstPage" ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ) : memories.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No memories yet.
              </div>
            ) : (
              <>
                <div className="max-w-full overflow-x-auto overscroll-x-contain">
                  <table className="min-w-[820px] w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="text-left font-medium px-4 py-3">
                          Title
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Mood
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Day Key
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Happened At
                        </th>
                        <th className={tableActionsHeaderClass}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {memories.map((row) => (
                        <tr
                          key={row._id}
                          className={`cursor-pointer hover:bg-muted/50 ${selectedId === row._id ? "bg-muted/80" : ""}`}
                          onClick={() => setSelectedId(row._id)}
                        >
                          <td className="max-w-[220px] truncate px-4 py-3 text-foreground">
                            {row.title}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {row.mood ?? "—"}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-foreground">
                            {row.dayKey}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(row.happenedAt).toLocaleString()}
                          </td>
                          <td className={tableActionsCellClass}>
                            <div className={tableActionsInnerClass}>
                              <Button variant="primary" size="sm" asChild>
                                <Link
                                  href={`/memories/edit/${row._id}`}
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
                                  void onDelete(row._id, row.title);
                                }}
                                disabled={isDeletingId === String(row._id)}
                              >
                                {isDeletingId === String(row._id)
                                  ? "Deleting…"
                                  : "Delete"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {memoriesStatus === "CanLoadMore" && (
                  <div className="border-t border-border p-4">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => loadMore(25)}
                    >
                      Load more memories
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="min-w-0 max-w-full rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-semibold text-foreground mb-3">
              Memory detail
            </h2>
            {!selectedId ? (
              <p className="text-sm text-muted-foreground">
                Select a memory row to view full details.
              </p>
            ) : memoryDetail === undefined ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-2/3 rounded-md" />
                <Skeleton className="h-16 w-full rounded-md" />
              </div>
            ) : memoryDetail === null ? (
              <p className="text-sm text-muted-foreground">Memory not found.</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Title</p>
                  <p className="text-foreground font-medium">
                    {memoryDetail.title}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="text-foreground whitespace-pre-wrap">
                    {memoryDetail.description || "—"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Mood</p>
                    <p className="text-foreground">
                      {memoryDetail.mood || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Day Key</p>
                    <p className="font-mono text-xs text-foreground">
                      {memoryDetail.dayKey}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Happened At</p>
                  <p className="text-foreground">
                    {new Date(memoryDetail.happenedAt).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">User ID</p>
                  <p className="break-all font-mono text-xs text-foreground">
                    {memoryDetail.userId}
                  </p>
                </div>
              </div>
            )}
            {selectedId && (
              <Button variant="primary" size="sm" className="mt-4" asChild>
                <Link href={`/memories/edit/${selectedId}`}>
                  Edit selected memory
                </Link>
              </Button>
            )}
          </div>
        </div>
      </PageContainerWide>
    </AdminGuard>
  );
}
