export const ACCOUNT_DELETION_STAGES = [
  "memoryMedia",
  "memories",
  "daySummaries",
  "days",
  "integrations",
  "integrationDailyData",
  "integrationSecrets",
  "integrationSyncRuns",
  "exportJobs",
  "restoreJobs",
  "summaryQualityEvaluations",
  "summaryGenerationEvents",
  "integrationHealthEvents",
  "userPreferences",
  "auditLogs",
  "platformAuditEvents",
  "summaryGenerationQuotas",
] as const;

export type AccountDeletionState =
  | "requested"
  | "processing"
  | "completed"
  | "failed";

export type AccountDeletionStage = (typeof ACCOUNT_DELETION_STAGES)[number];

type DeletionStatusShape = {
  requested?: boolean;
  job?: {
    status?: string;
    stage?: string;
  } | null;
} | null;

function isAccountDeletionState(value: unknown): value is AccountDeletionState {
  return (
    value === "requested" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed"
  );
}

export function deriveDeletionState(
  status: DeletionStatusShape | undefined,
): AccountDeletionState | undefined {
  const jobStatus = status?.job?.status;
  if (isAccountDeletionState(jobStatus)) {
    return jobStatus;
  }

  if (status?.requested) {
    return "requested";
  }

  return undefined;
}

export function getDeletionStateLabel(state: AccountDeletionState): string {
  if (state === "requested") {
    return "Requested";
  }

  if (state === "processing") {
    return "Processing";
  }

  if (state === "completed") {
    return "Completed";
  }

  return "Failed";
}

export function formatDeletionStageLabel(
  stage: string | null | undefined,
): string {
  if (!stage) {
    return "Pending";
  }

  return stage
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (value) => value.toUpperCase());
}

export function getDeletionProgressPercent(
  state: AccountDeletionState | undefined,
  stage: string | null | undefined,
): number {
  const stageIndex = stage
    ? ACCOUNT_DELETION_STAGES.indexOf(stage as AccountDeletionStage)
    : -1;
  const stagePercent =
    stageIndex >= 0
      ? Math.round(((stageIndex + 1) / ACCOUNT_DELETION_STAGES.length) * 100)
      : 0;

  if (state === "completed") {
    return 100;
  }

  if (state === "requested") {
    return Math.max(5, stagePercent);
  }

  if (state === "processing") {
    return Math.max(8, stagePercent);
  }

  return Math.max(0, stagePercent);
}

export function shouldLockDeletionNavigation(options: {
  deletionState: AccountDeletionState | undefined;
  isFinalizingDeletion: boolean;
}): boolean {
  return (
    options.isFinalizingDeletion ||
    options.deletionState === "requested" ||
    options.deletionState === "processing"
  );
}
