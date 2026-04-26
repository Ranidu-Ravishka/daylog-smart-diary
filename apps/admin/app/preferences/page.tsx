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

import { PageContainerWide } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  tableActionsCellClass,
  tableActionsHeaderClass,
  tableActionsInnerClass,
} from "@/lib/table-actions";

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
      <PageContainerWide
        title="User preferences"
        description={
          <>
            All rows from the{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
              userPreferences
            </code>{" "}
            table.
          </>
        }
        action={
          <Button variant="primary" asChild>
            <Link href="/preferences/create">Create preference</Link>
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
            {preferencesStatus === "LoadingFirstPage" ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ) : preferences.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No preferences yet.
              </div>
            ) : (
              <>
                <div className="max-w-full overflow-x-auto overscroll-x-contain">
                  <table className="min-w-[860px] w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
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
                        <th className={tableActionsHeaderClass}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {preferences.map((row) => (
                        <tr
                          key={row._id}
                          className={`cursor-pointer hover:bg-muted/50 ${selectedId === row._id ? "bg-muted/80" : ""}`}
                          onClick={() => setSelectedId(row._id)}
                        >
                          <td className="max-w-[280px] px-4 py-3">
                            {row.email && (
                              <div className="text-sm text-foreground">
                                {row.email}
                              </div>
                            )}
                            <div className="break-all font-mono text-xs text-muted-foreground">
                              {row.clerkUserId}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {row.reminderType} — {row.formattedTime}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            [{row.focusAreas.join(", ")}]
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(row.updatedAt).toLocaleString()}
                          </td>
                          <td className={tableActionsCellClass}>
                            <div className={tableActionsInnerClass}>
                              <Button variant="primary" size="sm" asChild>
                                <Link
                                  href={`/preferences/edit/${row._id}`}
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

                {preferencesStatus === "CanLoadMore" && (
                  <div className="border-t border-border p-4">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => loadMore(25)}
                    >
                      Load more preferences
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="min-w-0 max-w-full rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-semibold text-foreground mb-3">
              Preference detail
            </h2>
            {!selectedId ? (
              <p className="text-sm text-muted-foreground">
                Select a row to inspect a preference.
              </p>
            ) : selectedPreference === undefined ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-2/3 rounded-md" />
                <Skeleton className="h-4 w-full rounded-md" />
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Clerk User ID</p>
                  <p className="font-mono text-xs text-foreground">
                    {selectedPreference.clerkUserId}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Reminder</p>
                  <p className="text-foreground">
                    {selectedPreference.reminderType} —{" "}
                    {selectedPreference.formattedTime}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Daily Time</p>
                  <p className="text-foreground">
                    {selectedPreference.dailyTime}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Weekly Day</p>
                  <p className="text-foreground">
                    {selectedPreference.weeklyDay}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Focus Areas</p>
                  <p className="text-foreground">
                    [{selectedPreference.focusAreas.join(", ")}]
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
