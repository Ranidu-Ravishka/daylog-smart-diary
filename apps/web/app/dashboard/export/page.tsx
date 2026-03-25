"use client";

import { useQuery, useConvexAuth } from "convex/react";
import { api } from "@repo/backend/convex";
import { useState } from "react";
import { Download, Check, FileText, BookOpen, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type ExportFormat = "json" | "txt";

function toTextExport(data: {
  exportedAt: number;
  summaries: Array<{
    dayKey: string;
    story: string;
    highlights: string[];
    metrics?: {
      steps?: number;
      sleepMinutes?: number;
      screenTimeMinutes?: number;
      spendingTotal?: number;
    };
  }>;
  memories: Array<{
    dayKey: string;
    title: string;
    description?: string;
    mood?: string;
    happenedAt: number;
  }>;
  days: Array<{
    dayKey: string;
    rating?: number;
    manualNotes: string[];
    peopleTags: string[];
  }>;
  integrationDailyData: Array<{
    provider: string;
    dayKey: string;
    summary?: string;
    signals?: string[];
  }>;
}) {
  const parts: string[] = [];
  parts.push(`DayLog Export`);
  parts.push(`Exported at: ${new Date(data.exportedAt).toISOString()}`);
  parts.push("");

  parts.push("=== Days ===");
  for (const day of data.days) {
    parts.push(`- ${day.dayKey}`);
    parts.push(`  Rating: ${day.rating ?? "—"}`);
    parts.push(`  Notes: ${day.manualNotes.length}`);
    parts.push(`  People tags: ${day.peopleTags.length}`);
  }
  parts.push("");

  parts.push("=== Memories ===");
  for (const memory of data.memories) {
    parts.push(`- [${memory.dayKey}] ${memory.title}`);
    parts.push(`  Mood: ${memory.mood ?? "—"}`);
    parts.push(`  Time: ${new Date(memory.happenedAt).toISOString()}`);
    if (memory.description?.trim()) {
      parts.push(`  Description: ${memory.description.trim()}`);
    }
  }
  parts.push("");

  parts.push("=== Summaries ===");
  for (const summary of data.summaries) {
    parts.push(`- [${summary.dayKey}]`);
    parts.push(`  Story: ${summary.story}`);
    if (summary.highlights.length > 0) {
      parts.push(`  Highlights: ${summary.highlights.join(" | ")}`);
    }
    if (summary.metrics) {
      const metricLines = [
        summary.metrics.steps ? `steps=${summary.metrics.steps}` : null,
        summary.metrics.sleepMinutes
          ? `sleepMinutes=${summary.metrics.sleepMinutes}`
          : null,
        summary.metrics.screenTimeMinutes
          ? `screenTimeMinutes=${summary.metrics.screenTimeMinutes}`
          : null,
        summary.metrics.spendingTotal !== undefined
          ? `spendingTotal=${summary.metrics.spendingTotal}`
          : null,
      ].filter(Boolean);
      if (metricLines.length > 0) {
        parts.push(`  Metrics: ${metricLines.join(", ")}`);
      }
    }
  }
  parts.push("");

  parts.push("=== Integration Daily Data ===");
  for (const item of data.integrationDailyData) {
    parts.push(`- [${item.dayKey}] ${item.provider}`);
    if (item.summary) parts.push(`  Summary: ${item.summary}`);
    if ((item.signals?.length ?? 0) > 0) {
      parts.push(`  Signals: ${(item.signals ?? []).join(" | ")}`);
    }
  }

  return parts.join("\n");
}

export default function ExportPage() {
  const { isAuthenticated } = useConvexAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("json");
  const [includeLocationSignals, setIncludeLocationSignals] = useState(false);

  const exportData = useQuery(
    api.summaries.exportMyDiaryData,
    isAuthenticated ? { includeLocationSignals } : "skip",
  );

  const handleExport = () => {
    if (!exportData) return;
    setIsExporting(true);

    try {
      const datePart = new Date().toISOString().split("T")[0];
      const fileName = `daylog-export-${datePart}.${format}`;

      const payload =
        format === "json"
          ? JSON.stringify(
              {
                ...exportData,
                exportedAt: new Date(exportData.exportedAt).toISOString(),
              },
              null,
              2,
            )
          : toTextExport(exportData);

      const blob = new Blob([payload], {
        type: format === "json" ? "application/json" : "text/plain",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } finally {
      setIsExporting(false);
    }
  };

  const totalSummaries = exportData?.summaries.length ?? 0;
  const totalMemories = exportData?.memories.length ?? 0;
  const totalDays = exportData?.days.length ?? 0;
  const totalIntegrationRows = exportData?.integrationDailyData.length ?? 0;

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold tracking-tight mb-1">Export Data</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Download a copy of your personal data in JSON or plain text.
      </p>

      {/* ── Overview ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border">
              <FileText className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{totalSummaries}</p>
              <p className="text-xs text-muted-foreground">Summaries</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{totalMemories}</p>
              <p className="text-xs text-muted-foreground">Memories</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card>
          <CardContent className="p-5">
            <p className="text-2xl font-semibold">{totalDays}</p>
            <p className="text-xs text-muted-foreground">Day records</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-2xl font-semibold">{totalIntegrationRows}</p>
            <p className="text-xs text-muted-foreground">Integration rows</p>
          </CardContent>
        </Card>
      </div>

      {/* ── What's included ───────────────────────────── */}
      <Card className="mb-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">What&apos;s included</CardTitle>
        </CardHeader>
        <CardContent className="pb-5">
          <ul className="space-y-2.5">
            {[
              "All daily summaries with AI-generated stories & highlights",
              "All memories with titles, descriptions, and moods",
              "Day ratings, notes, and people tags",
              "Integration sync summaries and daily signals",
              "Timestamps for all entries",
              "Exported in JSON or plain text",
            ].map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 text-sm text-muted-foreground"
              >
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Export options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={format === "json" ? "default" : "outline"}
              size="sm"
              onClick={() => setFormat("json")}
            >
              JSON
            </Button>
            <Button
              type="button"
              variant={format === "txt" ? "default" : "outline"}
              size="sm"
              onClick={() => setFormat("txt")}
            >
              Text
            </Button>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <Label
                htmlFor="include-location-signals"
                className="flex items-center gap-1.5 text-sm font-medium"
              >
                <MapPin className="h-3.5 w-3.5" /> Include location signals
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Privacy-first default is OFF. Location data is coarse daily area
                labels only, never raw continuous tracking.
              </p>
            </div>
            <input
              id="include-location-signals"
              type="checkbox"
              checked={includeLocationSignals}
              onChange={(event) =>
                setIncludeLocationSignals(event.target.checked)
              }
              className="h-4 w-4 rounded border-border"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Download ──────────────────────────────────── */}
      <Button onClick={handleExport} disabled={isExporting || !exportData}>
        <Download className="h-4 w-4" />
        {isExporting
          ? "Preparing…"
          : exported
            ? "Downloaded"
            : "Download my data"}
      </Button>
    </div>
  );
}
