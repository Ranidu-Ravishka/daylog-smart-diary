"use client";

import AdminGuard from "@/components/admin-guard";
import type { AdminDeleteUserResult } from "@/lib/types/adminQueries";
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
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import {
  tableActionsCellClass,
  tableActionsHeaderClass,
  tableActionsInnerClass,
} from "@/lib/table-actions";

type DeletionJobProgress = {
  deletedMemories: number;
  deletedSummaries: number;
  deletedDays: number;
  deletedIntegrations: number;
  deletedPreferences: number;
  deletedAuditLogs: number;
  deletedPlatformAuditEvents: number;
  deletedMemoryMedia: number;
  deletedIntegrationDailyData: number;
  deletedIntegrationSecrets: number;
  deletedIntegrationSyncRuns: number;
  deletedIntegrationHealthEvents: number;
  deletedExportJobs: number;
  deletedRestoreJobs: number;
  deletedSummaryGenerationEvents: number;
  deletedSummaryQualityEvaluations: number;
  deletedSummaryGenerationQuotas: number;
};

const EMPTY_DELETION_JOB_PROGRESS: DeletionJobProgress = {
  deletedMemories: 0,
  deletedSummaries: 0,
  deletedDays: 0,
  deletedIntegrations: 0,
  deletedPreferences: 0,
  deletedAuditLogs: 0,
  deletedPlatformAuditEvents: 0,
  deletedMemoryMedia: 0,
  deletedIntegrationDailyData: 0,
  deletedIntegrationSecrets: 0,
  deletedIntegrationSyncRuns: 0,
  deletedIntegrationHealthEvents: 0,
  deletedExportJobs: 0,
  deletedRestoreJobs: 0,
  deletedSummaryGenerationEvents: 0,
  deletedSummaryQualityEvaluations: 0,
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
  {
    key: "deletedIntegrationHealthEvents",
    label: "Deleted integration health events",
  },
  { key: "deletedExportJobs", label: "Deleted export jobs" },
  { key: "deletedRestoreJobs", label: "Deleted restore jobs" },
  {
    key: "deletedSummaryGenerationEvents",
    label: "Deleted summary generation events",
  },
  {
    key: "deletedSummaryQualityEvaluations",
    label: "Deleted summary quality evaluations",
  },
  { key: "deletedPreferences", label: "Deleted preferences" },
  { key: "deletedAuditLogs", label: "Deleted audit logs" },
  {
    key: "deletedPlatformAuditEvents",
    label: "Deleted platform audit events",
  },
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

const listRecentUserDeletionJobsRef = makeFunctionReference<"query">(
  "admin:adminListRecentUserDeletionJobs",
);

type RecentDeletionJobRecord = {
  _id: string;
  userId: string;
  clerkUserId: string;
  status: DeletionJobStatus;
  stage: string;
  checkpoints: number;
  updatedAt: number;
  completedAt?: number;
  failedAt?: number;
  lastError?: string;
  progress?: unknown;
  userEmail?: string | null;
};

function formatDeletionStageLabel(stage: string): string {
  return stage
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (value) => value.toUpperCase());
}

function getDeletionStatusPillClasses(status: DeletionJobStatus): string {
  if (status === "completed") {
    return "bg-muted text-foreground";
  }

  if (status === "failed") {
    return "bg-foreground text-background";
  }

  if (status === "processing") {
    return "bg-muted/80 text-foreground";
  }

  return "bg-muted text-muted-foreground";
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
    return "border-border bg-muted text-foreground";
  }

  if (kind === "error") {
    return "border-border bg-muted text-foreground ring-1 ring-foreground/15";
  }

  return "border-border bg-card text-foreground";
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
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      normalized[counter.key] = 0;
      continue;
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
          <p className="text-sm font-medium text-foreground">{job.userEmail}</p>
          <p className="text-xs text-muted-foreground font-mono">
            Job {job.jobId}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center rounded-full px-2 py-1 font-semibold ${getDeletionStatusPillClasses(
              job.status,
            )}`}
          >
            {formatDeletionStatusLabel(job.status)}
          </span>
          <span className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-foreground">
            Stage: {formatDeletionStageLabel(job.stage)}
          </span>
          <span className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-foreground">
            Checkpoints: {job.checkpoints}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDetailsExpanded((value) => !value)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {detailsExpanded ? "Hide details" : "View details"}
          </button>
          {isDeletionJobTerminal(job.status) ? (
            <button
              type="button"
              onClick={() => onDismiss(job.jobId)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      </div>

      {job.status === "failed" && job.lastError ? (
        <p className="mt-2 text-xs text-foreground">Failed: {job.lastError}</p>
      ) : null}

      {detailsExpanded ? (
        <div className="mt-3 rounded-lg border border-border bg-card p-3">
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Total deleted
            </span>
            <span className="text-sm font-semibold text-foreground">
              {totalDeleted.toLocaleString()}
            </span>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {DELETION_PROGRESS_COUNTERS.map((counter) => (
              <div
                key={counter.key}
                className="rounded-md border border-border bg-muted px-2 py-1.5"
              >
                <dt className="text-[11px] text-muted-foreground">
                  {counter.label}
                </dt>
                <dd className="text-sm font-semibold text-foreground">
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
  const recentDeletionJobs = useQuery(
    listRecentUserDeletionJobsRef,
    isAdmin ? { limit: 20, pollToken } : "skip",
  ) as RecentDeletionJobRecord[] | undefined;
  const [deletingByUserId, setDeletingByUserId] = React.useState<
    Record<string, boolean>
  >({});
  const [optimisticallyHiddenByUserId, setOptimisticallyHiddenByUserId] =
    React.useState<Record<string, boolean>>({});
  const [dismissedDeletionJobIds, setDismissedDeletionJobIds] = React.useState<
    Record<string, true>
  >({});
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

  React.useEffect(() => {
    if (!recentDeletionJobs) {
      return;
    }

    setTrackedDeletionJobs((current) => {
      const previousByJobId = new Map(
        current.map((job) => [job.jobId, job] as const),
      );
      const mergedByJobId = new Map(previousByJobId);

      for (const recentJob of recentDeletionJobs) {
        const jobId = String(recentJob._id);

        if (dismissedDeletionJobIds[jobId]) {
          continue;
        }

        const existing = previousByJobId.get(jobId);
        const normalizedProgress =
          normalizeDeletionJobProgress(recentJob.progress) ??
          existing?.progress ??
          EMPTY_DELETION_JOB_PROGRESS;

        const mergedJob: TrackedDeletionJob = {
          jobId,
          userId: String(recentJob.userId),
          userEmail:
            recentJob.userEmail ?? existing?.userEmail ?? recentJob.clerkUserId,
          status: recentJob.status,
          stage: recentJob.stage,
          checkpoints: recentJob.checkpoints,
          updatedAt: recentJob.updatedAt,
          completedAt: recentJob.completedAt,
          failedAt: recentJob.failedAt,
          lastError: recentJob.lastError,
          progress: normalizedProgress,
        };

        if (!existing && isDeletionJobTerminal(mergedJob.status)) {
          handledTerminalJobIdsRef.current.add(jobId);
        }

        mergedByJobId.set(jobId, mergedJob);
      }

      return Array.from(mergedByJobId.values())
        .filter((job) => !dismissedDeletionJobIds[job.jobId])
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, 20);
    });
  }, [dismissedDeletionJobIds, recentDeletionJobs]);

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
    setDismissedDeletionJobIds((current) => ({
      ...current,
      [jobId]: true,
    }));
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
        })) as AdminDeleteUserResult;

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

        setDismissedDeletionJobIds((current) => {
          if (!current[jobId]) {
            return current;
          }

          const next = { ...current };
          delete next[jobId];
          return next;
        });

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
      <PageContainer
        className="max-w-6xl"
        title="Users"
        description={
          <>
            All rows from the{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
              user
            </code>{" "}
            table.
          </>
        }
        action={
          <Button variant="primary" asChild>
            <Link href="/users/create">Create user</Link>
          </Button>
        }
      >
        {trackedDeletionJobs.length > 0 ? (
          <div className="mb-6 overflow-hidden rounded-xl border border-border bg-muted/40 shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  User Deletion Jobs
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Showing recent jobs across sessions and polling active jobs
                  every 3 seconds.
                </p>
              </div>
              <span className="text-xs font-medium text-foreground">
                {
                  trackedDeletionJobs.filter((job) =>
                    isDeletionJobActive(job.status),
                  ).length
                }{" "}
                active
              </span>
            </div>
            <ul className="divide-y divide-border">
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

        <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {status === "LoadingFirstPage" ? (
            <div className="p-6 text-sm text-muted-foreground">Loading...</div>
          ) : visibleUsers.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No users yet.
            </div>
          ) : (
            <>
              <div className="max-w-full overflow-x-auto overscroll-x-contain">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">User</th>
                      <th className="text-left font-medium px-4 py-3">
                        First Name
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Last Name
                      </th>
                      <th className="text-left font-medium px-4 py-3">Admin</th>
                      <th className="text-left font-medium px-4 py-3">
                        Created
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Deletion Status
                      </th>
                      <th className={tableActionsHeaderClass}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleUsers.map((row) => {
                      const rowId = String(row._id);
                      const rowDeletionStatus =
                        rowDeletionStatusByUserId.get(rowId) ??
                        (deletingByUserId[rowId] ? "requested" : undefined);

                      return (
                        <tr
                          key={`${row._id}:${rowRefreshVersionByUserId[rowId] ?? 0}`}
                          className="hover:bg-muted/50"
                        >
                          <td className="max-w-[280px] px-4 py-3">
                            <div className="text-sm text-foreground">
                              {row.email}
                            </div>
                            <div className="break-all font-mono text-xs text-muted-foreground">
                              {row.clerkUserId}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-foreground">
                            {row.firstName ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-foreground">
                            {row.lastName ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {row.isAdmin ? "Yes" : "No"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
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
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                          <td className={tableActionsCellClass}>
                            <div className={tableActionsInnerClass}>
                              <Button variant="primary" size="sm" asChild>
                                <Link href={`/users/edit/${row._id}`}>
                                  Edit
                                </Link>
                              </Button>
                              <Button
                                type="button"
                                variant="outlineDestructive"
                                size="sm"
                                disabled={
                                  deletingByUserId[rowId] ||
                                  activeDeletionByUserId.has(rowId)
                                }
                                onClick={() =>
                                  void queueUserDeletion({
                                    _id: row._id,
                                    email: row.email,
                                  })
                                }
                              >
                                {activeDeletionByUserId.has(rowId)
                                  ? activeDeletionStatusByUserId.get(rowId) ===
                                    "requested"
                                    ? "Requested"
                                    : "Processing"
                                  : deletingByUserId[rowId]
                                    ? "Queueing..."
                                    : "Delete"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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
                    Load more users
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
