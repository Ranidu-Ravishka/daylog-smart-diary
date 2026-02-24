"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";

export default function SummariesPage() {
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const summaries = useQuery(api.admin.listAllSummaries, isAdmin ? {} : "skip");
  const deleteSummary = useMutation(api.admin.adminDeleteSummary);

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Day Summaries
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                All rows from the <code>daySummaries</code> table.
              </p>
            </div>

            <Link
              href="/summaries/create"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Create Summary
            </Link>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {summaries === undefined ? (
              <div className="p-6 text-sm text-gray-600">Loading...</div>
            ) : summaries.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">No summaries yet.</div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
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
                      <th className="text-left font-medium px-4 py-3">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summaries.map((row) => (
                      <tr key={row._id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-800">
                          {row.dayKey}
                        </td>
                        <td className="px-4 py-3 text-gray-900 max-w-xs truncate">
                          {row.story.length > 80
                            ? `${row.story.slice(0, 80)}...`
                            : row.story}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {row.highlights.length} item(s)
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {new Date(row.generatedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/summaries/edit/${row._id}`}
                            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Are you sure you want to delete this summary?",
                                )
                              ) {
                                deleteSummary({ summaryId: row._id });
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
            )}
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
