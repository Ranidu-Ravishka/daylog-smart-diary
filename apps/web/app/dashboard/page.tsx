"use client";

import { useQuery, useConvexAuth } from "convex/react";
import { api } from "@repo/backend/convex";
import { useState } from "react";
import { Sparkles, Clock, FileText, Users, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DayRating } from "@/components/DayRating";
import { MemoryForm } from "@/components/MemoryForm";
import { MemoryCard, type MemoryData } from "@/components/MemoryCard";
import { DashboardDatePicker } from "@/components/DashboardDatePicker";

const MOOD_EMOJI: Record<string, string> = {
  happy: "😊",
  sad: "😢",
  excited: "🎉",
  peaceful: "😌",
  loved: "❤️",
  angry: "😤",
  anxious: "😰",
  neutral: "😐",
};

function getDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

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

export default function DashboardPage() {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showMemoryForm, setShowMemoryForm] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryData | null>(null);

  const dayKey = getDayKey(selectedDate);

  const summary = useQuery(
    api.summaries.getSummaryByDay,
    isAuthenticated ? { dayKey } : "skip",
  );
  const memories = useQuery(
    api.memories.listMemoriesByDay,
    isAuthenticated ? { dayKey } : "skip",
  );
  const day = useQuery(api.days.getDay, isAuthenticated ? { dayKey } : "skip");

  const isLoading =
    isAuthLoading || (isAuthenticated && memories === undefined);
  const isSummaryLoading = isAuthenticated && summary === undefined;
  const isMemoriesLoading = isAuthenticated && memories === undefined;

  const hasMemories = (memories?.length ?? 0) > 0;
  const isSummaryPending = !isSummaryLoading && !summary && hasMemories;

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

  if (isLoading) return <LoadingSkeleton />;

  const moodFromMemories =
    memories && memories.length > 0 ? (memories[0]?.mood ?? null) : null;

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
            <p className="text-xl">
              {moodFromMemories ? (MOOD_EMOJI[moodFromMemories] ?? "😐") : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Mood</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xl font-semibold">{memories?.length ?? 0}</p>
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
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">AI Summary</h2>
        </div>
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
        ) : isSummaryPending ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Sparkles className="mx-auto mb-3 h-8 w-8 animate-pulse text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                Generating summary...
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                We found memories for this day and are preparing your day
                summary.
              </p>
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
                Summaries are created automatically from your memories.
              </p>
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
        ) : memories && memories.length > 0 ? (
          <div className="space-y-2">
            {memories.map((memory) => (
              <MemoryCard
                key={memory._id}
                memory={memory as MemoryData}
                onEdit={handleEditMemory}
                onDeleteSuccess={handleDeleteSuccess}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <Clock className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                No memories for this day yet.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Create a memory to get started.
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
