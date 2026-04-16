"use client";

import {
  useAction,
  useQuery,
  useConvexAuth,
  usePaginatedQuery,
} from "convex/react";
import { api } from "@repo/backend/convex";
import { MOOD_EMOJI } from "@repo/ui/lib/constants";
import {
  getDayKeyForTimestamp,
  getResolvedTimeZone,
} from "@repo/ui/lib/day-window";
import { useState } from "react";
import {
  Sparkles,
  Clock,
  FileText,
  Users,
  Activity,
  Database,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DayRating } from "@/components/DayRating";
import { MemoryForm } from "@/components/MemoryForm";
import { MemoryCard, type MemoryData } from "@/components/MemoryCard";
import { DashboardDatePicker } from "@/components/DashboardDatePicker";
import { captureException, logInfo, logWarn } from "@/lib/observability";
import { toastError, toastSuccess } from "@/lib/toast";

function LoadingSkeleton() {
  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-8 w-8" />
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-32" />
    </div>
  );
}

function SummarySkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Separator className="my-4" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </CardContent>
    </Card>
  );
}

function MemoriesSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((item) => (
        <Card key={item}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function formatMinutesAsHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function redactPotentialSecrets(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-[redacted]")
    .replace(/(api key provided\s*:?\s*)[A-Za-z0-9_*.-]+/gi, "$1[redacted]");
}

function getSummaryGenerationErrorMessage(error: unknown): string {
  const fallback = "Failed to generate summary. Please try again.";
  if (!(error instanceof Error) || !error.message) return fallback;

  const rawMessage = error.message;
  const noDataSignature =
    "No memories, day metadata, or integration sync data found for this date";

  if (rawMessage.includes(noDataSignature)) {
    return "Add at least one memory, day note/rating/tag, or synced integration data before generating a summary.";
  }

  const lines = rawMessage
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const candidate = lines.find(
    (line) =>
      !line.startsWith("[CONVEX ") &&
      !line.startsWith("[Request ID:") &&
      !line.startsWith("Called by client") &&
      !line.startsWith("at handler"),
  );

  if (!candidate) return fallback;

  const cleaned = candidate
    .replace(/^Uncaught Error:\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  const redacted = redactPotentialSecrets(cleaned);

  if (/OpenAI authentication failed \((401|403)\)/i.test(redacted)) {
    return "Summary generation is temporarily unavailable. Please try again later.";
  }

  return redacted || fallback;
}

function getSummaryGenerationFailureResultMessage(
  result: unknown,
): string | null {
  if (typeof result !== "object" || result === null) return null;

  const candidate = result as {
    success?: unknown;
    message?: unknown;
  };

  if (candidate.success !== false) return null;

  if (typeof candidate.message === "string" && candidate.message.trim()) {
    return candidate.message.trim();
  }

  return "Failed to generate summary. Please try again.";
}

const MEMORIES_PAGE_SIZE = 20;

export default function DashboardPage() {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showMemoryForm, setShowMemoryForm] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryData | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryGenerationError, setSummaryGenerationError] = useState<
    string | null
  >(null);

  const userTimeZone = getResolvedTimeZone();
  const dayKey = getDayKeyForTimestamp(selectedDate.getTime(), userTimeZone);
  const generateSummaryForDay = useAction(
    api.summaryGeneration.generateSummaryForDay,
  );

  const summary = useQuery(
    api.summaries.getSummaryByDay,
    isAuthenticated ? { dayKey } : "skip",
  );
  const {
    results: memories,
    status: memoriesStatus,
    loadMore: loadMoreMemories,
  } = usePaginatedQuery(
    api.memories.listMemoriesByDayPaginated,
    isAuthenticated ? { dayKey } : "skip",
    { initialNumItems: MEMORIES_PAGE_SIZE },
  );
  const day = useQuery(api.days.getDay, isAuthenticated ? { dayKey } : "skip");
  const integrationDailyData = useQuery(
    api.integrations.listMyIntegrationDailyDataForDay,
    isAuthenticated ? { dayKey } : "skip",
  );

  const memoriesWithThumbnail = memories as Array<
    MemoryData & { thumbnailUrl?: string | null }
  >;

  const isLoading =
    isAuthLoading ||
    (isAuthenticated &&
      memoriesStatus === "LoadingFirstPage" &&
      memoriesWithThumbnail.length === 0);
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

  const handleEditMemory = (memory: MemoryData) => {
    setEditingMemory(memory);
    setShowMemoryForm(true);
  };

  const handleFormSuccess = () => {
    setShowMemoryForm(false);
    setEditingMemory(null);
  };

  const handleFormCancel = () => {
    setShowMemoryForm(false);
    setEditingMemory(null);
  };

  const handleDeleteSuccess = () => {
    // Trigger a refetch by just letting React/Convex handle it naturally
    // The query will re-run automatically when the data changes
  };

  const handleGenerateSummary = async () => {
    logInfo("web_summary_generation_started", {
      status: "started",
      dayKey,
      hasSummarySourceData,
    });

    setSummaryGenerationError(null);
    setIsGeneratingSummary(true);

    try {
      const result = await generateSummaryForDay({ dayKey });
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
  };

  if (isLoading) return <LoadingSkeleton />;

  const moodFromMemories =
    memoriesWithThumbnail.length > 0
      ? (memoriesWithThumbnail[0]?.mood ?? null)
      : null;

  const latestMemoryMood = moodFromMemories
    ? (MOOD_EMOJI[moodFromMemories] ?? "😐")
    : "—";

  const sourceRows = (integrationDailyData ?? []).slice().sort((a, b) => {
    return b.syncedAt - a.syncedAt;
  });

  const providerLabel: Record<string, string> = {
    location: "Location (coarse foreground)",
    google_calendar: "Google Calendar",
    google_fit: "Google Fit",
    spotify: "Spotify",
    apple_health: "Apple Health",
  };

  const summaryMetrics = summary?.metrics;
  const metricItems = [
    summaryMetrics?.steps
      ? { label: "Steps", value: `${summaryMetrics.steps.toLocaleString()}` }
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

  return (
    <div className="max-w-2xl">
      <DashboardDatePicker
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      {/* ── Quick stats ───────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xl">{latestMemoryMood}</p>
            <p className="mt-1 text-xs text-muted-foreground">Latest mood</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xl font-semibold">
              {memoriesWithThumbnail.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Memories</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <DayRating dayKey={dayKey} initialRating={day?.rating ?? null} />
          </CardContent>
        </Card>
      </div>

      {/* ── AI Summary ────────────────────────────────── */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">AI Summary</h2>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateSummary}
            disabled={isGeneratingSummary || !hasSummarySourceData}
          >
            {isGeneratingSummary ? "Generating..." : "Generate Summary"}
          </Button>
        </div>
        {summary?.generatedAt ? (
          <p className="mb-3 text-xs text-muted-foreground">
            Last generated: {formatDateTime(summary.generatedAt)}
          </p>
        ) : null}
        {summaryGenerationError ? (
          <Card className="mb-3 border-destructive/30">
            <CardContent className="p-3 text-xs text-destructive">
              {summaryGenerationError}
            </CardContent>
          </Card>
        ) : null}
        {isSummaryLoading ? (
          <SummarySkeleton />
        ) : summary ? (
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {summary.story}
              </p>
              {summary.highlights && summary.highlights.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <p className="text-xs font-medium mb-2">Highlights</p>
                  <ul className="space-y-1">
                    {summary.highlights.map((h, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-muted-foreground"
                      >
                        <span className="mt-1 block h-1 w-1 rounded-full bg-foreground shrink-0" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {summary.sourcesUsed && summary.sourcesUsed.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {summary.sourcesUsed.map((src) => (
                    <Badge key={src} variant="secondary">
                      {src}
                    </Badge>
                  ))}
                </div>
              )}
              {metricItems.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                      <Activity className="h-3.5 w-3.5" />
                      Metrics
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {metricItems.map((metric) => (
                        <div
                          key={metric.label}
                          className="rounded-md border border-border p-2"
                        >
                          <p className="text-[11px] text-muted-foreground">
                            {metric.label}
                          </p>
                          <p className="text-sm font-medium">{metric.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                No summary generated for this day yet.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {hasSummarySourceData
                  ? "Click Generate Summary to create one from your day data."
                  : "Add a memory, rating, note, or people tag, then generate a summary."}
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Data sources for this day</h2>
        </div>

        {(integrationDailyData ?? undefined) === undefined ? (
          <SummarySkeleton />
        ) : sourceRows.length > 0 ? (
          <Card>
            <CardContent className="p-4 space-y-3">
              {sourceRows.map((row) => (
                <div
                  key={`${row.provider}-${row.dayKey}`}
                  className="rounded-md border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {row.provider === "location" ? (
                        <MapPin className="h-3.5 w-3.5" />
                      ) : null}
                      {providerLabel[row.provider] ?? row.provider}
                    </div>
                    <Badge variant="secondary">
                      Synced {formatDateTime(row.syncedAt)}
                    </Badge>
                  </div>

                  {row.summary ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {row.summary}
                    </p>
                  ) : null}

                  {row.signals && row.signals.length > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Signals: {row.signals.slice(0, 2).join(" • ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              No integration sync data for this day yet.
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Create Memory Form ────────────────────────── */}
      {showMemoryForm && (
        <MemoryForm
          dayKey={dayKey}
          memoryId={editingMemory?._id}
          initialData={
            editingMemory
              ? {
                  title: editingMemory.title,
                  description: editingMemory.description,
                  mood: editingMemory.mood,
                  happenedAt: editingMemory.happenedAt,
                }
              : undefined
          }
          onSuccess={handleFormSuccess}
          onCancel={handleFormCancel}
        />
      )}

      {!showMemoryForm && (
        <Button onClick={() => setShowMemoryForm(true)} className="mb-8">
          + Add Memory
        </Button>
      )}

      {/* ── Memories ──────────────────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Memories</h2>
        </div>
        {isMemoriesLoading ? (
          <MemoriesSkeleton />
        ) : memoriesWithThumbnail.length > 0 ? (
          <div className="space-y-2">
            {memoriesWithThumbnail.map((memory) => (
              <MemoryCard
                key={memory._id}
                memory={memory as MemoryData}
                thumbnailUrl={memory.thumbnailUrl}
                onEdit={handleEditMemory}
                onDeleteSuccess={handleDeleteSuccess}
              />
            ))}

            {(canLoadMoreMemories || isLoadingMoreMemories) && (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadMoreMemories(MEMORIES_PAGE_SIZE)}
                  disabled={isLoadingMoreMemories}
                >
                  {isLoadingMoreMemories
                    ? "Loading more..."
                    : "Load more memories"}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <Clock className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                No memories today.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Everything is working—this day just has no data yet. Add a
                memory to get started.
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Notes ─────────────────────────────────────── */}
      {day?.manualNotes && day.manualNotes.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Notes</h2>
          </div>
          <Card>
            <CardContent className="p-5">
              <ul className="space-y-1.5">
                {day.manualNotes.map((note, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <span className="mt-1.5 block h-1 w-1 rounded-full bg-foreground shrink-0" />
                    {note}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── People ────────────────────────────────────── */}
      {day?.peopleTags && day.peopleTags.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">People</h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {day.peopleTags.map((person, i) => (
              <Badge key={i} variant="outline">
                {person}
              </Badge>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
