"use client";

import AdminGuard from "@/components/admin-guard";
import {
  buildRetentionCleanupStatusMessage,
  formatRetentionDeletedCounts,
  sumRetentionDeletedCounts,
  type RetentionDeletedCounts,
} from "@/lib/retention-counts";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import {
  useConvex,
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { useEffect, useMemo, useState } from "react";

import { PageContainerWide } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type RetentionPolicyRow = {
  key: string;
  retentionDays: number;
  sensitive: boolean;
  enabled: boolean;
  source: "env" | "db";
  updatedAt?: number;
};

type RetentionPoliciesPageResponse = {
  items: RetentionPolicyRow[];
  nextCursor: string | null;
};

const RETENTION_POLICIES_PAGE_SIZE = 50;

type RetentionRunRow = {
  _id: string;
  trigger: "cron" | "manual";
  status: "success" | "error";
  dryRun: boolean;
  startedAt: number;
  finishedAt: number;
  deletedCounts?: RetentionDeletedCounts;
  error?: string;
};

type PolicyDraft = {
  retentionDays: string;
  enabled: boolean;
  sensitive: boolean;
};

function totalDeletes(run: RetentionRunRow): number {
  return sumRetentionDeletedCounts(run.deletedCounts);
}

function mergeRetentionPolicies(
  primary: RetentionPolicyRow[],
  secondary: RetentionPolicyRow[],
): RetentionPolicyRow[] {
  const seen = new Set<string>();
  const merged: RetentionPolicyRow[] = [];

  for (const policy of [...primary, ...secondary]) {
    if (seen.has(policy.key)) {
      continue;
    }

    seen.add(policy.key);
    merged.push(policy);
  }

  return merged;
}

export default function RetentionPage() {
  const convex = useConvex();
  const listRetentionRunsRef = makeFunctionReference<"query">(
    "retention:listRetentionRunsPaginated",
  );

  const { isAuthenticated } = useConvexAuth();
  const [extraPolicies, setExtraPolicies] = useState<RetentionPolicyRow[]>([]);
  const [policyNextCursor, setPolicyNextCursor] = useState<string | null>(null);
  const [isLoadingMorePolicies, setIsLoadingMorePolicies] = useState(false);
  const [policyLoadError, setPolicyLoadError] = useState<string | null>(null);
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, PolicyDraft>>(
    {},
  );
  const [busyPolicyKey, setBusyPolicyKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState<"dry" | "live" | null>(null);

  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const policiesPageResponse = useQuery(
    api.retention.listEffectiveRetentionPolicies,
    isAdmin
      ? {
          limit: RETENTION_POLICIES_PAGE_SIZE,
        }
      : "skip",
  ) as RetentionPoliciesPageResponse | undefined;
  const policies = useMemo(
    () =>
      mergeRetentionPolicies(policiesPageResponse?.items ?? [], extraPolicies),
    [policiesPageResponse?.items, extraPolicies],
  );
  const effectivePolicyNextCursor =
    policyNextCursor ?? policiesPageResponse?.nextCursor ?? null;

  const {
    results: runs,
    status: runsStatus,
    loadMore,
  } = usePaginatedQuery(listRetentionRunsRef, isAdmin ? {} : "skip", {
    initialNumItems: 20,
  });

  const upsertPolicy = useMutation(api.retention.upsertRetentionPolicy);
  const runCleanup = useMutation(api.retention.runRetentionCleanupNow);

  useEffect(() => {
    if (policies.length === 0) return;

    setPolicyDrafts((previous) => {
      const next = { ...previous };
      for (const policy of policies) {
        if (next[policy.key]) continue;
        next[policy.key] = {
          retentionDays: String(policy.retentionDays),
          enabled: policy.enabled,
          sensitive: policy.sensitive,
        };
      }
      return next;
    });
  }, [policies]);

  const sortedPolicies = useMemo(() => {
    return [...(policies ?? [])].sort((a, b) => a.key.localeCompare(b.key));
  }, [policies]);

  const savePolicy = async (policy: RetentionPolicyRow) => {
    const draft = policyDrafts[policy.key];
    if (!draft) return;

    const parsedDays = Number(draft.retentionDays);
    if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 3650) {
      setActionError("Retention days must be an integer between 1 and 3650.");
      return;
    }

    setActionError(null);
    setStatusMessage(null);
    setPolicyLoadError(null);
    setBusyPolicyKey(policy.key);

    try {
      await upsertPolicy({
        key: policy.key,
        retentionDays: parsedDays,
        enabled: draft.enabled,
        sensitive: draft.sensitive,
      });

      setStatusMessage(`Saved policy: ${policy.key}`);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Failed to update retention policy.",
      );
    } finally {
      setBusyPolicyKey(null);
    }
  };

  const loadMorePolicies = async () => {
    if (!effectivePolicyNextCursor || isLoadingMorePolicies) {
      return;
    }

    setPolicyLoadError(null);
    setIsLoadingMorePolicies(true);

    try {
      const page = (await convex.query(
        api.retention.listEffectiveRetentionPolicies,
        {
          limit: RETENTION_POLICIES_PAGE_SIZE,
          cursor: effectivePolicyNextCursor,
        },
      )) as RetentionPoliciesPageResponse;

      setExtraPolicies((previous) =>
        mergeRetentionPolicies(previous, page.items),
      );
      setPolicyNextCursor(page.nextCursor);
    } catch (error) {
      setPolicyLoadError(
        error instanceof Error
          ? error.message
          : "Failed to load more policies.",
      );
    } finally {
      setIsLoadingMorePolicies(false);
    }
  };

  const executeCleanup = async (dryRun: boolean) => {
    setActionError(null);
    setStatusMessage(null);
    setCleanupBusy(dryRun ? "dry" : "live");

    try {
      const result = await runCleanup({ dryRun });
      setStatusMessage(
        buildRetentionCleanupStatusMessage(result.deletedCounts, dryRun),
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Retention cleanup failed.",
      );
    } finally {
      setCleanupBusy(null);
    }
  };

  return (
    <AdminGuard>
      <PageContainerWide
        title="Data retention"
        description="Govern lifecycle windows and run cleanup jobs with full audit visibility."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void executeCleanup(true)}
              disabled={cleanupBusy !== null}
            >
              {cleanupBusy === "dry" ? "Running dry run…" : "Run dry run"}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void executeCleanup(false)}
              disabled={cleanupBusy !== null}
            >
              {cleanupBusy === "live" ? "Running cleanup…" : "Run cleanup"}
            </Button>
          </div>
        }
      >
        {statusMessage && (
          <div className="mb-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">
            {statusMessage}
          </div>
        )}

        {actionError && (
          <div className="mb-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">
            {actionError}
          </div>
        )}

        <div className="mb-6 min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Effective policies
            </h2>
          </div>

          {!policiesPageResponse && policies.length === 0 ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ) : sortedPolicies.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No policies found.
            </div>
          ) : (
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              {policyLoadError && (
                <div className="border-b border-border bg-muted px-4 py-3 text-sm text-foreground">
                  {policyLoadError}
                </div>
              )}

              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Key</th>
                    <th className="px-4 py-3 text-left font-medium">
                      Retention Days
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Sensitive
                    </th>
                    <th className="px-4 py-3 text-left font-medium">Enabled</th>
                    <th className="px-4 py-3 text-left font-medium">Source</th>
                    <th className="px-4 py-3 text-left font-medium">Updated</th>
                    <th className="px-4 py-3 text-left font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedPolicies.map((policy) => {
                    const draft = policyDrafts[policy.key];
                    return (
                      <tr key={policy.key} className="hover:bg-muted/50">
                        <td className="max-w-[240px] wrap-break-word px-4 py-3 font-medium text-foreground">
                          {policy.key}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={
                              draft?.retentionDays ??
                              String(policy.retentionDays)
                            }
                            onChange={(event) =>
                              setPolicyDrafts((previous) => ({
                                ...previous,
                                [policy.key]: {
                                  ...(previous[policy.key] ?? {
                                    retentionDays: String(policy.retentionDays),
                                    enabled: policy.enabled,
                                    sensitive: policy.sensitive,
                                  }),
                                  retentionDays: event.target.value,
                                },
                              }))
                            }
                            className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                            inputMode="numeric"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${policy.sensitive ? "bg-muted text-foreground" : "bg-muted/60 text-muted-foreground"}`}
                          >
                            {policy.sensitive ? "Yes" : "No"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <label className="inline-flex items-center gap-2 text-xs text-foreground">
                            <input
                              type="checkbox"
                              checked={draft?.enabled ?? policy.enabled}
                              onChange={(event) =>
                                setPolicyDrafts((previous) => ({
                                  ...previous,
                                  [policy.key]: {
                                    ...(previous[policy.key] ?? {
                                      retentionDays: String(
                                        policy.retentionDays,
                                      ),
                                      enabled: policy.enabled,
                                      sensitive: policy.sensitive,
                                    }),
                                    enabled: event.target.checked,
                                  },
                                }))
                              }
                            />
                            Enabled
                          </label>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {policy.source}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {policy.updatedAt
                            ? new Date(policy.updatedAt).toLocaleString()
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => void savePolicy(policy)}
                            disabled={busyPolicyKey === policy.key}
                          >
                            {busyPolicyKey === policy.key ? "Saving…" : "Save"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {effectivePolicyNextCursor && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
                  <span className="text-xs text-muted-foreground">
                    Showing {sortedPolicies.length} policies
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void loadMorePolicies();
                    }}
                    disabled={isLoadingMorePolicies}
                  >
                    {isLoadingMorePolicies
                      ? "Loading more..."
                      : "Load more policies"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Retention run history
            </h2>
          </div>

          {runsStatus === "LoadingFirstPage" ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ) : runs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No cleanup runs yet.
            </div>
          ) : (
            <>
              <div className="max-w-full overflow-x-auto overscroll-x-contain">
                <table className="min-w-[860px] w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">
                        Started
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Trigger
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Mode</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Deleted
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(runs as RetentionRunRow[]).map((run) => (
                      <tr key={run._id} className="hover:bg-muted/50">
                        <td className="px-4 py-3 text-foreground">
                          {new Date(run.startedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {run.trigger}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {run.dryRun ? "dry-run" : "live"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${run.status === "success" ? "bg-muted text-foreground" : "bg-muted/80 text-foreground"}`}
                          >
                            {run.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {totalDeletes(run)}
                        </td>
                        <td className="max-w-[260px] wrap-break-word px-4 py-3 text-xs text-muted-foreground">
                          {run.status === "error"
                            ? (run.error ?? "Cleanup failed")
                            : formatRetentionDeletedCounts(run.deletedCounts)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {runsStatus === "CanLoadMore" && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
                  <span className="text-xs text-muted-foreground">
                    Showing {(runs as RetentionRunRow[]).length} runs
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => loadMore(20)}
                  >
                    Load more runs
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </PageContainerWide>
    </AdminGuard>
  );
}
