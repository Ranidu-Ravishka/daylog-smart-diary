import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "retention-cleanup-every-6h",
  { hours: 6 },
  (internal as any).retention.runScheduledRetentionCleanupInternal,
  {
    dryRun: false,
  },
);

crons.interval(
  "export-job-retention-cleanup-every-6h",
  { hours: 6 },
  (internal as any).summaries.runScheduledExportJobRetentionCleanupInternal,
  {},
);

crons.interval(
  "restore-job-retention-cleanup-every-6h",
  { hours: 6 },
  (internal as any).summaries.runScheduledRestoreJobRetentionCleanupInternal,
  {},
);

export default crons;
