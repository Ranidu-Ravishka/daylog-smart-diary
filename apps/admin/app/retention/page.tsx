"use client";

import AdminGuard from "@/components/admin-guard";
import {
  formatRetentionDeletedCounts,
  sumRetentionDeletedCounts,
  type RetentionDeletedCounts,
} from "@/lib/retention-counts";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { useEffect, useMemo, useState } from "react";

type RetentionPolicyRow = {
  key: string;
  retentionDays: number;
  sensitive: boolean;
  enabled: boolean;
  source: "env" | "db";
  updatedAt?: number;
};

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

export default function RetentionPage() {
  const listRetentionRunsRef = makeFunctionReference<"query">(
    "retention:listRetentionRunsPaginated",
  );

  const { isAuthenticated } = useConvexAuth();
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

  const policies = useQuery(
    api.retention.listEffectiveRetentionPolicies,
    isAdmin ? {} : "skip",
  ) as RetentionPolicyRow[] | undefined;

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
    if (!policies) return;

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

  const executeCleanup = async (dryRun: boolean) => {
    setActionError(null);
    setStatusMessage(null);
    setCleanupBusy(dryRun ? "dry" : "live");

    try {
      const result = await runCleanup({ dryRun });
      const total = sumRetentionDeletedCounts(result.deletedCounts);

      setStatusMessage(
        dryRun
          ? `Dry run complete. ${total} rows would be deleted.`
          : `Cleanup complete. Deleted ${total} rows.`,
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
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Data Retention
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Govern lifecycle windows and run cleanup jobs with full audit
                visibility.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => executeCleanup(true)}
                disabled={cleanupBusy !== null}
                className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cleanupBusy === "dry" ? "Running Dry Run…" : "Run Dry Run"}
              </button>
              <button
                onClick={() => executeCleanup(false)}
                disabled={cleanupBusy !== null}
                className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cleanupBusy === "live" ? "Running Cleanup…" : "Run Cleanup"}
              </button>
            </div>
          </div>

          {statusMessage && (
            <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {statusMessage}
            </div>
          )}

          {actionError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {actionError}
            </div>
          )}

          <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Effective Policies
              </h2>
            </div>

            {!policies ? (
              <div className="p-6 text-sm text-gray-600">
                Loading retention policies…
              </div>
            ) : sortedPolicies.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">
                No policies found.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Key</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Retention Days
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Sensitive
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Enabled
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Source
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Updated
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedPolicies.map((policy) => {
                      const draft = policyDrafts[policy.key];
                      return (
                        <tr key={policy.key} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">
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
                                      retentionDays: String(
                                        policy.retentionDays,
                                      ),
                                      enabled: policy.enabled,
                                      sensitive: policy.sensitive,
                                    }),
                                    retentionDays: event.target.value,
                                  },
                                }))
                              }
                              className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                              inputMode="numeric"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${policy.sensitive ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"}`}
                            >
                              {policy.sensitive ? "Yes" : "No"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
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
                          <td className="px-4 py-3 text-gray-600">
                            {policy.source}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {policy.updatedAt
                              ? new Date(policy.updatedAt).toLocaleString()
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => savePolicy(policy)}
                              disabled={busyPolicyKey === policy.key}
                              className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {busyPolicyKey === policy.key
                                ? "Saving…"
                                : "Save"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Retention Run History
              </h2>
            </div>

            {runsStatus === "LoadingFirstPage" ? (
              <div className="p-6 text-sm text-gray-600">
                Loading retention runs…
              </div>
            ) : runs.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">
                No cleanup runs yet.
              </div>
            ) : (
              <>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">
                          Started
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Trigger
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Mode
                        </th>
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
                    <tbody className="divide-y divide-gray-100">
                      {(runs as RetentionRunRow[]).map((run) => (
                        <tr key={run._id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-700">
                            {new Date(run.startedAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {run.trigger}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {run.dryRun ? "dry-run" : "live"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${run.status === "success" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                            >
                              {run.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {totalDeletes(run)}
                          </td>
                          <td className="max-w-sm px-4 py-3 text-xs text-gray-600">
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
                  <div className="border-t border-gray-100 p-4">
                    <button
                      onClick={() => loadMore(20)}
                      className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                    >
                      Load more runs
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
