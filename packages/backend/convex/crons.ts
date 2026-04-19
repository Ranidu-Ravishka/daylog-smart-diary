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

crons.interval(
  "cleanup-legacy-unsupported-integrations-daily",
  { hours: 24 },
  internal.integrations.cleanupLegacyUnsupportedIntegrationsInternal,
  {
    batchSizePerProvider: 25,
    maxPasses: 2,
    force: false,
  },
);

export default crons;
