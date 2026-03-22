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
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-6xl mx-auto px-6">
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

          {deleteError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {deleteError}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              {summariesStatus === "LoadingFirstPage" ? (
                <div className="p-6 text-sm text-gray-600">
                  Loading summaries…
                </div>
              ) : summaries.length === 0 ? (
                <div className="p-6 text-sm text-gray-600">
                  No summaries yet.
                </div>
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
                          <tr
                            key={row._id}
                            className={`cursor-pointer hover:bg-gray-50 ${selectedId === row._id ? "bg-blue-50/50" : ""}`}
                            onClick={() => setSelectedId(row._id)}
                          >
                            <td className="px-4 py-3 font-mono text-xs text-gray-800">
                              {row.dayKey}
                            </td>
                            <td className="max-w-xs truncate px-4 py-3 text-gray-900">
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

                  {summariesStatus === "CanLoadMore" && (
                    <div className="border-t border-gray-100 p-4">
                      <button
                        onClick={() => loadMore(25)}
                        className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                      >
                        Load more summaries
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <h2 className="mb-3 text-base font-semibold text-gray-900">
                Summary Detail
              </h2>
              {!selectedId ? (
                <p className="text-sm text-gray-600">
                  Select a summary row to inspect details.
                </p>
              ) : selectedSummary === undefined ? (
                <p className="text-sm text-gray-600">Loading detail…</p>
              ) : (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Day Key</p>
                    <p className="font-mono text-xs text-gray-800">
                      {selectedSummary.dayKey}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Generated</p>
                    <p className="text-gray-800">
                      {new Date(selectedSummary.generatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Story</p>
                    <p className="whitespace-pre-wrap text-gray-800">
                      {selectedSummary.story}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Highlights</p>
                    {selectedSummary.highlights.length === 0 ? (
                      <p className="text-gray-600">No highlights.</p>
                    ) : (
                      <ul className="list-disc space-y-1 pl-5 text-gray-800">
                        {selectedSummary.highlights.map((item, idx) => (
                          <li key={`${item}-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Sources</p>
                    <p className="text-gray-800">
                      {selectedSummary.sourcesUsed.join(", ") || "—"}
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
