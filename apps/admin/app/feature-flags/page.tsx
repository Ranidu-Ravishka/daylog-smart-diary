"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

type FeatureFlagKey = "aiSummaryEnabled" | "backgroundTrackingEnabled";

type FeatureFlagRow = {
  key: string;
  description: string;
  defaultEnabled: boolean;
  killSwitch: boolean;
  rolloutPercentage: number;
  enabledInDevelopment: boolean;
  enabledInStaging: boolean;
  enabledInProduction: boolean;
  includeClerkUserIds: string[];
  excludeClerkUserIds: string[];
  source: "default" | "db";
  updatedAt?: number;
};

type FeatureFlagsPageResponse = {
  items: FeatureFlagRow[];
  nextCursor: string | null;
};

const FEATURE_FLAGS_PAGE_SIZE = 50;

type FlagDraft = {
  description: string;
  defaultEnabled: boolean;
  killSwitch: boolean;
  rolloutPercentage: string;
  enabledInDevelopment: boolean;
  enabledInStaging: boolean;
  enabledInProduction: boolean;
  includeClerkUserIds: string;
  excludeClerkUserIds: string;
};

const listFeatureFlagsRef = makeFunctionReference<"query">(
  "featureFlags:listFeatureFlagsForAdmin",
);

const upsertFeatureFlagRef = makeFunctionReference<"mutation">(
  "featureFlags:upsertFeatureFlagForAdmin",
);

function isSupportedFeatureFlagKey(value: string): value is FeatureFlagKey {
  return value === "aiSummaryEnabled" || value === "backgroundTrackingEnabled";
}

function toDelimitedString(values: string[]): string {
  return values.join(", ");
}

function parseDelimitedIds(input: string): string[] {
  const deduped = new Set<string>();

  for (const token of input.split(/[\n,]/)) {
    const normalized = token.trim();
    if (!normalized) continue;
    deduped.add(normalized);
  }

  return [...deduped];
}

function toDraft(flag: FeatureFlagRow): FlagDraft {
  return {
    description: flag.description,
    defaultEnabled: flag.defaultEnabled,
    killSwitch: flag.killSwitch,
    rolloutPercentage: String(flag.rolloutPercentage),
    enabledInDevelopment: flag.enabledInDevelopment,
    enabledInStaging: flag.enabledInStaging,
    enabledInProduction: flag.enabledInProduction,
    includeClerkUserIds: toDelimitedString(flag.includeClerkUserIds),
    excludeClerkUserIds: toDelimitedString(flag.excludeClerkUserIds),
  };
}

function mergeFeatureFlags(
  primary: FeatureFlagRow[],
  secondary: FeatureFlagRow[],
): FeatureFlagRow[] {
  const seen = new Set<string>();
  const merged: FeatureFlagRow[] = [];

  for (const flag of [...primary, ...secondary]) {
    if (seen.has(flag.key)) {
      continue;
    }

    seen.add(flag.key);
    merged.push(flag);
  }

  return merged;
}

export default function FeatureFlagsPage() {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [extraFlags, setExtraFlags] = useState<FeatureFlagRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FlagDraft>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const flagsPageResponse = useQuery(
    listFeatureFlagsRef,
    isAdmin ? { limit: FEATURE_FLAGS_PAGE_SIZE } : "skip",
  ) as FeatureFlagsPageResponse | undefined;
  const flags = useMemo(
    () => mergeFeatureFlags(flagsPageResponse?.items ?? [], extraFlags),
    [flagsPageResponse?.items, extraFlags],
  );
  const effectiveNextCursor =
    nextCursor ?? flagsPageResponse?.nextCursor ?? null;

  const upsertFeatureFlag = useMutation(upsertFeatureFlagRef);

  useEffect(() => {
    if (flags.length === 0) return;

    setDrafts((previous) => {
      const next = { ...previous };
      for (const flag of flags) {
        if (next[flag.key]) continue;
        next[flag.key] = toDraft(flag);
      }
      return next;
    });
  }, [flags]);

  const sortedFlags = useMemo(
    () =>
      [...(flags ?? [])].sort((left, right) =>
        left.key.localeCompare(right.key),
      ),
    [flags],
  );

  const updateDraft = (key: string, next: FlagDraft) => {
    setDrafts((previous) => ({
      ...previous,
      [key]: next,
    }));
  };

  const saveFlag = async (flag: FeatureFlagRow) => {
    const draft = drafts[flag.key] ?? toDraft(flag);

    if (!isSupportedFeatureFlagKey(flag.key)) {
      setActionError(`Unsupported feature flag key: ${flag.key}`);
      return;
    }

    const rolloutPercentage = Number(draft.rolloutPercentage);
    if (
      !Number.isInteger(rolloutPercentage) ||
      rolloutPercentage < 0 ||
      rolloutPercentage > 100
    ) {
      setActionError(
        "Rollout percentage must be an integer between 0 and 100.",
      );
      return;
    }

    setBusyKey(flag.key);
    setActionError(null);
    setStatusMessage(null);
    setLoadMoreError(null);

    const includeClerkUserIds = parseDelimitedIds(draft.includeClerkUserIds);
    const excludeClerkUserIds = parseDelimitedIds(draft.excludeClerkUserIds);

    try {
      await upsertFeatureFlag({
        key: flag.key,
        description: draft.description,
        defaultEnabled: draft.defaultEnabled,
        killSwitch: draft.killSwitch,
        rolloutPercentage,
        enabledInDevelopment: draft.enabledInDevelopment,
        enabledInStaging: draft.enabledInStaging,
        enabledInProduction: draft.enabledInProduction,
        includeClerkUserIds,
        excludeClerkUserIds,
      });

      setStatusMessage(`Saved ${flag.key}`);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Failed to update feature flag.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const loadMoreFlags = async () => {
    if (!effectiveNextCursor || isLoadingMore) {
      return;
    }

    setLoadMoreError(null);
    setIsLoadingMore(true);

    try {
      const page = (await convex.query(listFeatureFlagsRef, {
        limit: FEATURE_FLAGS_PAGE_SIZE,
        cursor: effectiveNextCursor,
      })) as FeatureFlagsPageResponse;

      setExtraFlags((previous) => mergeFeatureFlags(previous, page.items));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadMoreError(
        error instanceof Error ? error.message : "Failed to load more flags.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-gray-900">
              Feature Flags
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Remotely control staged rollouts with per-environment settings,
              deterministic percentage rollout, per-user targeting, and kill
              switches.
            </p>
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

          {loadMoreError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {loadMoreError}
            </div>
          )}

          {!flagsPageResponse && flags.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
              Loading feature flags...
            </div>
          ) : sortedFlags.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
              No feature flags configured.
            </div>
          ) : (
            <div className="space-y-4">
              {sortedFlags.map((flag) => {
                const draft = drafts[flag.key] ?? toDraft(flag);

                return (
                  <section
                    key={flag.key}
                    className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
                      <div>
                        <h2 className="text-sm font-semibold text-gray-900">
                          {flag.key}
                        </h2>
                        <p className="mt-1 text-xs text-gray-600">
                          {flag.description}
                        </p>
                      </div>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          flag.source === "db"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {flag.source}
                      </span>
                    </div>

                    <div className="grid gap-4 px-4 py-4 md:grid-cols-2">
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={draft.defaultEnabled}
                          onChange={(event) =>
                            updateDraft(flag.key, {
                              ...draft,
                              defaultEnabled: event.target.checked,
                            })
                          }
                        />
                        Default Enabled
                      </label>

                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={draft.killSwitch}
                          onChange={(event) =>
                            updateDraft(flag.key, {
                              ...draft,
                              killSwitch: event.target.checked,
                            })
                          }
                        />
                        Kill Switch
                      </label>

                      <label className="block text-sm text-gray-700">
                        <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
                          Rollout Percentage
                        </span>
                        <input
                          value={draft.rolloutPercentage}
                          onChange={(event) =>
                            updateDraft(flag.key, {
                              ...draft,
                              rolloutPercentage: event.target.value,
                            })
                          }
                          inputMode="numeric"
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                      </label>

                      <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p>Environment Controls</p>
                        <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-700">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={draft.enabledInDevelopment}
                              onChange={(event) =>
                                updateDraft(flag.key, {
                                  ...draft,
                                  enabledInDevelopment: event.target.checked,
                                })
                              }
                            />
                            Development
                          </label>
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={draft.enabledInStaging}
                              onChange={(event) =>
                                updateDraft(flag.key, {
                                  ...draft,
                                  enabledInStaging: event.target.checked,
                                })
                              }
                            />
                            Staging
                          </label>
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={draft.enabledInProduction}
                              onChange={(event) =>
                                updateDraft(flag.key, {
                                  ...draft,
                                  enabledInProduction: event.target.checked,
                                })
                              }
                            />
                            Production
                          </label>
                        </div>
                      </div>

                      <label className="block text-sm text-gray-700">
                        <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
                          Include Clerk User IDs
                        </span>
                        <textarea
                          value={draft.includeClerkUserIds}
                          onChange={(event) =>
                            updateDraft(flag.key, {
                              ...draft,
                              includeClerkUserIds: event.target.value,
                            })
                          }
                          rows={3}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                          placeholder="clerk_user_1, clerk_user_2"
                        />
                      </label>

                      <label className="block text-sm text-gray-700">
                        <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
                          Exclude Clerk User IDs
                        </span>
                        <textarea
                          value={draft.excludeClerkUserIds}
                          onChange={(event) =>
                            updateDraft(flag.key, {
                              ...draft,
                              excludeClerkUserIds: event.target.value,
                            })
                          }
                          rows={3}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                          placeholder="clerk_user_3"
                        />
                      </label>
                    </div>

                    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
                      <p className="text-xs text-gray-500">
                        Last updated:{" "}
                        {flag.updatedAt
                          ? new Date(flag.updatedAt).toLocaleString()
                          : "Never"}
                      </p>
                      <button
                        onClick={() => {
                          void saveFlag(flag);
                        }}
                        disabled={busyKey === flag.key}
                        className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busyKey === flag.key ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </section>
                );
              })}

              {effectiveNextCursor && (
                <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <span className="text-xs text-gray-500">
                    Showing {sortedFlags.length} flags
                  </span>
                  <button
                    onClick={() => {
                      void loadMoreFlags();
                    }}
                    disabled={isLoadingMore}
                    className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoadingMore ? "Loading more..." : "Load more flags"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminGuard>
  );
}
