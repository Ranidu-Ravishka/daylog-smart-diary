"use client";

import { useQuery, useConvexAuth } from "convex/react";
import { api } from "@repo/backend/convex";
import { useState } from "react";
import { Download, Check, FileText, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ExportPage() {
  const { isAuthenticated } = useConvexAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const summaries = useQuery(
    api.summaries.listRecentSummaries,
    isAuthenticated ? { limit: 365 } : "skip",
  );
  const memories = useQuery(
    api.memories.listRecentMemories,
    isAuthenticated ? { limit: 1000 } : "skip",
  );

  const handleExport = () => {
    if (!summaries || !memories) return;
    setIsExporting(true);

    try {
      const exportData = {
        exportedAt: new Date().toISOString(),
        summaries: summaries.map((s) => ({
          dayKey: s.dayKey,
          story: s.story,
          highlights: s.highlights,
          metrics: s.metrics,
          sourcesUsed: s.sourcesUsed,
          generatedAt: new Date(s.generatedAt).toISOString(),
        })),
        memories: memories.map((m) => ({
          title: m.title,
          description: m.description,
          mood: m.mood,
          dayKey: m.dayKey,
          happenedAt: new Date(m.happenedAt).toISOString(),
        })),
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `daylog-export-${new Date().toISOString().split("T")[0]}.json`;
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

  const totalSummaries = summaries?.length ?? 0;
  const totalMemories = memories?.length ?? 0;

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold tracking-tight mb-1">Export Data</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Download a copy of all your personal data in JSON format.
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
              "Timestamps for all entries",
              "Exported in portable JSON format",
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

      {/* ── Download ──────────────────────────────────── */}
      <Button
        onClick={handleExport}
        disabled={isExporting || !summaries || !memories}
      >
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
