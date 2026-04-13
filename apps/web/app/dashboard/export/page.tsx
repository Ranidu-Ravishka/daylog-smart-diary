"use client";

import { makeFunctionReference } from "convex/server";
import {
  useAction,
  useConvex,
  useConvexAuth,
  usePaginatedQuery,
} from "convex/react";
import { useState, type ChangeEvent } from "react";
import {
  Download,
  Check,
  FileText,
  BookOpen,
  MapPin,
  Upload,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { captureException } from "@/lib/observability";
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

type RestoreDataset =
  | "summaries"
  | "memories"
  | "days"
  | "integrationDailyData";
type RestoreConflictMode = "skip" | "overwrite";
type RestoreJobStatus = "running" | "succeeded" | "partial" | "failed";
type RestorePhase =
  | "idle"
  | "reading"
  | "validating"
  | "validated"
  | "restoring"
  | "success"
  | "failed";

type RestoreValidationResult = {
  valid: boolean;
  schemaVersion: number;
  exportedAt: string;
  ownerClerkUserId: string;
  counts: {
    summaries: number;
    memories: number;
    days: number;
    integrationDailyData: number;
  };
};

type RestoreBatchStats = {
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  conflicts: number;
  failed: number;
  errorSamples: string[];
};

type RestoreExecutionResult = {
  jobId: string;
  status: "success" | "partial";
  requestedAt: number;
  restoredAt: number;
  conflictMode: RestoreConflictMode;
  allowPartial: boolean;
  selectedDatasets: RestoreDataset[];
  sourceCounts: {
    summaries: number;
    memories: number;
    days: number;
    integrationDailyData: number;
  };
  totals: RestoreBatchStats;
  datasetResults: Record<RestoreDataset, RestoreBatchStats>;
};

type RestoreJobListRow = {
  jobId: string;
  status: RestoreJobStatus;
  requestedAt: number;
  completedAt?: number;
  failedAt?: number;
  updatedAt: number;
  conflictMode: RestoreConflictMode;
  allowPartial: boolean;
  selectedDatasets: RestoreDataset[];
  exportedAt: string | null;
  sourceCounts: {
    summaries: number;
    memories: number;
    days: number;
    integrationDailyData: number;
  } | null;
  totals: RestoreBatchStats | null;
  datasetResults: Record<RestoreDataset, RestoreBatchStats> | null;
  error: string | null;
};

const RESTORE_DATASETS: RestoreDataset[] = [
  "summaries",
  "memories",
  "days",
  "integrationDailyData",
];

const RESTORE_DATASET_LABELS: Record<RestoreDataset, string> = {
  summaries: "Summaries",
  memories: "Memories",
  days: "Day records",
  integrationDailyData: "Integration rows",
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
const listMyRestoreJobsPaginatedRef = makeFunctionReference<"query">(
  "summaries:listMyRestoreJobsPaginated",
);
const validateMyDiaryRestorePayloadRef = makeFunctionReference<"action">(
  "summaries:validateMyDiaryRestorePayload",
);
const restoreMyDiaryDataRef = makeFunctionReference<"action">(
  "summaries:restoreMyDiaryData",
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

function restorePhaseToProgress(phase: RestorePhase): number {
  if (phase === "reading") return 25;
  if (phase === "validating") return 55;
  if (phase === "validated") return 65;
  if (phase === "restoring") return 90;
  if (phase === "success") return 100;
  if (phase === "failed") return 100;
  return 0;
}

function restorePhaseLabel(phase: RestorePhase): string {
  if (phase === "reading") return "Reading backup file";
  if (phase === "validating") return "Validating ownership and integrity";
  if (phase === "validated") return "Validation complete";
  if (phase === "restoring") return "Applying restore";
  if (phase === "success") return "Restore finished";
  if (phase === "failed") return "Restore failed";
  return "Idle";
}

function restoreJobStatusBadgeClass(status: RestoreJobStatus): string {
  if (status === "succeeded") {
    return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }
  if (status === "partial") {
    return "bg-amber-100 text-amber-800 border-amber-200";
  }
  if (status === "failed") {
    return "bg-red-100 text-red-800 border-red-200";
  }

  return "bg-blue-100 text-blue-800 border-blue-200";
}

export default function ExportPage() {
  const prepareMyDiaryExportArtifact = useAction(
    prepareMyDiaryExportArtifactRef,
  );
  const validateMyDiaryRestorePayload = useAction(
    validateMyDiaryRestorePayloadRef,
  );
  const restoreMyDiaryData = useAction(restoreMyDiaryDataRef);
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>("json");
  const [includeLocationSignals, setIncludeLocationSignals] = useState(false);
  const [preparedExport, setPreparedExport] =
    useState<PreparedExportArtifact | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePhase, setRestorePhase] = useState<RestorePhase>("idle");
  const [isValidatingRestore, setIsValidatingRestore] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreConflictMode, setRestoreConflictMode] =
    useState<RestoreConflictMode>("skip");
  const [allowPartialRestore, setAllowPartialRestore] = useState(true);
  const [restoreValidation, setRestoreValidation] =
    useState<RestoreValidationResult | null>(null);
  const [restoreResult, setRestoreResult] =
    useState<RestoreExecutionResult | null>(null);
  const [restoreFailure, setRestoreFailure] = useState<string | null>(null);
  const [restoreDatasetSelection, setRestoreDatasetSelection] = useState<
    Record<RestoreDataset, boolean>
  >({
    summaries: true,
    memories: true,
    days: true,
    integrationDailyData: true,
  });

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

  const {
    results: restoreJobResults,
    status: restoreJobsStatus,
    loadMore: loadMoreRestoreJobs,
  } = usePaginatedQuery(
    listMyRestoreJobsPaginatedRef,
    isAuthenticated ? {} : "skip",
    { initialNumItems: 10 },
  );
  const restoreJobs = restoreJobResults as RestoreJobListRow[];

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
      captureException("web_export_prepare_failed", error, {
        format,
        includeLocationSignals,
      });
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
      captureException("web_export_download_historical_failed", error, {
        jobId,
      });
      toastError("Unable to download this export right now.");
    } finally {
      setDownloadingJobId(null);
    }
  };

  const selectedRestoreDatasets = RESTORE_DATASETS.filter(
    (dataset) => restoreDatasetSelection[dataset],
  );
  const restoreInProgress = isValidatingRestore || isRestoring;
  const restoreProgress = restorePhaseToProgress(restorePhase);

  const handleRestoreFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setRestoreFile(nextFile);
    setRestoreValidation(null);
    setRestoreResult(null);
    setRestoreFailure(null);
    setRestorePhase("idle");
  };

  const toggleRestoreDataset = (dataset: RestoreDataset) => {
    setRestoreDatasetSelection((current) => ({
      ...current,
      [dataset]: !current[dataset],
    }));
  };

  const readRestorePayloadText = async (): Promise<string | null> => {
    if (!restoreFile) {
      toastError("Choose a JSON backup file first.");
      return null;
    }

    setRestorePhase("reading");
    return await restoreFile.text();
  };

  const handleValidateRestore = async () => {
    if (!isAuthenticated) {
      toastError("You must be signed in to validate a backup.");
      return;
    }

    setIsValidatingRestore(true);
    setRestoreFailure(null);
    setRestoreResult(null);

    try {
      const payloadText = await readRestorePayloadText();
      if (!payloadText) {
        setRestorePhase("failed");
        return;
      }

      setRestorePhase("validating");
      const validation = (await validateMyDiaryRestorePayload({
        payloadText,
      })) as RestoreValidationResult;
      setRestoreValidation(validation);
      setRestorePhase("validated");
      toastSuccess("Backup validated successfully.");
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Failed to validate backup.";

      setRestoreFailure(message);
      setRestorePhase("failed");
      captureException("web_restore_validate_failed", error, {});
      toastError(message);
    } finally {
      setIsValidatingRestore(false);
    }
  };

  const handleRestore = async () => {
    if (!isAuthenticated) {
      toastError("You must be signed in to restore data.");
      return;
    }

    if (selectedRestoreDatasets.length === 0) {
      toastError("Select at least one dataset to restore.");
      return;
    }

    setIsRestoring(true);
    setRestoreFailure(null);
    setRestoreResult(null);

    try {
      const payloadText = await readRestorePayloadText();
      if (!payloadText) {
        setRestorePhase("failed");
        return;
      }

      setRestorePhase("validating");
      const validation = (await validateMyDiaryRestorePayload({
        payloadText,
      })) as RestoreValidationResult;
      setRestoreValidation(validation);

      setRestorePhase("restoring");
      const result = (await restoreMyDiaryData({
        payloadText,
        datasets: selectedRestoreDatasets,
        conflictMode: restoreConflictMode,
        allowPartial: allowPartialRestore,
      })) as RestoreExecutionResult;

      setRestoreResult(result);
      setRestorePhase("success");

      if (result.status === "partial") {
        toastError("Restore finished with partial failures. Review details.");
      } else {
        toastSuccess("Restore completed successfully.");
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Restore failed.";

      setRestoreFailure(message);
      setRestorePhase("failed");
      captureException("web_restore_execute_failed", error, {
        conflictMode: restoreConflictMode,
        allowPartialRestore,
        selectedRestoreDatasets,
      });
      toastError(message);
    } finally {
      setIsRestoring(false);
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
      <h1 className="text-xl font-semibold tracking-tight mb-1">
        Export & Restore Data
      </h1>
      <p className="text-sm text-muted-foreground mb-8">
        Download a backup of your data, then restore it with ownership and
        integrity checks.
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

      <Card className="mt-8 mb-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload className="h-4 w-4" /> Restore from backup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Restore accepts signed JSON backups generated by this account.
            Tampered or ownership-mismatched files are rejected.
          </div>

          <div className="space-y-2">
            <Label htmlFor="restore-backup-file">Backup file (JSON)</Label>
            <input
              id="restore-backup-file"
              type="file"
              accept="application/json,.json"
              onChange={handleRestoreFileChange}
              className="block w-full text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {restoreFile
                ? `Selected: ${restoreFile.name}`
                : "Choose a backup file exported from this workspace."}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Datasets to restore</Label>
            <div className="grid grid-cols-2 gap-2">
              {RESTORE_DATASETS.map((dataset) => (
                <label
                  key={dataset}
                  className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={restoreDatasetSelection[dataset]}
                    onChange={() => toggleRestoreDataset(dataset)}
                    className="h-3.5 w-3.5"
                  />
                  {RESTORE_DATASET_LABELS[dataset]}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Conflict handling</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={restoreConflictMode === "skip" ? "default" : "outline"}
                size="sm"
                onClick={() => setRestoreConflictMode("skip")}
                disabled={restoreInProgress}
              >
                Skip conflicts
              </Button>
              <Button
                type="button"
                variant={
                  restoreConflictMode === "overwrite" ? "default" : "outline"
                }
                size="sm"
                onClick={() => setRestoreConflictMode("overwrite")}
                disabled={restoreInProgress}
              >
                Overwrite conflicts
              </Button>
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-md border p-3 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allowPartialRestore}
              onChange={(event) => setAllowPartialRestore(event.target.checked)}
              disabled={restoreInProgress}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span>
              Allow partial restore. If enabled, invalid or conflicting rows are
              skipped and the rest continues.
            </span>
          </label>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleValidateRestore()}
              disabled={!restoreFile || restoreInProgress}
            >
              <ShieldCheck className="h-4 w-4" />
              {isValidatingRestore ? "Validating..." : "Validate backup"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleRestore()}
              disabled={!restoreFile || restoreInProgress}
            >
              {isRestoring ? "Restoring..." : "Restore selected datasets"}
            </Button>
          </div>

          {restorePhase !== "idle" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{restorePhaseLabel(restorePhase)}</span>
                <span>{restoreProgress}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${restoreProgress}%` }}
                />
              </div>
            </div>
          )}

          {restoreValidation && (
            <div className="rounded-md border p-3 text-xs space-y-1">
              <p className="font-medium">Validated backup metadata</p>
              <p>
                Exported at:{" "}
                {formatDateTime(Date.parse(restoreValidation.exportedAt))}
              </p>
              <p>Owner: {restoreValidation.ownerClerkUserId}</p>
              <p>
                Rows: summaries {restoreValidation.counts.summaries} | memories{" "}
                {restoreValidation.counts.memories} | days{" "}
                {restoreValidation.counts.days} | integrations{" "}
                {restoreValidation.counts.integrationDailyData}
              </p>
            </div>
          )}

          {restoreResult && (
            <div className="rounded-md border p-3 text-xs space-y-2">
              <p className="font-medium">
                Restore{" "}
                {restoreResult.status === "partial"
                  ? "completed with warnings"
                  : "completed"}
              </p>
              <p>
                Processed {restoreResult.totals.processed} | Inserted{" "}
                {restoreResult.totals.inserted} | Updated{" "}
                {restoreResult.totals.updated} | Skipped{" "}
                {restoreResult.totals.skipped} | Conflicts{" "}
                {restoreResult.totals.conflicts} | Failed{" "}
                {restoreResult.totals.failed}
              </p>
              {RESTORE_DATASETS.map((dataset) => {
                const stats = restoreResult.datasetResults[dataset];
                return (
                  <p key={dataset}>
                    {RESTORE_DATASET_LABELS[dataset]}: processed{" "}
                    {stats.processed}, inserted {stats.inserted}, updated{" "}
                    {stats.updated}, skipped {stats.skipped}, conflicts{" "}
                    {stats.conflicts}, failed {stats.failed}
                  </p>
                );
              })}
              {restoreResult.totals.errorSamples.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-red-600">Error samples</p>
                  {restoreResult.totals.errorSamples
                    .slice(0, 5)
                    .map((error, index) => (
                      <p key={`${error}-${index}`} className="text-red-600">
                        {error}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}

          {restoreFailure && (
            <p className="text-xs text-red-600">{restoreFailure}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Recent restores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {restoreJobs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No restore runs yet. Upload a backup above to create one.
            </p>
          )}

          {restoreJobs.map((job) => (
            <div
              key={job.jobId}
              className="rounded-md border p-3 flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Restore run</p>
                  <p className="text-xs text-muted-foreground">
                    Requested: {formatDateTime(job.requestedAt)}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${restoreJobStatusBadgeClass(
                    job.status,
                  )}`}
                >
                  {job.status}
                </span>
              </div>

              <p className="text-xs text-muted-foreground">
                Conflict mode: {job.conflictMode} | Partial restore:{" "}
                {job.allowPartial ? "enabled" : "disabled"}
              </p>

              <p className="text-xs text-muted-foreground">
                Datasets:{" "}
                {job.selectedDatasets
                  .map((dataset) => RESTORE_DATASET_LABELS[dataset])
                  .join(", ")}
              </p>

              {job.totals && (
                <p className="text-xs text-muted-foreground">
                  Processed {job.totals.processed} | Inserted{" "}
                  {job.totals.inserted} | Updated {job.totals.updated} | Skipped{" "}
                  {job.totals.skipped} | Conflicts {job.totals.conflicts} |
                  Failed {job.totals.failed}
                </p>
              )}

              {(job.datasetResults ||
                job.sourceCounts ||
                Boolean(job.exportedAt) ||
                Boolean(job.completedAt) ||
                Boolean(job.failedAt) ||
                (job.totals?.errorSamples.length ?? 0) > 0) && (
                <details className="rounded-md border bg-muted/20 p-2">
                  <summary className="cursor-pointer text-xs font-medium">
                    View run details
                  </summary>
                  <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                    <p>
                      Exported:{" "}
                      {job.exportedAt
                        ? formatDateTime(Date.parse(job.exportedAt))
                        : "-"}{" "}
                      | Completed: {formatDateTime(job.completedAt)} | Failed:{" "}
                      {formatDateTime(job.failedAt)}
                    </p>

                    {job.sourceCounts && (
                      <p>
                        Source rows: summaries {job.sourceCounts.summaries} |
                        memories {job.sourceCounts.memories} | days{" "}
                        {job.sourceCounts.days} | integrations{" "}
                        {job.sourceCounts.integrationDailyData}
                      </p>
                    )}

                    {job.datasetResults && (
                      <div className="space-y-1">
                        {RESTORE_DATASETS.map((dataset) => {
                          const stats = job.datasetResults?.[dataset];
                          if (!stats) {
                            return null;
                          }

                          return (
                            <p key={`${job.jobId}-${dataset}`}>
                              {RESTORE_DATASET_LABELS[dataset]}: processed{" "}
                              {stats.processed}, inserted {stats.inserted},
                              updated {stats.updated}, skipped {stats.skipped},
                              conflicts {stats.conflicts}, failed {stats.failed}
                            </p>
                          );
                        })}
                      </div>
                    )}

                    {(job.totals?.errorSamples.length ?? 0) > 0 && (
                      <div className="space-y-1">
                        <p className="font-medium text-red-600">
                          Error samples
                        </p>
                        {job.totals?.errorSamples
                          .slice(0, 5)
                          .map((error, index) => (
                            <p
                              key={`${job.jobId}-error-${index}`}
                              className="text-red-600"
                            >
                              {error}
                            </p>
                          ))}
                      </div>
                    )}
                  </div>
                </details>
              )}

              {job.status === "failed" && job.error && (
                <p className="text-xs text-red-600">{job.error}</p>
              )}
            </div>
          ))}

          {restoreJobsStatus === "CanLoadMore" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadMoreRestoreJobs(10)}
            >
              Load more restores
            </Button>
          )}
        </CardContent>
      </Card>

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
