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
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Summary Quality Queue
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Review low-quality summaries, inspect scoring dimensions, and
                monitor generation failures.
              </p>
            </div>

            <div className="flex gap-2">
              <Link
                href="/summaries"
                className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
              >
                Back to Summaries
              </Link>
              <button
                onClick={onBackfill}
                disabled={backfillBusy}
                className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {backfillBusy ? "Backfilling…" : "Backfill Evaluations"}
              </button>
            </div>
          </div>

          {feedback && (
            <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {feedback}
            </div>
          )}

          {errorMessage && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          <div className="mb-4 flex items-center gap-2">
            <button
              onClick={() => {
                setOnlyLowQuality(true);
                setSelectedEvaluationId(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${onlyLowQuality ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              Low Quality Only
            </button>
            <button
              onClick={() => {
                setOnlyLowQuality(false);
                setSelectedEvaluationId(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${!onlyLowQuality ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              All Evaluations
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              {evaluationsStatus === "LoadingFirstPage" ? (
                <div className="p-6 text-sm text-gray-600">
                  Loading quality evaluations…
                </div>
              ) : evaluations.length === 0 ? (
                <div className="p-6 text-sm text-gray-600">
                  No evaluations found for this filter.
                </div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium">
                            Day
                          </th>
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
                      <tbody className="divide-y divide-gray-100">
                        {(evaluations as SummaryQualityRow[]).map((row) => (
                          <tr
                            key={row._id}
                            className={`cursor-pointer hover:bg-gray-50 ${selectedEvaluationId === row._id ? "bg-blue-50/50" : ""}`}
                            onClick={() => setSelectedEvaluationId(row._id)}
                          >
                            <td className="px-4 py-3 font-mono text-xs text-gray-800">
                              {row.dayKey}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {scorePct(row.scores.overall)}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {row.wordCount}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {scorePct(row.duplicateLineRatio)}
                            </td>
                            <td className="max-w-xs px-4 py-3 text-xs text-gray-700">
                              {row.flags.join(", ") || "—"}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {new Date(row.evaluatedAt).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {evaluationsStatus === "CanLoadMore" && (
                    <div className="border-t border-gray-100 p-4">
                      <button
                        onClick={() => loadMoreEvaluations(25)}
                        className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                      >
                        Load more evaluations
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-gray-900">
                Evaluation Detail
              </h2>
              {!selectedEvaluation ? (
                <p className="text-sm text-gray-600">
                  Select an evaluation row to inspect scoring details.
                </p>
              ) : (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Overall Score</p>
                    <p className="text-gray-900 font-semibold">
                      {scorePct(selectedEvaluation.scores.overall)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Length Score</p>
                    <p className="text-gray-800">
                      {scorePct(selectedEvaluation.scores.length)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Coherence Score</p>
                    <p className="text-gray-800">
                      {scorePct(selectedEvaluation.scores.coherence)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Duplication Score</p>
                    <p className="text-gray-800">
                      {scorePct(selectedEvaluation.scores.duplication)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Failure Risk</p>
                    <p className="text-gray-800">
                      {scorePct(selectedEvaluation.scores.failure)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Flags</p>
                    <p className="text-gray-800">
                      {selectedEvaluation.flags.join(", ") || "None"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Recent Generation Failures
              </h3>
            </div>

            {failedEventsStatus === "LoadingFirstPage" ? (
              <div className="p-6 text-sm text-gray-600">
                Loading generation failures…
              </div>
            ) : failedEvents.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">
                No generation failures found.
              </div>
            ) : (
              <>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">
                          Created
                        </th>
                        <th className="px-4 py-3 text-left font-medium">Day</th>
                        <th className="px-4 py-3 text-left font-medium">
                          Model
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Failure
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(failedEvents as SummaryGenerationEventRow[]).map(
                        (row) => (
                          <tr key={row._id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-700">
                              {new Date(row.createdAt).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-800">
                              {row.dayKey}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {row.modelProvider}:{row.modelName}
                            </td>
                            <td className="max-w-lg px-4 py-3 text-xs text-gray-700">
                              {row.failureReason ?? "Unknown failure"}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>

                {failedEventsStatus === "CanLoadMore" && (
                  <div className="border-t border-gray-100 p-4">
                    <button
                      onClick={() => loadMoreFailedEvents(20)}
                      className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                    >
                      Load more failures
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
