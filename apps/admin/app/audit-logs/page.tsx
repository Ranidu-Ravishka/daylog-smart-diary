"use client";

import AdminGuard from "@/components/admin-guard";
import { toEntityId } from "@/lib/admin-ids";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { useMemo, useState } from "react";

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
  ) as Array<{ _id: string; email: string; clerkUserId: string }> | undefined;

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
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Audit Logs
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Recent entries from the <code>auditLogs</code> table
                (read-only).
              </p>
            </div>
          </div>

          <div className="mb-4 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-5">
            <label className="text-xs text-gray-600">
              Actor
              <select
                className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
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

            <label className="text-xs text-gray-600">
              Action
              <select
                className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
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

            <label className="text-xs text-gray-600">
              Start date
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>

            <label className="text-xs text-gray-600">
              End date
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>

            <div className="flex items-end">
              <button
                onClick={() => {
                  setUserFilter("all");
                  setActionFilter("all");
                  setStartDate("");
                  setEndDate("");
                }}
                className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Clear Filters
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {status === "LoadingFirstPage" ? (
              <div className="p-6 text-sm text-gray-600">
                Loading audit logs…
              </div>
            ) : logs.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">
                No audit logs match the current filters.
              </div>
            ) : (
              <>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
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
                    <tbody className="divide-y divide-gray-100">
                      {logs.map((row) => (
                        <tr key={row._id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-900">
                            {row.action}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {row.target ?? "—"}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-800">
                            <div>{String(row.actorUserId)}</div>
                            {userById.get(String(row.actorUserId))?.email && (
                              <div className="text-[11px] text-gray-500">
                                {userById.get(String(row.actorUserId))?.email}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {new Date(row.at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {status === "CanLoadMore" && (
                  <div className="border-t border-gray-100 p-4">
                    <button
                      onClick={() => loadMore(50)}
                      className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                    >
                      Load more audit logs
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
