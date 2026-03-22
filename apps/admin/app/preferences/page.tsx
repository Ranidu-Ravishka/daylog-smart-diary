"use client";

import AdminGuard from "@/components/admin-guard";
import type { PreferenceId } from "@/lib/admin-ids";
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

export default function PreferencesPage() {
  const listUserPreferencesPaginatedRef = makeFunctionReference<"query">(
    "admin:listUserPreferencesPaginated",
  );
  const { isAuthenticated } = useConvexAuth();
  const [selectedId, setSelectedId] = useState<PreferenceId | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const {
    results: preferences,
    status: preferencesStatus,
    loadMore,
  } = usePaginatedQuery(
    listUserPreferencesPaginatedRef,
    isAdmin ? {} : "skip",
    { initialNumItems: 25 },
  );
  const selectedPreference = useQuery(
    api.admin.adminGetUserPreference,
    isAdmin && selectedId ? { preferenceId: selectedId } : "skip",
  );
  const deletePreference = useMutation(api.admin.adminDeleteUserPreference);

  const onDelete = async (preferenceId: PreferenceId) => {
    setDeleteError(null);
    if (!window.confirm("Delete this preference record?")) return;

    try {
      await deletePreference({ preferenceId });
      if (selectedId === preferenceId) setSelectedId(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete preference.",
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
                User Preferences
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                All rows from the <code>userPreferences</code> table.
              </p>
            </div>

            <Link
              href="/preferences/create"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Create Preference
            </Link>
          </div>

          {deleteError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {deleteError}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              {preferencesStatus === "LoadingFirstPage" ? (
                <div className="p-6 text-sm text-gray-600">
                  Loading preferences…
                </div>
              ) : preferences.length === 0 ? (
                <div className="p-6 text-sm text-gray-600">
                  No preferences yet.
                </div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="text-left font-medium px-4 py-3">
                            User
                          </th>
                          <th className="text-left font-medium px-4 py-3">
                            Reminder
                          </th>
                          <th className="text-left font-medium px-4 py-3">
                            Focus Areas
                          </th>
                          <th className="text-left font-medium px-4 py-3">
                            Updated
                          </th>
                          <th className="text-left font-medium px-4 py-3">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preferences.map((row) => (
                          <tr
                            key={row._id}
                            className={`cursor-pointer hover:bg-gray-50 ${selectedId === row._id ? "bg-blue-50/50" : ""}`}
                            onClick={() => setSelectedId(row._id)}
                          >
                            <td className="px-4 py-3">
                              {row.email && (
                                <div className="text-sm text-gray-900">
                                  {row.email}
                                </div>
                              )}
                              <div className="font-mono text-xs text-gray-500">
                                {row.clerkUserId}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {row.reminderType} — {row.formattedTime}
                            </td>
                            <td className="px-4 py-3 text-gray-600 text-xs">
                              [{row.focusAreas.join(", ")}]
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {new Date(row.updatedAt).toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                              <Link
                                href={`/preferences/edit/${row._id}`}
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

                  {preferencesStatus === "CanLoadMore" && (
                    <div className="border-t border-gray-100 p-4">
                      <button
                        onClick={() => loadMore(25)}
                        className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                      >
                        Load more preferences
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-3">
                Preference Detail
              </h2>
              {!selectedId ? (
                <p className="text-sm text-gray-600">
                  Select a row to inspect a preference.
                </p>
              ) : selectedPreference === undefined ? (
                <p className="text-sm text-gray-600">Loading detail…</p>
              ) : (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Clerk User ID</p>
                    <p className="font-mono text-xs text-gray-800">
                      {selectedPreference.clerkUserId}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Reminder</p>
                    <p className="text-gray-800">
                      {selectedPreference.reminderType} —{" "}
                      {selectedPreference.formattedTime}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Daily Time</p>
                    <p className="text-gray-800">
                      {selectedPreference.dailyTime}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Weekly Day</p>
                    <p className="text-gray-800">
                      {selectedPreference.weeklyDay}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Focus Areas</p>
                    <p className="text-gray-800">
                      [{selectedPreference.focusAreas.join(", ")}]
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
