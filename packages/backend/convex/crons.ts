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

// Purge consumed/expired mobile OAuth handoff codes. Rows naturally expire
// after 10 minutes; this keeps the table from growing unbounded.
crons.interval(
  "purge-oauth-mobile-handoffs-hourly",
  { hours: 1 },
  internal.integrations.purgeExpiredOAuthMobileHandoffsInternal,
  {
    limit: 500,
  },
);

export default crons;
