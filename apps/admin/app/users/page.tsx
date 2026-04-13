"use client";

import AdminGuard from "@/components/admin-guard";
import {
  buildActiveDeletionStatusByUserId,
  buildRowDeletionStatusByUserId,
  isDeletionJobActive,
  isDeletionJobTerminal,
  type DeletionJobStatus,
} from "@/lib/user-deletion-flow";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import React from "react";
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import Link from "next/link";

type DeletionJobProgress = {
  deletedMemories: number;
  deletedSummaries: number;
  deletedDays: number;
  deletedIntegrations: number;
  deletedPreferences: number;
  deletedAuditLogs: number;
  deletedMemoryMedia: number;
  deletedIntegrationDailyData: number;
  deletedIntegrationSecrets: number;
  deletedIntegrationSyncRuns: number;
  deletedSummaryGenerationQuotas: number;
};

const EMPTY_DELETION_JOB_PROGRESS: DeletionJobProgress = {
  deletedMemories: 0,
  deletedSummaries: 0,
  deletedDays: 0,
  deletedIntegrations: 0,
  deletedPreferences: 0,
  deletedAuditLogs: 0,
  deletedMemoryMedia: 0,
  deletedIntegrationDailyData: 0,
  deletedIntegrationSecrets: 0,
  deletedIntegrationSyncRuns: 0,
  deletedSummaryGenerationQuotas: 0,
};

const DELETION_PROGRESS_COUNTERS: Array<{
  key: keyof DeletionJobProgress;
  label: string;
}> = [
  { key: "deletedMemories", label: "Deleted memories" },
  { key: "deletedMemoryMedia", label: "Deleted memory media" },
  { key: "deletedSummaries", label: "Deleted summaries" },
  { key: "deletedDays", label: "Deleted days" },
  { key: "deletedIntegrations", label: "Deleted integrations" },
  {
    key: "deletedIntegrationDailyData",
    label: "Deleted integration daily rows",
  },
  { key: "deletedIntegrationSecrets", label: "Deleted integration secrets" },
  {
    key: "deletedIntegrationSyncRuns",
    label: "Deleted integration sync runs",
  },
  { key: "deletedPreferences", label: "Deleted preferences" },
  { key: "deletedAuditLogs", label: "Deleted audit logs" },
  {
    key: "deletedSummaryGenerationQuotas",
    label: "Deleted summary quotas",
  },
];

type TrackedDeletionJob = {
  jobId: string;
  userId: string;
  userEmail: string;
  status: DeletionJobStatus;
  stage: string;
  checkpoints: number;
  updatedAt: number;
  completedAt?: number;
  failedAt?: number;
  lastError?: string;
  progress: DeletionJobProgress;
};

type ActionToastKind = "success" | "error" | "info";

type ActionToast = {
  id: number;
  kind: ActionToastKind;
  message: string;
};

type DeletionJobSnapshot = {
  status: DeletionJobStatus;
  stage: string;
  checkpoints: number;
  updatedAt?: number;
  completedAt?: number;
  failedAt?: number;
  lastError?: string;
  progress?: DeletionJobProgress;
};

const getUserDeletionJobRef = makeFunctionReference<"query">(
  "admin:adminGetUserDeletionJob",
);

function formatDeletionStageLabel(stage: string): string {
  return stage
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (value) => value.toUpperCase());
}

function getDeletionStatusPillClasses(status: DeletionJobStatus): string {
  if (status === "completed") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "failed") {
    return "bg-red-100 text-red-800";
  }

  if (status === "processing") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-slate-100 text-slate-700";
}

function formatDeletionStatusLabel(status: DeletionJobStatus): string {
  if (status === "processing") {
    return "Processing";
  }

  if (status === "requested") {
    return "Requested";
  }

  if (status === "completed") {
    return "Completed";
  }

  return "Failed";
}

function getToastClasses(kind: ActionToastKind): string {
  if (kind === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (kind === "error") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  return "border-blue-200 bg-blue-50 text-blue-800";
}

function normalizeDeletionJobProgress(
  value: unknown,
): DeletionJobProgress | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const normalized: Partial<DeletionJobProgress> = {};

  for (const counter of DELETION_PROGRESS_COUNTERS) {
    const raw = candidate[counter.key];
    if (typeof raw !== "number") {
      return undefined;
    }
    normalized[counter.key] = Math.max(0, Math.floor(raw));
  }

  return normalized as DeletionJobProgress;
}

function normalizeDeletionJobSnapshot(
  snapshot: unknown,
): DeletionJobSnapshot | null {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const candidate = snapshot as Record<string, unknown>;
  const status = candidate.status;
  const stage = candidate.stage;
  const checkpoints = candidate.checkpoints;

  if (
    status !== "requested" &&
    status !== "processing" &&
    status !== "completed" &&
    status !== "failed"
  ) {
    return null;
  }

  if (typeof stage !== "string" || typeof checkpoints !== "number") {
    return null;
  }

  return {
    status,
    stage,
    checkpoints,
    updatedAt:
      typeof candidate.updatedAt === "number" ? candidate.updatedAt : undefined,
    completedAt:
      typeof candidate.completedAt === "number"
        ? candidate.completedAt
        : undefined,
    failedAt:
      typeof candidate.failedAt === "number" ? candidate.failedAt : undefined,
    lastError:
      typeof candidate.lastError === "string" ? candidate.lastError : undefined,
    progress: normalizeDeletionJobProgress(candidate.progress),
  };
}

function DeletionJobStatusItem({
  job,
  pollToken,
  onSnapshot,
  onDismiss,
}: {
  job: TrackedDeletionJob;
  pollToken: number;
  onSnapshot: (jobId: string, snapshot: DeletionJobSnapshot) => void;
  onDismiss: (jobId: string) => void;
}) {
  const [detailsExpanded, setDetailsExpanded] = React.useState(false);

  const snapshot = useQuery(getUserDeletionJobRef, {
    jobId: job.jobId,
    pollToken,
  });

  React.useEffect(() => {
    const normalized = normalizeDeletionJobSnapshot(snapshot);
    if (!normalized) {
      return;
    }

    onSnapshot(job.jobId, normalized);
  }, [job.jobId, onSnapshot, snapshot]);

  const totalDeleted = DELETION_PROGRESS_COUNTERS.reduce(
    (sum, counter) => sum + job.progress[counter.key],
    0,
  );

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900">{job.userEmail}</p>
          <p className="text-xs text-gray-500 font-mono">Job {job.jobId}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center rounded-full px-2 py-1 font-semibold ${getDeletionStatusPillClasses(
              job.status,
            )}`}
          >
            {formatDeletionStatusLabel(job.status)}
          </span>
          <span className="inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-700">
            Stage: {formatDeletionStageLabel(job.stage)}
          </span>
          <span className="inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-700">
            Checkpoints: {job.checkpoints}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDetailsExpanded((value) => !value)}
            className="text-xs text-blue-700 hover:text-blue-900"
          >
            {detailsExpanded ? "Hide details" : "View details"}
          </button>
          {isDeletionJobTerminal(job.status) ? (
            <button
              type="button"
              onClick={() => onDismiss(job.jobId)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      </div>

      {job.status === "failed" && job.lastError ? (
        <p className="mt-2 text-xs text-red-700">Failed: {job.lastError}</p>
      ) : null}

      {detailsExpanded ? (
        <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3">
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-blue-700">
              Total deleted
            </span>
            <span className="text-sm font-semibold text-blue-900">
              {totalDeleted.toLocaleString()}
            </span>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {DELETION_PROGRESS_COUNTERS.map((counter) => (
              <div
                key={counter.key}
                className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5"
              >
                <dt className="text-[11px] text-gray-500">{counter.label}</dt>
                <dd className="text-sm font-semibold text-gray-900">
                  {job.progress[counter.key]}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </li>
  );
}

export default function UsersPage() {
  const listUsersPaginatedRef = makeFunctionReference<"query">(
    "admin:listUsersPaginated",
  );
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const {
    results: users,
    status,
    loadMore,
  } = usePaginatedQuery(listUsersPaginatedRef, isAdmin ? {} : "skip", {
    initialNumItems: 25,
  });
  const deleteUser = useMutation(api.admin.adminDeleteUser);

  const [pollToken, setPollToken] = React.useState(0);
  const [deletingByUserId, setDeletingByUserId] = React.useState<
    Record<string, boolean>
  >({});
  const [optimisticallyHiddenByUserId, setOptimisticallyHiddenByUserId] =
    React.useState<Record<string, boolean>>({});
  const [rowRefreshVersionByUserId, setRowRefreshVersionByUserId] =
    React.useState<Record<string, number>>({});
  const [toasts, setToasts] = React.useState<ActionToast[]>([]);
  const [trackedDeletionJobs, setTrackedDeletionJobs] = React.useState<
    TrackedDeletionJob[]
  >([]);
  const handledTerminalJobIdsRef = React.useRef<Set<string>>(new Set());

  const dismissToast = React.useCallback((toastId: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const pushToast = React.useCallback(
    (kind: ActionToastKind, message: string) => {
      const id = Date.now() + Math.floor(Math.random() * 1_000_000);

      setToasts((current) => [{ id, kind, message }, ...current].slice(0, 4));

      window.setTimeout(() => {
        dismissToast(id);
      }, 5000);
    },
    [dismissToast],
  );

  const refreshUserRow = React.useCallback((userId: string) => {
    setRowRefreshVersionByUserId((current) => ({
      ...current,
      [userId]: (current[userId] ?? 0) + 1,
    }));
  }, []);

  const hasInFlightDeletionJobs = trackedDeletionJobs.some((job) =>
    isDeletionJobActive(job.status),
  );

  React.useEffect(() => {
    if (!hasInFlightDeletionJobs) {
      return;
    }

    const interval = window.setInterval(() => {
      setPollToken((value) => value + 1);
    }, 3_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [hasInFlightDeletionJobs]);

  React.useEffect(() => {
    if (trackedDeletionJobs.length === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      const completedRetentionMs = 45_000;
      const cutoff = Date.now() - completedRetentionMs;
      setTrackedDeletionJobs((current) =>
        current.filter(
          (job) =>
            !isDeletionJobTerminal(job.status) ||
            (job.completedAt ?? job.failedAt ?? job.updatedAt) >= cutoff,
        ),
      );
    }, 10_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [trackedDeletionJobs.length]);

  const activeDeletionByUserId = React.useMemo(() => {
    const userIds = new Set<string>();
    for (const job of trackedDeletionJobs) {
      if (isDeletionJobActive(job.status)) {
        userIds.add(job.userId);
      }
    }
    return userIds;
  }, [trackedDeletionJobs]);

  const activeDeletionStatusByUserId = React.useMemo(() => {
    return buildActiveDeletionStatusByUserId(trackedDeletionJobs);
  }, [trackedDeletionJobs]);

  const rowDeletionStatusByUserId = React.useMemo(() => {
    return buildRowDeletionStatusByUserId(trackedDeletionJobs);
  }, [trackedDeletionJobs]);

  const visibleUsers = React.useMemo(
    () => users.filter((row) => !optimisticallyHiddenByUserId[String(row._id)]),
    [optimisticallyHiddenByUserId, users],
  );

  const handleDeletionSnapshot = React.useCallback(
    (jobId: string, snapshot: DeletionJobSnapshot) => {
      let matchedUserId: string | null = null;
      let matchedUserEmail: string | null = null;

      setTrackedDeletionJobs((current) =>
        current.map((job) => {
          if (job.jobId !== jobId) {
            return job;
          }

          matchedUserId = job.userId;
          matchedUserEmail = job.userEmail;

          return {
            ...job,
            status: snapshot.status,
            stage: snapshot.stage,
            checkpoints: snapshot.checkpoints,
            updatedAt: snapshot.updatedAt ?? Date.now(),
            completedAt: snapshot.completedAt ?? job.completedAt,
            failedAt: snapshot.failedAt ?? job.failedAt,
            lastError: snapshot.lastError ?? job.lastError,
            progress: snapshot.progress ?? job.progress,
          };
        }),
      );

      if (!matchedUserId || !isDeletionJobTerminal(snapshot.status)) {
        return;
      }

      if (handledTerminalJobIdsRef.current.has(jobId)) {
        return;
      }
      handledTerminalJobIdsRef.current.add(jobId);

      if (snapshot.status === "completed") {
        pushToast(
          "success",
          `Deletion completed for ${matchedUserEmail ?? "selected user"}.`,
        );
      } else {
        setOptimisticallyHiddenByUserId((current) => {
          const next = { ...current };
          delete next[matchedUserId!];
          return next;
        });

        pushToast(
          "error",
          snapshot.lastError
            ? `Deletion failed for ${matchedUserEmail ?? "selected user"}: ${snapshot.lastError}`
            : `Deletion failed for ${matchedUserEmail ?? "selected user"}.`,
        );
      }

      refreshUserRow(matchedUserId);
    },
    [pushToast, refreshUserRow],
  );

  const dismissDeletionJob = React.useCallback((jobId: string) => {
    setTrackedDeletionJobs((current) =>
      current.filter((job) => job.jobId !== jobId),
    );
  }, []);

  const queueUserDeletion = React.useCallback(
    async (row: { _id: (typeof users)[number]["_id"]; email: string }) => {
      const rowId = String(row._id);

      if (deletingByUserId[rowId] || activeDeletionByUserId.has(rowId)) {
        return;
      }

      if (!window.confirm("Are you sure you want to delete this user?")) {
        return;
      }

      setDeletingByUserId((current) => ({
        ...current,
        [rowId]: true,
      }));

      setOptimisticallyHiddenByUserId((current) => ({
        ...current,
        [rowId]: true,
      }));

      try {
        const result = (await deleteUser({
          userId: row._id,
        })) as {
          queued?: boolean;
          jobId?: string;
          status?: DeletionJobStatus;
          stage?: string;
        };

        const jobId = result.jobId;

        if (!result.queued || !jobId) {
          setOptimisticallyHiddenByUserId((current) => {
            const next = { ...current };
            delete next[rowId];
            return next;
          });

          pushToast(
            "error",
            `Failed to queue deletion for ${row.email}. Please try again.`,
          );
          refreshUserRow(rowId);
          return;
        }

        const now = Date.now();
        pushToast("info", `Deletion requested for ${row.email}.`);

        setTrackedDeletionJobs((current) => {
          const initialStatus: DeletionJobStatus =
            result.status === "processing" ? "processing" : "requested";

          const nextJob: TrackedDeletionJob = {
            jobId,
            userId: rowId,
            userEmail: row.email,
            status: initialStatus,
            stage: result.stage ?? "memoryMedia",
            checkpoints: 0,
            updatedAt: now,
            completedAt: undefined,
            failedAt: undefined,
            lastError: undefined,
            progress: EMPTY_DELETION_JOB_PROGRESS,
          };

          const existingIndex = current.findIndex(
            (job) =>
              job.jobId === nextJob.jobId || job.userId === nextJob.userId,
          );

          if (existingIndex >= 0) {
            const updated = [...current];
            updated[existingIndex] = {
              ...updated[existingIndex],
              ...nextJob,
            };
            return updated;
          }

          return [nextJob, ...current].slice(0, 12);
        });

        setPollToken((value) => value + 1);
      } catch (error) {
        setOptimisticallyHiddenByUserId((current) => {
          const next = { ...current };
          delete next[rowId];
          return next;
        });

        const message =
          error instanceof Error
            ? error.message
            : "Failed to queue user deletion.";
        pushToast("error", message);
        refreshUserRow(rowId);
      } finally {
        setDeletingByUserId((current) => {
          const next = { ...current };
          delete next[rowId];
          return next;
        });
      }
    },
    [
      activeDeletionByUserId,
      deleteUser,
      deletingByUserId,
      pushToast,
      refreshUserRow,
    ],
  );

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Users</h1>
              <p className="text-sm text-gray-500 mt-1">
                All rows from the <code>user</code> table.
              </p>
            </div>

            <Link
              href="/users/create"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Create User
            </Link>
          </div>

          {trackedDeletionJobs.length > 0 ? (
            <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-blue-100 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-blue-900">
                    User Deletion Jobs
                  </h2>
                  <p className="text-xs text-blue-700 mt-0.5">
                    Polling deletion status every 3 seconds.
                  </p>
                </div>
                <span className="text-xs font-medium text-blue-800">
                  {
                    trackedDeletionJobs.filter((job) =>
                      isDeletionJobActive(job.status),
                    ).length
                  }{" "}
                  active
                </span>
              </div>
              <ul className="divide-y divide-blue-100">
                {trackedDeletionJobs.map((job) => (
                  <DeletionJobStatusItem
                    key={job.jobId}
                    job={job}
                    pollToken={pollToken}
                    onSnapshot={handleDeletionSnapshot}
                    onDismiss={dismissDeletionJob}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {toasts.length > 0 ? (
            <div className="fixed right-4 top-20 z-50 space-y-2">
              {toasts.map((toast) => (
                <div
                  key={toast.id}
                  className={`min-w-[300px] max-w-[420px] rounded-lg border px-3 py-2 text-sm shadow ${getToastClasses(toast.kind)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p>{toast.message}</p>
                    <button
                      type="button"
                      onClick={() => dismissToast(toast.id)}
                      className="text-xs font-medium opacity-80 hover:opacity-100"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {status === "LoadingFirstPage" ? (
              <div className="p-6 text-sm text-gray-600">Loading...</div>
            ) : visibleUsers.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">No users yet.</div>
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
                          First Name
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Last Name
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Admin
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Created
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Deletion Status
                        </th>
                        <th className="text-left font-medium px-4 py-3">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {visibleUsers.map((row) => {
                        const rowId = String(row._id);
                        const rowDeletionStatus =
                          rowDeletionStatusByUserId.get(rowId) ??
                          (deletingByUserId[rowId] ? "requested" : undefined);

                        return (
                          <tr
                            key={`${row._id}:${rowRefreshVersionByUserId[rowId] ?? 0}`}
                            className="hover:bg-gray-50"
                          >
                            <td className="px-4 py-3">
                              <div className="text-sm text-gray-900">
                                {row.email}
                              </div>
                              <div className="font-mono text-xs text-gray-500">
                                {row.clerkUserId}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-900">
                              {row.firstName ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-gray-900">
                              {row.lastName ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {row.isAdmin ? "Yes" : "No"}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {new Date(row._creationTime).toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                              {rowDeletionStatus ? (
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${getDeletionStatusPillClasses(
                                    rowDeletionStatus,
                                  )}`}
                                >
                                  {formatDeletionStatusLabel(rowDeletionStatus)}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <Link
                                href={`/users/edit/${row._id}`}
                                className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                              >
                                Edit
                              </Link>
                              <button
                                type="button"
                                onClick={() =>
                                  void queueUserDeletion({
                                    _id: row._id,
                                    email: row.email,
                                  })
                                }
                                disabled={
                                  deletingByUserId[rowId] ||
                                  activeDeletionByUserId.has(rowId)
                                }
                                className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 ml-2 disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {activeDeletionByUserId.has(rowId)
                                  ? activeDeletionStatusByUserId.get(rowId) ===
                                    "requested"
                                    ? "Requested"
                                    : "Processing"
                                  : deletingByUserId[rowId]
                                    ? "Queueing..."
                                    : "Delete"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {status === "CanLoadMore" && (
                  <div className="border-t border-gray-100 p-4">
                    <button
                      onClick={() => loadMore(25)}
                      className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                    >
                      Load more users
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
