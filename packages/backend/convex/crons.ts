import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "retention-cleanup-every-6h",
  { hours: 6 },
  internal.retention.runScheduledRetentionCleanupInternal,
  {
    dryRun: false,
  },
);

export default crons;
