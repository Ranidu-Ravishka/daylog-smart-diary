import { cronJobs, makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
const scheduleDueIntegrationRevocationsInternal =
  makeFunctionReference<"mutation">(
    "integrations:scheduleDueIntegrationRevocationsInternal",
  );

crons.interval(
  "retention-cleanup-every-6h",
  { hours: 6 },
  internal.retention.runScheduledRetentionCleanupInternal,
  {
    dryRun: false,
  },
);

crons.interval(
  "redact-legacy-summary-generation-content-daily",
  { hours: 24 },
  internal.summaryQuality.redactLegacySummaryGenerationEventContentInternal,
  {
    batchSize: 100,
  },
);

crons.interval(
  "remove-legacy-ai-summary-attempt-input-hashes-daily",
  { hours: 24 },
  internal.summaryQuality.removeLegacyAiSummaryAttemptInputHashesInternal,
  {
    batchSize: 100,
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

crons.interval(
  "retry-pending-integration-revocations-every-15m",
  { minutes: 15 },
  scheduleDueIntegrationRevocationsInternal,
  {
    limit: 100,
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
