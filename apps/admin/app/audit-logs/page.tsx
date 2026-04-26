"use client";

import AdminGuard from "@/components/admin-guard";
import { toEntityId } from "@/lib/admin-ids";
import type { AdminLookupUser } from "@/lib/types/adminQueries";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function AuditLogsPage() {
  const listAuditLogsPaginatedRef = makeFunctionReference<"query">(
    "admin:listAuditLogsPaginated",
  );
  const listUsersByIdsRef = makeFunctionReference<"query">(
    "admin:listUsersByIds",
  );
  const { isAuthenticated } = useConvexAuth();
  const [userFilter, setUserFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const fromTs = startDate
    ? new Date(`${startDate}T00:00:00`).getTime()
    : undefined;
  const toTs = endDate
    ? new Date(`${endDate}T23:59:59.999`).getTime()
    : undefined;

  const {
    results: logs,
    status,
    loadMore,
  } = usePaginatedQuery(
    listAuditLogsPaginatedRef,
    isAdmin
      ? {
          userId: userFilter === "all" ? undefined : userFilter,
          action: actionFilter === "all" ? undefined : actionFilter,
          fromTs,
          toTs,
        }
      : "skip",
    { initialNumItems: 50 },
  );

  const actorUserIds = useMemo(() => {
    if (!logs) return [];
    return [...new Set(logs.map((row) => String(row.actorUserId)))].sort();
  }, [logs]);

  const users = useQuery(
    listUsersByIdsRef,
    isAdmin
      ? {
          userIds: actorUserIds.map((id) => toEntityId<"user">(id)),
        }
      : "skip",
  ) as Array<AdminLookupUser> | undefined;

  const actionOptions = useMemo(() => {
    if (!logs) return [];
    return [...new Set(logs.map((row) => row.action))].sort();
  }, [logs]);

  const userById = useMemo(() => {
    const map = new Map<string, { email: string; clerkUserId: string }>();
    if (!users) return map;
    users.forEach((user) => {
      map.set(String(user._id), {
        email: user.email,
        clerkUserId: user.clerkUserId,
      });
    });
    return map;
  }, [users]);

  return (
    <AdminGuard>
      <PageContainer
        className="max-w-6xl"
        title="Audit logs"
        description={
          <>
            Recent entries from the{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
              auditLogs
            </code>{" "}
            table (read-only).
          </>
        }
      >
        <div className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm md:grid-cols-5">
          <label className="text-xs text-muted-foreground">
            Actor
            <select
              className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={userFilter}
              onChange={(event) => setUserFilter(event.target.value)}
            >
              <option value="all">All actors</option>
              {actorUserIds.map((id) => (
                <option key={id} value={id}>
                  {userById.get(id)?.email || id}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-muted-foreground">
            Action
            <select
              className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
            >
              <option value="all">All actions</option>
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-muted-foreground">
            Start date
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>

          <label className="text-xs text-muted-foreground">
            End date
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>

          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => {
                setUserFilter("all");
                setActionFilter("all");
                setStartDate("");
                setEndDate("");
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>

        <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {status === "LoadingFirstPage" ? (
            <div className="space-y-0 p-4">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="mt-2 h-10 w-full rounded-lg" />
              <Skeleton className="mt-2 h-10 w-full rounded-lg" />
              <Skeleton className="mt-2 h-10 w-full rounded-lg" />
            </div>
          ) : logs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No audit logs match the current filters.
            </div>
          ) : (
            <>
              <div className="max-w-full overflow-x-auto overscroll-x-contain">
                <table className="min-w-[860px] w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">
                        Action
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Target
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Actor (User ID)
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Timestamp
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {logs.map((row) => (
                      <tr key={row._id} className="hover:bg-muted/50">
                        <td className="px-4 py-3 text-foreground">
                          {row.action}
                        </td>
                        <td className="max-w-[180px] px-4 py-3 text-muted-foreground">
                          {row.target ?? "—"}
                        </td>
                        <td className="max-w-[320px] px-4 py-3 font-mono text-xs text-foreground">
                          <div>{String(row.actorUserId)}</div>
                          {userById.get(String(row.actorUserId))?.email && (
                            <div className="text-[11px] text-muted-foreground">
                              {userById.get(String(row.actorUserId))?.email}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(row.at).toLocaleString()}
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
                    onClick={() => loadMore(50)}
                  >
                    Load more audit logs
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
