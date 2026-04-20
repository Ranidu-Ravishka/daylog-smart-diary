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
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Memories</h1>
              <p className="text-sm text-gray-500 mt-1">
                Browse, inspect, edit, and remove memory entries.
              </p>
            </div>

            <Link
              href="/memories/create"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Create Memory
            </Link>
          </div>

          {deleteError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {deleteError}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              {memoriesStatus === "LoadingFirstPage" ? (
                <div className="p-6 text-sm text-gray-600">
                  Loading memories…
                </div>
              ) : memories.length === 0 ? (
                <div className="p-6 text-sm text-gray-600">
                  No memories yet.
                </div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600">
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
                          <th className="text-left font-medium px-4 py-3">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {memories.map((row) => (
                          <tr
                            key={row._id}
                            className={`cursor-pointer hover:bg-gray-50 ${selectedId === row._id ? "bg-blue-50/50" : ""}`}
                            onClick={() => setSelectedId(row._id)}
                          >
                            <td className="px-4 py-3 text-gray-900">
                              {row.title}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {row.mood ?? "—"}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-800">
                              {row.dayKey}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {new Date(row.happenedAt).toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                              <Link
                                href={`/memories/edit/${row._id}`}
                                className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
                                onClick={(event) => event.stopPropagation()}
                              >
                                Edit
                              </Link>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDelete(row._id, row.title);
                                }}
                                disabled={isDeletingId === String(row._id)}
                                className="ml-2 inline-flex items-center rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
                              >
                                {isDeletingId === String(row._id)
                                  ? "Deleting…"
                                  : "Delete"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {memoriesStatus === "CanLoadMore" && (
                    <div className="border-t border-gray-100 p-4">
                      <button
                        onClick={() => loadMore(25)}
                        className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                      >
                        Load more memories
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-3">
                Memory Detail
              </h2>
              {!selectedId ? (
                <p className="text-sm text-gray-600">
                  Select a memory row to view full details.
                </p>
              ) : memoryDetail === undefined ? (
                <p className="text-sm text-gray-600">Loading detail…</p>
              ) : memoryDetail === null ? (
                <p className="text-sm text-red-600">Memory not found.</p>
              ) : (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Title</p>
                    <p className="text-gray-900 font-medium">
                      {memoryDetail.title}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Description</p>
                    <p className="text-gray-800 whitespace-pre-wrap">
                      {memoryDetail.description || "—"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-500">Mood</p>
                      <p className="text-gray-800">
                        {memoryDetail.mood || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Day Key</p>
                      <p className="font-mono text-xs text-gray-800">
                        {memoryDetail.dayKey}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Happened At</p>
                    <p className="text-gray-800">
                      {new Date(memoryDetail.happenedAt).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">User ID</p>
                    <p className="font-mono text-xs text-gray-800">
                      {memoryDetail.userId}
                    </p>
                  </div>
                </div>
              )}
              {selectedId && (
                <Link
                  href={`/memories/edit/${selectedId}`}
                  className="mt-4 inline-flex items-center rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  Edit Selected Memory
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
