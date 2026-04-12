"use client";

import { makeFunctionReference } from "convex/server";
import {
  useAction,
  useConvex,
  useConvexAuth,
  usePaginatedQuery,
} from "convex/react";
import { useState } from "react";
import { Download, Check, FileText, BookOpen, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toastError, toastSuccess } from "@/lib/toast";

type ExportFormat = "json" | "txt";
type ExportJobStatus = "queued" | "running" | "ready" | "failed";

type PreparedExportArtifact = {
  jobId: string;
  status: ExportJobStatus;
  requestedAt: number;
  exportedAt: number;
  completedAt: number;
  expiresAt: number;
  format: ExportFormat;
  fileName: string;
  storageId: string;
  downloadUrl: string;
  artifactMimeType: string;
  artifactSizeBytes: number;
  counts: {
    summaries: number;
    memories: number;
    days: number;
    integrationDailyData: number;
  };
};

type ExportJobListRow = {
  jobId: string;
  status: ExportJobStatus;
  format: ExportFormat;
  includeLocationSignals: boolean;
  requestedAt: number;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  updatedAt: number;
  error?: string;
  expiresAt: number;
  counts: {
    summaries: number;
    memories: number;
    days: number;
    integrationDailyData: number;
  } | null;
  fileName: string | null;
  artifactMimeType: string | null;
  artifactSizeBytes: number | null;
  downloadUrl: string | null;
};

type ExportJobDownload = {
  jobId: string;
  status: ExportJobStatus;
  format: ExportFormat;
  fileName: string | null;
  artifactMimeType: string | null;
  artifactSizeBytes: number | null;
  downloadUrl: string;
  expiresAt: number;
};

const prepareMyDiaryExportArtifactRef = makeFunctionReference<"action">(
  "summaries:prepareMyDiaryExportArtifact",
);
const listMyExportJobsPaginatedRef = makeFunctionReference<"query">(
  "summaries:listMyExportJobsPaginated",
);
const getMyExportJobDownloadUrlRef = makeFunctionReference<"query">(
  "summaries:getMyExportJobDownloadUrl",
);

function formatDateTime(value?: number): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function statusBadgeClass(status: ExportJobStatus): string {
  if (status === "ready") {
    return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }
  if (status === "failed") {
    return "bg-red-100 text-red-800 border-red-200";
  }
  if (status === "running") {
    return "bg-blue-100 text-blue-800 border-blue-200";
  }

  return "bg-amber-100 text-amber-800 border-amber-200";
}

function triggerBrowserDownload(url: string, fileName?: string | null) {
  const link = document.createElement("a");
  link.href = url;
  if (fileName && fileName.trim()) {
    link.download = fileName;
  }
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function ExportPage() {
  const prepareMyDiaryExportArtifact = useAction(
    prepareMyDiaryExportArtifactRef,
  );
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>("json");
  const [includeLocationSignals, setIncludeLocationSignals] = useState(false);
  const [preparedExport, setPreparedExport] =
    useState<PreparedExportArtifact | null>(null);

  const {
    results: exportJobResults,
    status: exportJobsStatus,
    loadMore: loadMoreExportJobs,
  } = usePaginatedQuery(
    listMyExportJobsPaginatedRef,
    isAuthenticated ? {} : "skip",
    { initialNumItems: 10 },
  );
  const exportJobs = exportJobResults as ExportJobListRow[];

  const latestReadyJob = exportJobs.find((job) => job.status === "ready");

  const handleExport = async () => {
    if (!isAuthenticated) {
      toastError("You must be signed in to export data.");
      return;
    }

    setIsExporting(true);

    try {
      const exportArtifact = (await prepareMyDiaryExportArtifact({
        format,
        includeLocationSignals,
      })) as PreparedExportArtifact;

      setPreparedExport(exportArtifact);
      triggerBrowserDownload(
        exportArtifact.downloadUrl,
        exportArtifact.fileName,
      );

      setExported(true);
      toastSuccess("Data export downloaded.");
      setTimeout(() => setExported(false), 3000);
    } catch (error) {
      console.error("Export failed", error);
      toastError("Failed to export data. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadPreviousExport = async (jobId: string) => {
    setDownloadingJobId(jobId);
    try {
      const payload = (await convex.query(getMyExportJobDownloadUrlRef, {
        jobId,
      })) as ExportJobDownload;

      triggerBrowserDownload(payload.downloadUrl, payload.fileName);
      toastSuccess("Export downloaded.");
    } catch (error) {
      console.error("Failed to download historical export", error);
      toastError("Unable to download this export right now.");
    } finally {
      setDownloadingJobId(null);
    }
  };

  const totalSummaries =
    preparedExport?.counts.summaries ?? latestReadyJob?.counts?.summaries ?? 0;
  const totalMemories =
    preparedExport?.counts.memories ?? latestReadyJob?.counts?.memories ?? 0;
  const totalDays =
    preparedExport?.counts.days ?? latestReadyJob?.counts?.days ?? 0;
  const totalIntegrationRows =
    preparedExport?.counts.integrationDailyData ??
    latestReadyJob?.counts?.integrationDailyData ??
    0;

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold tracking-tight mb-1">Export Data</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Download a copy of your personal data in JSON or plain text.
      </p>

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
            ].map((item, index) => (
              <li
                key={index}
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

      <Button onClick={() => void handleExport()} disabled={isExporting}>
        <Download className="h-4 w-4" />
        {isExporting
          ? "Preparing..."
          : exported
            ? "Downloaded"
            : "Download my data"}
      </Button>

      <Card className="mt-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Recent exports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {exportJobs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No export jobs yet. Create your first export above.
            </p>
          )}

          {exportJobs.map((job) => (
            <div
              key={job.jobId}
              className="rounded-md border p-3 flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {job.fileName ?? `Export ${job.format.toUpperCase()}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Requested: {formatDateTime(job.requestedAt)}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${statusBadgeClass(
                    job.status,
                  )}`}
                >
                  {job.status}
                </span>
              </div>

              <p className="text-xs text-muted-foreground">
                Format: {job.format.toUpperCase()} | Size:{" "}
                {formatBytes(job.artifactSizeBytes)} | Expires:{" "}
                {formatDateTime(job.expiresAt)}
              </p>

              {job.counts && (
                <p className="text-xs text-muted-foreground">
                  Summaries {job.counts.summaries} | Memories{" "}
                  {job.counts.memories} | Days {job.counts.days} | Integrations{" "}
                  {job.counts.integrationDailyData}
                </p>
              )}

              {job.status === "failed" && job.error && (
                <p className="text-xs text-red-600">{job.error}</p>
              )}

              {job.status === "ready" && (
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={downloadingJobId === job.jobId}
                    onClick={() => void handleDownloadPreviousExport(job.jobId)}
                  >
                    {downloadingJobId === job.jobId
                      ? "Downloading..."
                      : "Download again"}
                  </Button>
                </div>
              )}
            </div>
          ))}

          {exportJobsStatus === "CanLoadMore" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadMoreExportJobs(10)}
            >
              Load more exports
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
