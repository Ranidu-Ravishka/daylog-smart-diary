export type DeletionJobStatus =
  | "requested"
  | "processing"
  | "completed"
  | "failed";

export type RowDeletionStatus = "requested" | "processing" | "failed";

type DeletionFlowJob = {
  userId: string;
  status: DeletionJobStatus;
  updatedAt: number;
};

export function isDeletionJobActive(status: DeletionJobStatus): boolean {
  return status === "requested" || status === "processing";
}

export function isDeletionJobTerminal(status: DeletionJobStatus): boolean {
  return status === "completed" || status === "failed";
}

export function buildActiveDeletionStatusByUserId<T extends DeletionFlowJob>(
  jobs: readonly T[],
): Map<string, DeletionJobStatus> {
  const latestJobByUserId = new Map<string, T>();
  const statuses = new Map<string, DeletionJobStatus>();

  for (const job of jobs) {
    if (!isDeletionJobActive(job.status)) {
      continue;
    }

    const previous = latestJobByUserId.get(job.userId);
    if (!previous || job.updatedAt >= previous.updatedAt) {
      latestJobByUserId.set(job.userId, job);
    }
  }

  for (const [userId, job] of latestJobByUserId) {
    statuses.set(userId, job.status);
  }

  return statuses;
}

export function buildRowDeletionStatusByUserId<T extends DeletionFlowJob>(
  jobs: readonly T[],
): Map<string, RowDeletionStatus> {
  const latestJobByUserId = new Map<string, T>();
  const statuses = new Map<string, RowDeletionStatus>();

  for (const job of jobs) {
    if (job.status === "completed") {
      continue;
    }

    const previous = latestJobByUserId.get(job.userId);
    if (!previous || job.updatedAt >= previous.updatedAt) {
      latestJobByUserId.set(job.userId, job);
    }
  }

  for (const [userId, job] of latestJobByUserId) {
    if (job.status === "requested" || job.status === "processing") {
      statuses.set(userId, job.status);
      continue;
    }

    statuses.set(userId, "failed");
  }

  return statuses;
}
