"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageContainerWide } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SummaryQualityRow = {
  _id: string;
  userId: string;
  dayKey: string;
  summaryId?: string;
  scores: {
    overall: number;
    length: number;
    coherence: number;
    duplication: number;
    failure: number;
  };
  wordCount: number;
  duplicateLineRatio: number;
  flags: string[];
  lowQuality: boolean;
  evaluatedAt: number;
};

type SummaryGenerationEventRow = {
  _id: string;
  userId: string;
  dayKey: string;
  modelProvider: string;
  modelName: string;
  success: boolean;
  failureReason?: string;
  attemptChainId?: string;
  selectedBestAttemptId?: string;
  createdAt: number;
};

function scorePct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function SummaryQualityPage() {
  const listEvaluationsRef = makeFunctionReference<"query">(
    "summaryQuality:listSummaryQualityEvaluationsPaginated",
  );
  const listGenerationEventsRef = makeFunctionReference<"query">(
    "summaryQuality:listSummaryGenerationEventsPaginated",
  );

  const { isAuthenticated } = useConvexAuth();
  const [onlyLowQuality, setOnlyLowQuality] = useState(true);
  const [selectedEvaluationId, setSelectedEvaluationId] = useState<
    string | null
  >(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const {
    results: evaluations,
    status: evaluationsStatus,
    loadMore: loadMoreEvaluations,
  } = usePaginatedQuery(
    listEvaluationsRef,
    isAdmin
      ? {
          onlyLowQuality,
        }
      : "skip",
    { initialNumItems: 25 },
  );

  const {
    results: failedEvents,
    status: failedEventsStatus,
    loadMore: loadMoreFailedEvents,
  } = usePaginatedQuery(
    listGenerationEventsRef,
    isAdmin
      ? {
          onlyFailures: true,
        }
      : "skip",
    { initialNumItems: 20 },
  );

  const backfillEvaluations = useMutation(
    api.summaryQuality.backfillSummaryQualityEvaluations,
  );

  const selectedEvaluation = useMemo(() => {
    if (!selectedEvaluationId) return null;
    return (
      (evaluations as SummaryQualityRow[]).find(
        (row) => row._id === selectedEvaluationId,
      ) ?? null
    );
  }, [evaluations, selectedEvaluationId]);

  const onBackfill = async () => {
    setFeedback(null);
    setErrorMessage(null);
    setBackfillBusy(true);

    try {
      const result = await backfillEvaluations({ maxItems: 200 });
      setFeedback(
        `Backfill complete. Evaluated ${result.evaluatedCount}, skipped ${result.skippedCount}.`,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to backfill summary evaluations.",
      );
    } finally {
      setBackfillBusy(false);
    }
  };

  return (
    <AdminGuard>
      <PageContainerWide
        title="Summary quality"
        description="Review low-quality summaries, inspect scoring dimensions, and monitor generation failures."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link href="/summaries">Back to summaries</Link>
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void onBackfill()}
              disabled={backfillBusy}
            >
              {backfillBusy ? "Backfilling…" : "Backfill evaluations"}
            </Button>
          </div>
        }
      >
        {feedback && (
          <div className="mb-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">
            {feedback}
          </div>
        )}

        {errorMessage && (
          <div className="mb-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">
            {errorMessage}
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={onlyLowQuality ? "primary" : "secondary"}
            onClick={() => {
              setOnlyLowQuality(true);
              setSelectedEvaluationId(null);
            }}
          >
            Low quality only
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!onlyLowQuality ? "primary" : "secondary"}
            onClick={() => {
              setOnlyLowQuality(false);
              setSelectedEvaluationId(null);
            }}
          >
            All evaluations
          </Button>
        </div>

        <div className="grid min-w-0 max-w-full gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {evaluationsStatus === "LoadingFirstPage" ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ) : evaluations.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No evaluations found for this filter.
              </div>
            ) : (
              <>
                <div className="max-w-full overflow-x-auto overscroll-x-contain">
                  <table className="min-w-[840px] w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Day</th>
                        <th className="px-4 py-3 text-left font-medium">
                          Overall
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Words
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Duplication
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Flags
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Evaluated
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(evaluations as SummaryQualityRow[]).map((row) => (
                        <tr
                          key={row._id}
                          className={`cursor-pointer hover:bg-muted/50 ${selectedEvaluationId === row._id ? "bg-muted/80" : ""}`}
                          onClick={() => setSelectedEvaluationId(row._id)}
                        >
                          <td className="px-4 py-3 font-mono text-xs text-foreground">
                            {row.dayKey}
                          </td>
                          <td className="px-4 py-3 text-foreground">
                            {scorePct(row.scores.overall)}
                          </td>
                          <td className="px-4 py-3 text-foreground">
                            {row.wordCount}
                          </td>
                          <td className="px-4 py-3 text-foreground">
                            {scorePct(row.duplicateLineRatio)}
                          </td>
                          <td className="max-w-[240px] wrap-break-word px-4 py-3 text-xs text-foreground">
                            {row.flags.join(", ") || "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(row.evaluatedAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {evaluationsStatus === "CanLoadMore" && (
                  <div className="border-t border-border p-4">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => loadMoreEvaluations(25)}
                    >
                      Load more evaluations
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="min-w-0 max-w-full rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <h2 className="mb-3 text-base font-semibold text-foreground">
              Evaluation detail
            </h2>
            {!selectedEvaluation ? (
              <p className="text-sm text-muted-foreground">
                Select an evaluation row to inspect scoring details.
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Overall Score</p>
                  <p className="text-foreground font-semibold">
                    {scorePct(selectedEvaluation.scores.overall)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Length Score</p>
                  <p className="text-foreground">
                    {scorePct(selectedEvaluation.scores.length)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Coherence Score
                  </p>
                  <p className="text-foreground">
                    {scorePct(selectedEvaluation.scores.coherence)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Duplication Score
                  </p>
                  <p className="text-foreground">
                    {scorePct(selectedEvaluation.scores.duplication)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Failure Risk</p>
                  <p className="text-foreground">
                    {scorePct(selectedEvaluation.scores.failure)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Flags</p>
                  <p className="text-foreground">
                    {selectedEvaluation.flags.join(", ") || "None"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              Recent generation failures
            </h3>
          </div>

          {failedEventsStatus === "LoadingFirstPage" ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ) : failedEvents.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No generation failures found.
            </div>
          ) : (
            <>
              <div className="max-w-full overflow-x-auto overscroll-x-contain">
                <table className="min-w-[900px] w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">
                        Created
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Day</th>
                      <th className="px-4 py-3 text-left font-medium">Model</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Attempt Chain
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Failure
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(failedEvents as SummaryGenerationEventRow[]).map(
                      (row) => (
                        <tr key={row._id} className="hover:bg-muted/50">
                          <td className="px-4 py-3 text-foreground">
                            {new Date(row.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-foreground">
                            {row.dayKey}
                          </td>
                          <td className="px-4 py-3 text-foreground">
                            {row.modelProvider}:{row.modelName}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {row.attemptChainId ?? "—"}
                          </td>
                          <td className="max-w-[320px] wrap-break-word px-4 py-3 text-xs text-foreground">
                            {row.failureReason ?? "Unknown failure"}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>

              {failedEventsStatus === "CanLoadMore" && (
                <div className="border-t border-border p-4">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => loadMoreFailedEvents(20)}
                  >
                    Load more failures
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
