"use client";

import { useQuery, useConvexAuth } from "convex/react";
import { api } from "@repo/backend/convex";
import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Clock,
  FileText,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

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

function formatDate(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y!, m! - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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

export default function DashboardPage() {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const [selectedDate, setSelectedDate] = useState(() => new Date());

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

  const navigateDay = (offset: number) => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + offset);
      return d;
    });
  };

  const isToday = getDayKey(new Date()) === dayKey;

  if (isLoading) return <LoadingSkeleton />;

  const moodFromMemories =
    memories && memories.length > 0 ? (memories[0]?.mood ?? null) : null;

  return (
    <div className="max-w-2xl">
      {/* ── Date navigation ───────────────────────────── */}
      <div className="flex items-center gap-3 mb-8">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => navigateDay(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {formatDate(dayKey)}
          </h1>
          {isToday && <p className="text-xs text-muted-foreground">Today</p>}
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => navigateDay(1)}
          disabled={isToday}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

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
            <div className="flex justify-center gap-0.5">
              {[1, 2, 3, 4, 5].map((s) => (
                <span
                  key={s}
                  className={`text-sm ${s <= (day?.rating ?? 0) ? "text-foreground" : "text-border"}`}
                >
                  ★
                </span>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Rating</p>
          </CardContent>
        </Card>
      </div>

      {/* ── AI Summary ────────────────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">AI Summary</h2>
        </div>
        {summary ? (
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

      {/* ── Memories ──────────────────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Memories</h2>
        </div>
        {memories && memories.length > 0 ? (
          <div className="space-y-2">
            {memories.map((memory) => {
              const time = new Date(memory.happenedAt);
              const h = time.getHours();
              const m = String(time.getMinutes()).padStart(2, "0");
              const ampm = h >= 12 ? "PM" : "AM";
              const fmtH = h % 12 || 12;

              return (
                <Card
                  key={memory._id}
                  className="transition-colors hover:bg-muted/30"
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium">{memory.title}</p>
                      <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                        {fmtH}:{m} {ampm}
                      </span>
                    </div>
                    {memory.description && (
                      <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                        {memory.description}
                      </p>
                    )}
                    {memory.mood && (
                      <Badge variant="secondary" className="mt-2">
                        {MOOD_EMOJI[memory.mood] ?? "😐"} {memory.mood}
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <Clock className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                No memories for this day.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Capture moments using the mobile app.
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
