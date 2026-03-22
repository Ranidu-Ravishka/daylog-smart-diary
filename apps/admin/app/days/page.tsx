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
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Days</h1>
              <p className="text-sm text-gray-500 mt-1">
                All rows from the <code>days</code> table.
              </p>
            </div>

            <Link
              href="/days/create"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Create Day
            </Link>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {status === "LoadingFirstPage" ? (
              <div className="p-6 text-sm text-gray-600">Loading...</div>
            ) : days.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">No days yet.</div>
            ) : (
              <>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="text-left font-medium px-4 py-3">
                          Day Key
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Rating
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Notes
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Created
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {days.map((row) => (
                        <tr key={row._id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-xs text-gray-800">
                            {row.dayKey}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {row.rating ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {row.manualNotes?.length ?? 0} note(s)
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {new Date(row._creationTime).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/days/edit/${row._id}`}
                              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                            >
                              Edit
                            </Link>
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Are you sure you want to delete this day?",
                                  )
                                ) {
                                  deleteDay({ dayId: row._id });
                                }
                              }}
                              className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 ml-2"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {status === "CanLoadMore" && (
                  <div className="border-t border-gray-100 p-4">
                    <button
                      onClick={() => loadMore(25)}
                      className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                    >
                      Load more days
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
