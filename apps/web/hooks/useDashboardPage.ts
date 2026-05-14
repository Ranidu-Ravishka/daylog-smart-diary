"use client";

import { useAuth } from "@clerk/nextjs";
import {
  useAction,
  useConvexAuth,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { api } from "@repo/backend/convex";
import { MOOD_EMOJI, MOOD_LABELS } from "@repo/ui/lib/constants";
import {
  getDayKeyForTimestamp,
  getResolvedTimeZone,
} from "@repo/ui/lib/day-window";
import { useCallback, useMemo, useState } from "react";
import { captureException, logInfo, logWarn } from "@/lib/observability";
import { toastError, toastSuccess } from "@/lib/toast";
import type {
  DashboardDay,
  DashboardIntegrationSource,
  DashboardSummary,
  GenerateSummaryForDayResult,
} from "@/lib/types/dashboard";
import type { MemoryData } from "@/components/MemoryCard";
import { formatMinutesAsHours } from "@/lib/dashboard/format";
import { getIntegrationProviderLabelMap } from "@/lib/dashboard/integration-labels";
import {
  getSummaryGenerationErrorMessage,
  getSummaryGenerationFailureResultMessage,
} from "@/lib/dashboard/summary-messages";

export const DASHBOARD_MEMORIES_PAGE_SIZE = 20;

export function useDashboardPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const canUseIntegrationQueries = isLoaded && isSignedIn && isAuthenticated;

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showMemoryForm, setShowMemoryForm] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryData | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryGenerationError, setSummaryGenerationError] = useState<
    string | null
  >(null);

  const userTimeZone = getResolvedTimeZone();
  const dayKey = useMemo(
    () => getDayKeyForTimestamp(selectedDate.getTime(), userTimeZone),
    [selectedDate, userTimeZone],
  );

  const generateSummaryForDay = useAction(
    api.summaryGeneration.generateSummaryForDay,
  );

  const summary = useQuery(
    api.summaries.getSummaryByDay,
    isAuthenticated ? { dayKey } : "skip",
  ) as DashboardSummary | undefined;

  const {
    results: memories,
    status: memoriesStatus,
    loadMore: loadMoreMemories,
  } = usePaginatedQuery(
    api.memories.listMemoriesByDayPaginated,
    isAuthenticated ? { dayKey } : "skip",
    { initialNumItems: DASHBOARD_MEMORIES_PAGE_SIZE },
  );

  const day = useQuery(
    api.days.getDay,
    isAuthenticated ? { dayKey } : "skip",
  ) as DashboardDay | undefined;

  const integrationDailyData = useQuery(
    api.integrations.listMyIntegrationDailyDataForDay,
    canUseIntegrationQueries ? { dayKey } : "skip",
  ) as Array<DashboardIntegrationSource> | undefined;

  const memoriesWithThumbnail = memories as Array<
    MemoryData & { thumbnailUrl?: string | null }
  >;

  const isLoading = useMemo(
    () =>
      isAuthLoading ||
      (isAuthenticated &&
        memoriesStatus === "LoadingFirstPage" &&
        memoriesWithThumbnail.length === 0),
    [
      isAuthLoading,
      isAuthenticated,
      memoriesStatus,
      memoriesWithThumbnail.length,
    ],
  );

  const isSummaryLoading = isAuthenticated && summary === undefined;
  const isMemoriesLoading =
    isAuthenticated &&
    memoriesStatus === "LoadingFirstPage" &&
    memoriesWithThumbnail.length === 0;
  const canLoadMoreMemories = memoriesStatus === "CanLoadMore";
  const isLoadingMoreMemories = memoriesStatus === "LoadingMore";

  const hasMemories = memoriesWithThumbnail.length > 0;
  const hasDayMetadata =
    day?.rating !== undefined ||
    (day?.manualNotes?.length ?? 0) > 0 ||
    (day?.peopleTags?.length ?? 0) > 0;
  const hasIntegrationData = (integrationDailyData?.length ?? 0) > 0;
  const hasSummarySourceData =
    hasMemories || hasDayMetadata || hasIntegrationData;

  const handleEditMemory = useCallback((memory: MemoryData) => {
    setEditingMemory(memory);
    setShowMemoryForm(true);
  }, []);

  const handleFormSuccess = useCallback(() => {
    setShowMemoryForm(false);
    setEditingMemory(null);
  }, []);

  const handleFormCancel = useCallback(() => {
    setShowMemoryForm(false);
    setEditingMemory(null);
  }, []);

  const handleDeleteSuccess = useCallback(() => {
    // Convex queries update automatically when data changes.
  }, []);

  const handleGenerateSummary = useCallback(async () => {
    logInfo("web_summary_generation_started", {
      status: "started",
      dayKey,
      hasSummarySourceData,
    });

    setSummaryGenerationError(null);
    setIsGeneratingSummary(true);

    try {
      const result = (await generateSummaryForDay({
        dayKey,
      })) as GenerateSummaryForDayResult;
      const failureMessage = getSummaryGenerationFailureResultMessage(result);

      if (failureMessage) {
        logWarn("web_summary_generation_result_failed", {
          status: "failed",
          dayKey,
          errorMessage: failureMessage,
        });
        setSummaryGenerationError(failureMessage);
        toastError(failureMessage);
        return;
      }

      logInfo("web_summary_generation_succeeded", {
        status: "succeeded",
        dayKey,
      });

      toastSuccess("Summary generated successfully");
    } catch (error) {
      const message = getSummaryGenerationErrorMessage(error);
      captureException("web_summary_generation_failed", error, {
        status: "failed",
        dayKey,
        errorMessage: message,
      });
      setSummaryGenerationError(message);
      toastError(message);
    } finally {
      setIsGeneratingSummary(false);
    }
  }, [dayKey, generateSummaryForDay, hasSummarySourceData]);

  const loadMoreMemoriesPage = useCallback(() => {
    loadMoreMemories(DASHBOARD_MEMORIES_PAGE_SIZE);
  }, [loadMoreMemories]);

  const openNewMemoryForm = useCallback(() => {
    setShowMemoryForm(true);
  }, []);

  const latestMemoryMood = useMemo(() => {
    const moodFromMemories =
      memoriesWithThumbnail.length > 0
        ? (memoriesWithThumbnail[0]?.mood ?? null)
        : null;
    return moodFromMemories
      ? `${MOOD_EMOJI[moodFromMemories] ?? "😐"} ${MOOD_LABELS[moodFromMemories] ?? moodFromMemories}`
      : "—";
  }, [memoriesWithThumbnail]);

  const sourceRows = useMemo(
    () =>
      (integrationDailyData ?? [])
        .slice()
        .sort((a, b) => b.syncedAt - a.syncedAt),
    [integrationDailyData],
  );

  const providerLabelMap = useMemo(() => getIntegrationProviderLabelMap(), []);

  const metricItems = useMemo(() => {
    const summaryMetrics = summary?.metrics;
    return [
      summaryMetrics?.steps
        ? {
            label: "Steps",
            value: `${summaryMetrics.steps.toLocaleString()}`,
          }
        : null,
      summaryMetrics?.sleepMinutes
        ? {
            label: "Sleep",
            value: formatMinutesAsHours(summaryMetrics.sleepMinutes),
          }
        : null,
      summaryMetrics?.screenTimeMinutes
        ? {
            label: "Screen time",
            value: formatMinutesAsHours(summaryMetrics.screenTimeMinutes),
          }
        : null,
      summaryMetrics?.spendingTotal !== undefined
        ? {
            label: "Spending",
            value: `$${summaryMetrics.spendingTotal.toFixed(2)}`,
          }
        : null,
    ].filter((item): item is { label: string; value: string } => Boolean(item));
  }, [summary?.metrics]);

  return {
    isLoading,
    selectedDate,
    setSelectedDate,
    dayKey,
    showMemoryForm,
    editingMemory,
    isGeneratingSummary,
    summaryGenerationError,
    summary,
    isSummaryLoading,
    memoriesWithThumbnail,
    isMemoriesLoading,
    canLoadMoreMemories,
    isLoadingMoreMemories,
    hasSummarySourceData,
    day,
    integrationDailyData,
    latestMemoryMood,
    sourceRows,
    providerLabelMap,
    metricItems,
    handleEditMemory,
    handleFormSuccess,
    handleFormCancel,
    handleDeleteSuccess,
    handleGenerateSummary,
    loadMoreMemoriesPage,
    openNewMemoryForm,
  };
}
