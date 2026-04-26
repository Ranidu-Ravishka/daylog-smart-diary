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
import Link from "next/link";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  tableActionsCellClass,
  tableActionsHeaderClass,
  tableActionsInnerClass,
} from "@/lib/table-actions";

export default function DaysPage() {
  const listDaysPaginatedRef = makeFunctionReference<"query">(
    "admin:listDaysPaginated",
  );
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const {
    results: days,
    status,
    loadMore,
  } = usePaginatedQuery(listDaysPaginatedRef, isAdmin ? {} : "skip", {
    initialNumItems: 25,
  });
  const deleteDay = useMutation(api.admin.adminDeleteDay);

  return (
    <AdminGuard>
      <PageContainer
        title="Days"
        description={
          <>
            All rows from the{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
              days
            </code>{" "}
            table.
          </>
        }
        action={
          <Button variant="primary" asChild>
            <Link href="/days/create">Create day</Link>
          </Button>
        }
      >
        <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {status === "LoadingFirstPage" ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : days.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No days yet.
            </div>
          ) : (
            <>
              <div className="max-w-full overflow-x-auto overscroll-x-contain">
                <table className="min-w-[760px] w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">
                        Day Key
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Rating
                      </th>
                      <th className="text-left font-medium px-4 py-3">Notes</th>
                      <th className="text-left font-medium px-4 py-3">
                        Created
                      </th>
                      <th className={tableActionsHeaderClass}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {days.map((row) => (
                      <tr key={row._id} className="hover:bg-muted/50">
                        <td className="px-4 py-3 font-mono text-xs text-foreground">
                          {row.dayKey}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {row.rating ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {row.manualNotes?.length ?? 0} note(s)
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(row._creationTime).toLocaleString()}
                        </td>
                        <td className={tableActionsCellClass}>
                          <div className={tableActionsInnerClass}>
                            <Button variant="primary" size="sm" asChild>
                              <Link href={`/days/edit/${row._id}`}>Edit</Link>
                            </Button>
                            <Button
                              type="button"
                              variant="outlineDestructive"
                              size="sm"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Are you sure you want to delete this day?",
                                  )
                                ) {
                                  void deleteDay({ dayId: row._id });
                                }
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

              {status === "CanLoadMore" && (
                <div className="border-t border-border p-4">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => loadMore(25)}
                  >
                    Load more days
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </PageContainer>
    </AdminGuard>
  );
}
