import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  mutation,
  query,
} from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import {
  getActiveUserById,
  requireAdmin,
  requireUser,
  requireOwnership,
} from "./authz";
import { clampLimit, validateDayKey } from "./validators";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  asIntegrationProvider,
  assertDailyDataProvider,
  assertIntegrationProvider,
  integrationProviderList,
  type DailyDataProvider,
} from "./integrationProviders";
import { getRequiredIntegrationPlugin } from "./integrationPlugins";
import { applyDashboardMetricsDelta } from "./dashboardMetrics";
import {
  constantTimeStringEquals,
  decryptIntegrationSecret,
  getActiveIntegrationSecretKeyId,
} from "./integrationSecretsCrypto";
import { recordIntegrationHealthEventInDb } from "./integrationHealth";
import type { PlatformAuditCategory } from "./platformAudit";
import { captureException, logInfo, logWarn } from "./observability";
import {
  getBackgroundLocationBatchFlushIntervalMinutes,
  getBackgroundLocationBatchMaxPoints,
  getBackgroundLocationMaxBatteryDrainPercentPerHour,
  getBackgroundLocationMaxUpdatesPerHour,
  getEnableBackgroundLocationTracking,
} from "./runtimeConfig";
import { evaluateFeatureFlagForIdentity } from "./featureFlags";
import {
  buildIntegrationContextAggregate,
  sanitizeContext,
  sanitizeMetrics,
  sanitizeSignalText,
  sanitizeSignals,
  sanitizeSummaryText,
  type IntegrationContextAggregateRow,
  type IntegrationContextAggregateSyncRun,
  type IntegrationDailyContext,
  type IntegrationDailyMetrics,
} from "./integrations.dailyData";
import {
  assertOpaqueTokenRef,
  assertEncryptedOnlySecretRecord,
  deleteIntegrationSecretByRef,
  hasLegacyPlaintextSecretFields,
  isLegacyNonOpaqueTokenRef,
  isOpaqueTokenRef,
  normalizeTokenRef,
  upsertIntegrationSecret,
  type IntegrationSecretRecord,
} from "./integrations.auth";
import { syncMyIntegrationForDayImpl } from "./integrations.sync";
import {
  UNSUPPORTED_PROVIDERS,
  isUnsupportedProvider,
  type UnsupportedProvider,
} from "./unsupportedProviders";
import {
  buildIntegrationDailySensitiveWritePayload,
  withIntegrationDailySensitiveFields,
} from "./sensitiveDataFields";
import {
  clampContextAggregateSyncRunsLimit,
  clampListMyDailyDataForDayLimit,
  clampListMyIntegrationsLimit,
  clampListMySyncRunsForDayLimit,
  clampSummaryGenerationIntegrationLimit,
} from "./integrations/utilities/integrationLimits";

const SYNC_RUN_IN_PROGRESS_TTL_MS = 60_000;
const DELETE_BATCH_SIZE = 256;
const LEGACY_SECRETS_AUDIT_DEFAULT_PAGE_SIZE = 200;
const LEGACY_SECRETS_AUDIT_MAX_PAGE_SIZE = 500;
const LEGACY_SECRETS_AUDIT_DEFAULT_MAX_PAGES = 100;
const LEGACY_SECRETS_AUDIT_MAX_PAGES = 2_000;
const LEGACY_TOKEN_REF_AUDIT_DEFAULT_MAX_ROWS = 500;
const LEGACY_TOKEN_REF_AUDIT_MAX_ROWS = 5_000;
const LEGACY_OPAQUE_TOKEN_REF_SCAN_LIMIT = 100;
const LEGACY_UNSUPPORTED_CLEANUP_DEFAULT_BATCH_SIZE_PER_PROVIDER = 25;
const INTEGRATION_REVOCATION_MAX_ATTEMPTS = 5;
const INTEGRATION_REVOCATION_STALE_ATTEMPT_MS = 2 * 60 * 1000;
const INTEGRATION_REVOCATION_JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const INTEGRATION_REVOCATION_ACTION_REF = makeFunctionReference<"action">(
  "integrations:processIntegrationRevocationInternal",
);
const INTEGRATION_REVOCATION_JOB_QUERY_REF = makeFunctionReference<"query">(
  "integrations:getIntegrationRevocationJobInternal",
);
const INTEGRATION_REVOCATION_SECRET_QUERY_REF = makeFunctionReference<"query">(
  "integrations:getIntegrationAccessTokenByRefInternal",
);
const INTEGRATION_REVOCATION_BEGIN_REF = makeFunctionReference<"mutation">(
  "integrations:beginIntegrationRevocationAttemptInternal",
);
const INTEGRATION_REVOCATION_FINISH_REF = makeFunctionReference<"mutation">(
  "integrations:finishIntegrationRevocationInternal",
);
const INTEGRATION_REVOCATION_RETRY_REF = makeFunctionReference<"mutation">(
  "integrations:retryIntegrationRevocationInternal",
);
const LEGACY_UNSUPPORTED_CLEANUP_MAX_BATCH_SIZE_PER_PROVIDER = 250;
const LEGACY_UNSUPPORTED_CLEANUP_DEFAULT_MAX_PASSES = 2;
const LEGACY_UNSUPPORTED_CLEANUP_MAX_PASSES = 20;
const LEGACY_UNSUPPORTED_COUNT_DEFAULT_MAX_PASSES = 40;
const LEGACY_UNSUPPORTED_COUNT_MAX_PASSES = 1_000;
const LEGACY_UNSUPPORTED_CLEANUP_AUDIT_ACTION =
  "cleanup_legacy_unsupported_integrations";
const LEGACY_UNSUPPORTED_CLEANUP_CURSOR_STATE_ACTION =
  "cleanup_legacy_unsupported_integrations_cursor_state";
const LEGACY_UNSUPPORTED_CLEANUP_CURSOR_STATE_TARGET =
  "legacy_unsupported_integrations";
const LEGACY_UNSUPPORTED_CLEANUP_CURSOR_STATE_SCAN_LIMIT = 500;
const LEGACY_UNSUPPORTED_OFFSET_CURSOR_PREFIX = "offset:";
const LEGACY_TOKEN_REF_MIGRATION_AUDIT_ACTION =
  "migrate_legacy_integration_token_ref";
const OPAQUE_TOKEN_REF_DEFINITION =
  'A tokenRef is opaque when it is a non-empty string prefixed with "tokref_" and does not store raw provider tokens.';
const UNSAFE_LEGACY_TOKEN_REF_REASON =
  "Unsafe legacy integration token reference was invalidated. Reconnect this integration.";
const LEGACY_UNSUPPORTED_REASON =
  "This integration provider is no longer supported and has been automatically disconnected.";

const integrationDailyMetricsValidator = v.object({
  steps: v.optional(v.number()),
  sleepMinutes: v.optional(v.number()),
  screenTimeMinutes: v.optional(v.number()),
  spendingTotal: v.optional(v.number()),
});

const contextualActivityLevelValidator = v.union(
  v.literal("active"),
  v.literal("mixed"),
  v.literal("idle"),
);

const integrationLocationStayPointValidator = v.object({
  label: v.string(),
  startedAt: v.number(),
  endedAt: v.number(),
  durationMinutes: v.number(),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  radiusMeters: v.optional(v.number()),
});

const integrationDailyContextValidator = v.object({
  schemaVersion: v.optional(v.number()),
  location: v.optional(
    v.object({
      mode: v.union(
        v.literal("foreground"),
        v.literal("background_controlled"),
      ),
      totalTrackedMinutes: v.optional(v.number()),
      totalDistanceMeters: v.optional(v.number()),
      stayPoints: v.optional(v.array(integrationLocationStayPointValidator)),
    }),
  ),
  fitness: v.optional(
    v.object({
      steps: v.optional(v.number()),
      distanceMeters: v.optional(v.number()),
      activeMinutes: v.optional(v.number()),
      idleMinutes: v.optional(v.number()),
      source: v.optional(v.string()),
    }),
  ),
  calendar: v.optional(
    v.object({
      meetingsCount: v.optional(v.number()),
      busyMinutes: v.optional(v.number()),
      remindersCount: v.optional(v.number()),
      eventTitles: v.optional(v.array(v.string())),
    }),
  ),
  activitySummary: v.optional(
    v.object({
      callsCount: v.optional(v.number()),
      callDurationMinutes: v.optional(v.number()),
      mood: v.optional(v.string()),
      moodConfidence: v.optional(v.number()),
      activityLevel: v.optional(contextualActivityLevelValidator),
    }),
  ),
});

const contextualDailyDataTypeValidator = v.union(
  v.literal("location"),
  v.literal("fitness"),
  v.literal("calendar"),
  v.literal("activity_summary"),
);

type IntegrationRecord = {
  _id: Id<"integrations">;
  userId: Id<"user">;
  provider: string;
  status: "connected" | "disconnected" | "error";
  lastSyncAt?: number;
  lastError?: string;
  scopes?: string[];
  tokenRef?: string;
  remoteRevocationStatus?: "pending" | "revoked" | "unsupported" | "failed";
  remoteRevocationAttempts?: number;
  remoteRevocationNextAttemptAt?: number;
  remoteRevocationErrorCode?: string;
  legacyUnsupported?: boolean;
  legacyUnsupportedAt?: number;
  legacyUnsupportedReason?: string;
};

type LegacyIntegrationTokenRefAuditRow = {
  integrationId: Id<"integrations">;
  userId: Id<"user">;
  provider: string;
  status: "connected" | "disconnected" | "error";
  tokenRefPreview: string;
  tokenRefLength: number;
};

type UnsafeIntegrationTokenRefAuditRow = {
  integrationId: Id<"integrations">;
  userId: Id<"user">;
  provider: string;
  status: "connected" | "disconnected" | "error";
  tokenRefState: "missing" | "legacy_non_opaque";
  tokenRefPreview: string;
  tokenRefLength: number;
};

type LegacyIntegrationTokenRefAuditCounts = {
  totalRows: number;
  nonOpaqueCount: number;
  opaqueCount: number;
  missingTokenRefRows: number;
  pagesScanned: number;
  pageSize: number;
  isDone: boolean;
  continueCursor: string | null;
  rows: LegacyIntegrationTokenRefAuditRow[];
  rowsTruncated: boolean;
};

type LegacyIntegrationTokenRefMigrationCounts = {
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
  invalidatedCount: number;
  auditLogCount: number;
  scannedRows: number;
  nonOpaqueDetectedCount: number;
  opaqueCount: number;
  missingTokenRefRows: number;
};

type UnsafeIntegrationTokenRefAuditCounts = {
  totalRows: number;
  unsafeCount: number;
  pagesScanned: number;
  pageSize: number;
  isDone: boolean;
  continueCursor: string | null;
  rows: UnsafeIntegrationTokenRefAuditRow[];
  rowsTruncated: boolean;
};

type LegacyUnsupportedCleanupCounts = {
  trigger: "manual" | "cron";
  force: boolean;
  attemptId: string;
  batchSizePerProvider: number;
  maxPasses: number;
  maxRowsPerProvider: number;
  isDone: boolean;
  scannedRows: number;
  matchedRows: number;
  softDeletedRows: number;
  hardDeletedRows: number;
  deletedSecretRows: number;
  deletedSyncRunRows: number;
  failedRows: number;
  affectedUsers: number;
  rowsByProvider: Record<UnsupportedProvider, number>;
  failedRowsByProvider: Record<UnsupportedProvider, number>;
  pagesProcessedByProvider: Record<UnsupportedProvider, number>;
  nextCursorByProvider: Record<UnsupportedProvider, string | null>;
};

type LegacyUnsupportedCountSummary = {
  totalRows: number;
  pendingCleanupRows: number;
  softDeletedRows: number;
  affectedUsers: number;
  rowsByProvider: Record<UnsupportedProvider, number>;
  pagesScannedByProvider: Record<UnsupportedProvider, number>;
  nextCursorByProvider: Record<UnsupportedProvider, string | null>;
  isDone: boolean;
};

type LegacyUnsupportedProviderCursorMap = Partial<
  Record<UnsupportedProvider, string>
>;

type PlatformAuditEventRecord = {
  category: PlatformAuditCategory;
  action: string;
  actorType: "system" | "admin" | "user";
  actorUserId?: Id<"user">;
  target?: string;
  details?: string;
  at: number;
};

type LegacyUnsupportedCleanupCursorStatePayload = {
  version: 1;
  attemptId: string;
  trigger: "manual" | "cron";
  force: boolean;
  failedRows: number;
  isDone: boolean;
  nextCursorByProvider: Record<UnsupportedProvider, string | null>;
};

function normalizeAuditPageSize(value: number | undefined): number {
  return clampLimit(
    value ?? LEGACY_SECRETS_AUDIT_DEFAULT_PAGE_SIZE,
    LEGACY_SECRETS_AUDIT_MAX_PAGE_SIZE,
  );
}

function normalizeAuditMaxPages(value: number | undefined): number {
  return clampLimit(
    value ?? LEGACY_SECRETS_AUDIT_DEFAULT_MAX_PAGES,
    LEGACY_SECRETS_AUDIT_MAX_PAGES,
  );
}

function normalizeAuditMaxRows(value: number | undefined): number {
  return clampLimit(
    value ?? LEGACY_TOKEN_REF_AUDIT_DEFAULT_MAX_ROWS,
    LEGACY_TOKEN_REF_AUDIT_MAX_ROWS,
  );
}

function normalizeCleanupBatchSizePerProvider(
  value: number | undefined,
): number {
  const normalized =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : LEGACY_UNSUPPORTED_CLEANUP_DEFAULT_BATCH_SIZE_PER_PROVIDER;

  return clampLimit(
    normalized,
    LEGACY_UNSUPPORTED_CLEANUP_MAX_BATCH_SIZE_PER_PROVIDER,
  );
}

function normalizeCleanupMaxPasses(value: number | undefined): number {
  const normalized =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : LEGACY_UNSUPPORTED_CLEANUP_DEFAULT_MAX_PASSES;

  return clampLimit(normalized, LEGACY_UNSUPPORTED_CLEANUP_MAX_PASSES);
}

function normalizeLegacyUnsupportedCountMaxPasses(
  value: number | undefined,
): number {
  const normalized =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : LEGACY_UNSUPPORTED_COUNT_DEFAULT_MAX_PASSES;

  return clampLimit(normalized, LEGACY_UNSUPPORTED_COUNT_MAX_PASSES);
}

function createUnsupportedProviderCountMap(): Record<
  UnsupportedProvider,
  number
> {
  return {
    slack: 0,
    strava: 0,
    todoist: 0,
  };
}

function createUnsupportedProviderCursorMap(
  initial?: LegacyUnsupportedProviderCursorMap,
): Record<UnsupportedProvider, string | null> {
  return {
    slack: initial?.slack ?? null,
    strava: initial?.strava ?? null,
    todoist: initial?.todoist ?? null,
  };
}

function parseLegacyUnsupportedOffsetCursor(
  cursor: string | null | undefined,
): number {
  if (typeof cursor !== "string") {
    return 0;
  }

  const trimmed = cursor.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  const raw = trimmed.startsWith(LEGACY_UNSUPPORTED_OFFSET_CURSOR_PREFIX)
    ? trimmed.slice(LEGACY_UNSUPPORTED_OFFSET_CURSOR_PREFIX.length)
    : trimmed;
  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function formatLegacyUnsupportedOffsetCursor(offset: number): string {
  const safeOffset =
    Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  return `${LEGACY_UNSUPPORTED_OFFSET_CURSOR_PREFIX}${safeOffset}`;
}

function toLegacyUnsupportedProviderCursorArgs(
  cursorByProvider: Record<UnsupportedProvider, string | null>,
): LegacyUnsupportedProviderCursorMap | undefined {
  const next: LegacyUnsupportedProviderCursorMap = {};

  if (cursorByProvider.slack) {
    next.slack = cursorByProvider.slack;
  }

  if (cursorByProvider.strava) {
    next.strava = cursorByProvider.strava;
  }

  if (cursorByProvider.todoist) {
    next.todoist = cursorByProvider.todoist;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function parseLegacyUnsupportedProviderCursorMap(
  raw: unknown,
): Record<UnsupportedProvider, string | null> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const toCursor = (provider: UnsupportedProvider): string | null => {
    const candidate = value[provider];
    if (typeof candidate !== "string") {
      return null;
    }

    const trimmed = candidate.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    slack: toCursor("slack"),
    strava: toCursor("strava"),
    todoist: toCursor("todoist"),
  };
}

async function readPersistedLegacyUnsupportedCleanupCursorByProvider(
  db: QueryCtx["db"] | MutationCtx["db"],
): Promise<Record<UnsupportedProvider, string | null> | null> {
  const recentEvents = (await db
    .query("platformAuditEvents")
    .withIndex("by_category_at", (q) => q.eq("category", "integration_health"))
    .order("desc")
    .take(
      LEGACY_UNSUPPORTED_CLEANUP_CURSOR_STATE_SCAN_LIMIT,
    )) as PlatformAuditEventRecord[];

  for (const event of recentEvents) {
    if (event.action !== LEGACY_UNSUPPORTED_CLEANUP_CURSOR_STATE_ACTION) {
      continue;
    }

    if (!event.details) {
      return null;
    }

    try {
      const payload = JSON.parse(event.details) as {
        nextCursorByProvider?: unknown;
      };

      const parsed = parseLegacyUnsupportedProviderCursorMap(
        payload.nextCursorByProvider,
      );
      return parsed;
    } catch (error) {
      logWarn("legacy_unsupported_integrations_cleanup.cursor_state_invalid", {
        status: "warning",
        at: event.at,
        target: event.target,
        message: error instanceof Error ? error.message : "invalid_json",
      });

      return null;
    }
  }

  return null;
}

async function persistLegacyUnsupportedCleanupCursorState(
  db: MutationCtx["db"],
  summary: Pick<
    LegacyUnsupportedCleanupCounts,
    | "attemptId"
    | "trigger"
    | "force"
    | "failedRows"
    | "isDone"
    | "nextCursorByProvider"
  >,
): Promise<void> {
  const payload: LegacyUnsupportedCleanupCursorStatePayload = {
    version: 1,
    attemptId: summary.attemptId,
    trigger: summary.trigger,
    force: summary.force,
    failedRows: summary.failedRows,
    isDone: summary.isDone,
    nextCursorByProvider: summary.nextCursorByProvider,
  };

  await db.insert("platformAuditEvents", {
    category: "integration_health",
    action: LEGACY_UNSUPPORTED_CLEANUP_CURSOR_STATE_ACTION,
    actorType: "system",
    target: LEGACY_UNSUPPORTED_CLEANUP_CURSOR_STATE_TARGET,
    details: JSON.stringify(payload),
    at: Date.now(),
  });
}

function needsLegacyUnsupportedSoftCleanup(integration: IntegrationRecord) {
  return (
    integration.legacyUnsupported !== true ||
    integration.status !== "disconnected" ||
    integration.tokenRef !== undefined ||
    integration.scopes !== undefined ||
    integration.lastSyncAt !== undefined ||
    integration.lastError !== LEGACY_UNSUPPORTED_REASON ||
    integration.legacyUnsupportedAt === undefined ||
    integration.legacyUnsupportedReason !== LEGACY_UNSUPPORTED_REASON
  );
}

function redactTokenRef(value: string): string {
  if (value.length < 9) {
    return "<redacted>";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function scanLegacyIntegrationTokenRefs(
  db: QueryCtx["db"] | MutationCtx["db"],
  options: {
    pageSize: number;
    maxPages: number;
    includeRows: boolean;
    maxRows: number;
  },
): Promise<LegacyIntegrationTokenRefAuditCounts> {
  let cursor: string | null = null;
  let pagesScanned = 0;

  let totalRows = 0;
  let nonOpaqueCount = 0;
  let opaqueCount = 0;
  let missingTokenRefRows = 0;

  const rows: LegacyIntegrationTokenRefAuditRow[] = [];

  while (pagesScanned < options.maxPages) {
    const page = await db.query("integrations").paginate({
      numItems: options.pageSize,
      cursor,
    });

    pagesScanned += 1;

    for (const integration of page.page as IntegrationRecord[]) {
      totalRows += 1;

      const tokenRef = normalizeTokenRef(integration.tokenRef);
      if (!tokenRef) {
        missingTokenRefRows += 1;
        continue;
      }

      if (isOpaqueTokenRef(tokenRef)) {
        opaqueCount += 1;
        continue;
      }

      nonOpaqueCount += 1;

      if (options.includeRows && rows.length < options.maxRows) {
        rows.push({
          integrationId: integration._id,
          userId: integration.userId,
          provider: integration.provider,
          status: integration.status,
          tokenRefPreview: redactTokenRef(tokenRef),
          tokenRefLength: tokenRef.length,
        });
      }
    }

    if (page.isDone) {
      return {
        totalRows,
        nonOpaqueCount,
        opaqueCount,
        missingTokenRefRows,
        pagesScanned,
        pageSize: options.pageSize,
        isDone: true,
        continueCursor: null,
        rows,
        rowsTruncated: options.includeRows && rows.length < nonOpaqueCount,
      };
    }

    cursor = page.continueCursor;
    if (!cursor) break;
  }

  return {
    totalRows,
    nonOpaqueCount,
    opaqueCount,
    missingTokenRefRows,
    pagesScanned,
    pageSize: options.pageSize,
    isDone: false,
    continueCursor: cursor,
    rows,
    rowsTruncated: options.includeRows && rows.length < nonOpaqueCount,
  };
}

function providerRequiresStoredToken(provider: string): boolean {
  const normalizedProvider = asIntegrationProvider(provider);
  if (!normalizedProvider) {
    return false;
  }

  return getRequiredIntegrationPlugin(normalizedProvider).requiresStoredToken;
}

function classifyUnsafeTokenRefState(
  integration: IntegrationRecord,
): "missing" | "legacy_non_opaque" | null {
  if (integration.status === "disconnected") {
    return null;
  }

  if (!providerRequiresStoredToken(integration.provider)) {
    return null;
  }

  const tokenRef = normalizeTokenRef(integration.tokenRef);
  if (!tokenRef) {
    return "missing";
  }

  if (!isOpaqueTokenRef(tokenRef)) {
    return "legacy_non_opaque";
  }

  return null;
}

async function scanUnsafeIntegrationTokenRefs(
  db: QueryCtx["db"] | MutationCtx["db"],
  options: {
    pageSize: number;
    maxPages: number;
    includeRows: boolean;
    maxRows: number;
  },
): Promise<UnsafeIntegrationTokenRefAuditCounts> {
  let cursor: string | null = null;
  let pagesScanned = 0;

  let totalRows = 0;
  let unsafeCount = 0;
  const rows: UnsafeIntegrationTokenRefAuditRow[] = [];

  while (pagesScanned < options.maxPages) {
    const page = await db.query("integrations").paginate({
      numItems: options.pageSize,
      cursor,
    });

    pagesScanned += 1;

    for (const integration of page.page as IntegrationRecord[]) {
      totalRows += 1;

      const tokenRefState = classifyUnsafeTokenRefState(integration);
      if (!tokenRefState) {
        continue;
      }

      unsafeCount += 1;

      if (options.includeRows && rows.length < options.maxRows) {
        const tokenRef = normalizeTokenRef(integration.tokenRef);

        rows.push({
          integrationId: integration._id,
          userId: integration.userId,
          provider: integration.provider,
          status: integration.status,
          tokenRefState,
          tokenRefPreview: tokenRef ? redactTokenRef(tokenRef) : "<missing>",
          tokenRefLength: tokenRef ? tokenRef.length : 0,
        });
      }
    }

    if (page.isDone) {
      return {
        totalRows,
        unsafeCount,
        pagesScanned,
        pageSize: options.pageSize,
        isDone: true,
        continueCursor: null,
        rows,
        rowsTruncated: options.includeRows && rows.length < unsafeCount,
      };
    }

    cursor = page.continueCursor;
    if (!cursor) break;
  }

  return {
    totalRows,
    unsafeCount,
    pagesScanned,
    pageSize: options.pageSize,
    isDone: false,
    continueCursor: cursor,
    rows,
    rowsTruncated: options.includeRows && rows.length < unsafeCount,
  };
}

async function deleteIntegrationSecretsByUserProvider(
  db: MutationCtx["db"],
  userId: Id<"user">,
  provider: string,
): Promise<number> {
  let deleted = 0;

  while (true) {
    const secrets = (await db
      .query("integrationSecrets")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", provider),
      )
      .take(DELETE_BATCH_SIZE)) as Array<{ _id: Id<"integrationSecrets"> }>;

    if (secrets.length === 0) {
      break;
    }

    for (const secret of secrets) {
      await db.delete(secret._id);
      deleted += 1;
    }
  }

  return deleted;
}

async function deleteIntegrationSyncRunsByUserProvider(
  db: MutationCtx["db"],
  userId: Id<"user">,
  provider: string,
): Promise<number> {
  let deleted = 0;

  while (true) {
    const syncRuns = (await db
      .query("integrationSyncRuns")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", provider),
      )
      .take(DELETE_BATCH_SIZE)) as Array<{ _id: Id<"integrationSyncRuns"> }>;

    if (syncRuns.length === 0) {
      break;
    }

    for (const run of syncRuns) {
      await db.delete(run._id);
      deleted += 1;
    }
  }

  return deleted;
}

async function loadLegacyUnsupportedProviderRowsWindow(
  db: QueryCtx["db"] | MutationCtx["db"],
  provider: UnsupportedProvider,
  startOffset: number,
  maxRows: number,
): Promise<{ rows: IntegrationRecord[]; hasMoreRows: boolean }> {
  const fetchCount = startOffset + maxRows + 1;
  const providerRowsWindow = (await db
    .query("integrations")
    .withIndex("by_provider", (q) => q.eq("provider", provider))
    .take(fetchCount)) as IntegrationRecord[];

  if (providerRowsWindow.length <= startOffset) {
    return { rows: [], hasMoreRows: false };
  }

  const rows = providerRowsWindow.slice(startOffset, startOffset + maxRows);

  return {
    rows,
    hasMoreRows: providerRowsWindow.length > startOffset + maxRows,
  };
}

async function countLegacyUnsupportedIntegrations(
  db: QueryCtx["db"] | MutationCtx["db"],
  args: {
    batchSizePerProvider: number;
    maxPasses: number;
    cursorByProvider?: LegacyUnsupportedProviderCursorMap;
  },
): Promise<LegacyUnsupportedCountSummary> {
  const rowsByProvider = createUnsupportedProviderCountMap();
  const pagesScannedByProvider = createUnsupportedProviderCountMap();
  const nextCursorByProvider = createUnsupportedProviderCursorMap(
    args.cursorByProvider,
  );
  const affectedUsers = new Set<string>();
  const maxRowsPerProvider = args.batchSizePerProvider * args.maxPasses;

  let totalRows = 0;
  let pendingCleanupRows = 0;
  let softDeletedRows = 0;
  let isDone = true;

  for (const provider of UNSUPPORTED_PROVIDERS) {
    const startOffset = parseLegacyUnsupportedOffsetCursor(
      nextCursorByProvider[provider],
    );
    const { rows, hasMoreRows } = await loadLegacyUnsupportedProviderRowsWindow(
      db,
      provider,
      startOffset,
      maxRowsPerProvider,
    );
    const nextOffset = startOffset + rows.length;

    rowsByProvider[provider] += rows.length;
    totalRows += rows.length;

    for (const integration of rows) {
      affectedUsers.add(String(integration.userId));

      if (integration.legacyUnsupported === true) {
        softDeletedRows += 1;
      }

      if (needsLegacyUnsupportedSoftCleanup(integration)) {
        pendingCleanupRows += 1;
      }
    }

    pagesScannedByProvider[provider] =
      rows.length === 0
        ? 0
        : Math.ceil(rows.length / args.batchSizePerProvider);

    nextCursorByProvider[provider] = hasMoreRows
      ? formatLegacyUnsupportedOffsetCursor(nextOffset)
      : null;

    if (hasMoreRows) {
      isDone = false;
    }
  }

  return {
    totalRows,
    pendingCleanupRows,
    softDeletedRows,
    affectedUsers: affectedUsers.size,
    rowsByProvider,
    pagesScannedByProvider,
    nextCursorByProvider,
    isDone,
  };
}

async function runLegacyUnsupportedCleanup(
  ctx: MutationCtx,
  args: {
    trigger: "manual" | "cron";
    actorUserId?: Id<"user">;
    force: boolean;
    batchSizePerProvider: number;
    maxPasses: number;
    cursorByProvider?: LegacyUnsupportedProviderCursorMap;
  },
): Promise<LegacyUnsupportedCleanupCounts> {
  const rowsByProvider = createUnsupportedProviderCountMap();
  const failedRowsByProvider = createUnsupportedProviderCountMap();
  const pagesProcessedByProvider = createUnsupportedProviderCountMap();
  const nextCursorByProvider = createUnsupportedProviderCursorMap(
    args.cursorByProvider,
  );
  const affectedUsers = new Set<string>();
  const attemptId = `${args.trigger}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const maxRowsPerProvider = args.batchSizePerProvider * args.maxPasses;
  const now = Date.now();

  let scannedRows = 0;
  let matchedRows = 0;
  let softDeletedRows = 0;
  let hardDeletedRows = 0;
  let deletedSecretRows = 0;
  let deletedSyncRunRows = 0;
  let failedRows = 0;
  let isDone = true;

  logInfo("legacy_unsupported_integrations_cleanup.started", {
    status: "started",
    attemptId,
    trigger: args.trigger,
    force: args.force,
    batchSizePerProvider: args.batchSizePerProvider,
    maxPasses: args.maxPasses,
    hasCursorSlack: Boolean(args.cursorByProvider?.slack),
    hasCursorStrava: Boolean(args.cursorByProvider?.strava),
    hasCursorTodoist: Boolean(args.cursorByProvider?.todoist),
  });

  for (const provider of UNSUPPORTED_PROVIDERS) {
    const startOffset = parseLegacyUnsupportedOffsetCursor(
      nextCursorByProvider[provider],
    );
    const { rows: integrations, hasMoreRows } =
      await loadLegacyUnsupportedProviderRowsWindow(
        ctx.db,
        provider,
        startOffset,
        maxRowsPerProvider,
      );
    const nextOffset = startOffset + integrations.length;

    pagesProcessedByProvider[provider] =
      integrations.length === 0
        ? 0
        : Math.ceil(integrations.length / args.batchSizePerProvider);

    let providerHadFailure = false;

    for (const integration of integrations) {
      scannedRows += 1;

      const shouldProcess =
        args.force || needsLegacyUnsupportedSoftCleanup(integration);
      if (!shouldProcess) {
        continue;
      }

      try {
        matchedRows += 1;
        rowsByProvider[provider] += 1;
        affectedUsers.add(String(integration.userId));

        deletedSecretRows += await deleteIntegrationSecretsByUserProvider(
          ctx.db,
          integration.userId,
          provider,
        );

        deletedSyncRunRows += await deleteIntegrationSyncRunsByUserProvider(
          ctx.db,
          integration.userId,
          provider,
        );

        if (args.force) {
          await ctx.db.delete(integration._id);
          hardDeletedRows += 1;
          continue;
        }

        await ctx.db.patch(integration._id, {
          status: "disconnected",
          tokenRef: undefined,
          scopes: undefined,
          lastSyncAt: undefined,
          lastError: LEGACY_UNSUPPORTED_REASON,
          legacyUnsupported: true,
          legacyUnsupportedAt: integration.legacyUnsupportedAt ?? now,
          legacyUnsupportedReason: LEGACY_UNSUPPORTED_REASON,
        });
        softDeletedRows += 1;
      } catch (error) {
        failedRows += 1;
        failedRowsByProvider[provider] += 1;
        providerHadFailure = true;

        logWarn("legacy_unsupported_integrations_cleanup.row_failed", {
          status: "warning",
          attemptId,
          provider,
          integrationId: integration._id,
          userId: integration.userId,
          force: args.force,
          message: error instanceof Error ? error.message : "unknown_error",
        });

        captureException(
          "legacy_unsupported_integrations_cleanup.row_failed",
          error,
          {
            status: "failed",
            attemptId,
            provider,
            integrationId: integration._id,
            userId: integration.userId,
            force: args.force,
          },
        );
      }
    }

    const cursor = providerHadFailure
      ? formatLegacyUnsupportedOffsetCursor(startOffset)
      : hasMoreRows
        ? formatLegacyUnsupportedOffsetCursor(nextOffset)
        : null;

    logInfo("legacy_unsupported_integrations_cleanup.provider_page", {
      status: "info",
      attemptId,
      provider,
      pageSize: integrations.length,
      pagePass: pagesProcessedByProvider[provider],
      pageHadFailure: providerHadFailure,
      cursorAdvanced: !providerHadFailure,
      hasNextCursor: Boolean(cursor),
    });

    nextCursorByProvider[provider] = cursor;
    if (cursor !== null) {
      isDone = false;
    }
  }

  const summary = {
    trigger: args.trigger,
    force: args.force,
    attemptId,
    batchSizePerProvider: args.batchSizePerProvider,
    maxPasses: args.maxPasses,
    maxRowsPerProvider,
    isDone,
    scannedRows,
    matchedRows,
    softDeletedRows,
    hardDeletedRows,
    deletedSecretRows,
    deletedSyncRunRows,
    failedRows,
    affectedUsers: affectedUsers.size,
    rowsByProvider,
    failedRowsByProvider,
    pagesProcessedByProvider,
    nextCursorByProvider,
  };

  logInfo("legacy_unsupported_integrations_cleanup.completed", {
    status: "succeeded",
    ...summary,
    affectedUserIds: Array.from(affectedUsers).slice(0, 200),
  });

  if (args.actorUserId) {
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: LEGACY_UNSUPPORTED_CLEANUP_AUDIT_ACTION,
      target: `attempt=${attemptId};force=${args.force};matched=${matchedRows};failed=${failedRows};users=${affectedUsers.size}`,
      at: Date.now(),
    });

    await applyDashboardMetricsDelta(ctx.db, {
      totalAuditLogs: 1,
    });
  }

  return summary;
}

async function findExistingOpaqueTokenRef(
  db: MutationCtx["db"],
  integration: IntegrationRecord,
): Promise<string | undefined> {
  const existingSecrets = (await db
    .query("integrationSecrets")
    .withIndex("by_user_provider", (q) =>
      q.eq("userId", integration.userId).eq("provider", integration.provider),
    )
    .order("desc")
    .take(LEGACY_OPAQUE_TOKEN_REF_SCAN_LIMIT)) as IntegrationSecretRecord[];

  let selected: IntegrationSecretRecord | undefined;

  for (const secret of existingSecrets) {
    if (!isOpaqueTokenRef(secret.tokenRef)) continue;

    if (!selected) {
      selected = secret;
      continue;
    }

    const selectedTs = selected.updatedAt ?? selected.createdAt ?? 0;
    const candidateTs = secret.updatedAt ?? secret.createdAt ?? 0;

    if (candidateTs >= selectedTs) {
      selected = secret;
    }
  }

  return selected?.tokenRef;
}

async function migrateLegacyIntegrationTokenRef(
  ctx: MutationCtx,
  adminUserId: Id<"user">,
  integration: IntegrationRecord,
): Promise<"migrated" | "skipped"> {
  const legacyTokenRef = normalizeTokenRef(integration.tokenRef);
  if (!legacyTokenRef || isOpaqueTokenRef(legacyTokenRef)) {
    return "skipped";
  }

  const provider = asIntegrationProvider(integration.provider);
  if (!provider) {
    return "skipped";
  }

  const existingTokenRef = await findExistingOpaqueTokenRef(
    ctx.db,
    integration,
  );

  const nextTokenRef = await upsertIntegrationSecret(ctx.db as never, {
    userId: integration.userId,
    provider,
    accessToken: legacyTokenRef,
    existingTokenRef,
  });

  await ctx.db.patch(integration._id, {
    tokenRef: nextTokenRef,
  });

  await ctx.db.insert("auditLogs", {
    actorUserId: adminUserId,
    action: LEGACY_TOKEN_REF_MIGRATION_AUDIT_ACTION,
    target: String(integration._id),
    at: Date.now(),
  });

  await applyDashboardMetricsDelta(ctx.db, {
    totalAuditLogs: 1,
  });

  return "migrated";
}

async function upsertIntegrationDailyDataDoc(
  db: unknown,
  args: {
    userId: Id<"user">;
    provider: DailyDataProvider;
    dayKey: string;
    metrics?: IntegrationDailyMetrics;
    summary?: string;
    signals?: string[];
    context?: IntegrationDailyContext;
  },
) {
  const provider = assertDailyDataProvider(args.provider);

  const typedDb = db as any;

  const existing = await typedDb
    .query("integrationDailyData")
    .withIndex("by_user_provider_day", (q: any) =>
      q
        .eq("userId", args.userId)
        .eq("provider", provider)
        .eq("dayKey", args.dayKey),
    )
    .unique();

  const sanitizedSummary = sanitizeSummaryText(args.summary);
  const sanitizedSignals = sanitizeSignals(args.signals)
    .map(sanitizeSignalText)
    .slice(0, 12);
  const sanitizedContext = sanitizeContext(args.context);

  const encryptedPayload = await buildIntegrationDailySensitiveWritePayload({
    userId: args.userId,
    summary: sanitizedSummary,
    signals: sanitizedSignals.length > 0 ? sanitizedSignals : undefined,
    context: sanitizedContext,
    sensitiveDataNonce: existing?.sensitiveDataNonce,
  });

  const payload = {
    metrics: sanitizeMetrics(args.metrics),
    ...encryptedPayload,
    syncedAt: Date.now(),
  };

  if (existing) {
    await typedDb.patch(existing._id, payload);
    return await typedDb.get(existing._id);
  }

  const id = await typedDb.insert("integrationDailyData", {
    userId: args.userId,
    provider,
    dayKey: args.dayKey,
    ...payload,
  });

  return await typedDb.get(id);
}

type ConnectIntegrationArgs = {
  provider: string;
  scopes?: string[];
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
};

async function connectIntegrationForUser(
  ctx: MutationCtx,
  userId: Id<"user">,
  args: ConnectIntegrationArgs,
) {
  if (!(await getActiveUserById(ctx, userId))) {
    throw new Error("Cannot connect an integration while account deletion is active.");
  }

  const provider = assertIntegrationProvider(args.provider);
  const plugin = getRequiredIntegrationPlugin(provider);

  logInfo("integration_connect.started", {
    status: "started",
    userId,
    provider,
    scopesCount: args.scopes?.length ?? 0,
    hasAccessToken: Boolean(args.accessToken),
    hasRefreshToken: Boolean(args.refreshToken),
  });

  if (plugin.connectionMode === "oauth" && !args.accessToken) {
    throw new Error(
      `Provider "${provider}" requires an OAuth access token. Start the OAuth flow before connecting.`,
    );
  }

  const existing = await ctx.db
    .query("integrations")
    .withIndex("by_user_provider", (q) =>
      q.eq("userId", userId).eq("provider", provider),
    )
    .unique();

  if (
    existing?.remoteRevocationStatus === "pending" &&
    args.accessToken
  ) {
    throw new Error(
      "Wait for provider disconnection to finish before reconnecting.",
    );
  }

  // Reuse the existing opaque token reference on reconnect so we mutate the
  // already-linked `integrationSecrets` row in place instead of orphaning it.
  const existingOpaqueTokenRef =
    existing?.tokenRef && isOpaqueTokenRef(existing.tokenRef)
      ? existing.tokenRef
      : undefined;

  const nextTokenRef = args.accessToken
    ? await upsertIntegrationSecret(ctx.db as never, {
        userId,
        provider,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        accessTokenExpiresAt: args.accessTokenExpiresAt,
        existingTokenRef: existingOpaqueTokenRef,
      })
    : undefined;

  if (existing) {
    await ctx.db.patch(existing._id, {
      status: "connected" as const,
      lastError: undefined,
      scopes: args.scopes,
      tokenRef: nextTokenRef ?? existing.tokenRef,
      lastSyncAt: Date.now(),
      remoteRevocationStatus: undefined,
      remoteRevocationAttempts: undefined,
      remoteRevocationNextAttemptAt: undefined,
      remoteRevocationErrorCode: undefined,
    });

    logInfo("integration_connect.succeeded", {
      status: "succeeded",
      userId,
      provider,
      integrationId: existing._id,
      mode: "reconnect",
      tokenRefPersisted: Boolean(nextTokenRef ?? existing.tokenRef),
    });

    return await ctx.db.get(existing._id);
  }

  const id = await ctx.db.insert("integrations", {
    userId,
    provider,
    status: "connected",
    lastError: undefined,
    scopes: args.scopes,
    tokenRef: nextTokenRef,
    lastSyncAt: Date.now(),
  });

  await applyDashboardMetricsDelta(ctx.db, {
    totalIntegrations: 1,
  });

  logInfo("integration_connect.succeeded", {
    status: "succeeded",
    userId,
    provider,
    integrationId: id,
    mode: "create",
    tokenRefPersisted: Boolean(nextTokenRef),
  });

  return await ctx.db.get(id);
}

// ── Connect a new integration ───────────────────────────────
// Public mutation intentionally excludes secret-bearing OAuth tokens.
export const connectIntegration = mutation({
  args: {
    provider: v.string(),
    scopes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await connectIntegrationForUser(ctx, user._id, args);
  },
});

export const connectIntegrationWithOAuthTokensInternal = internalMutation({
  args: {
    userId: v.id("user"),
    provider: v.string(),
    scopes: v.optional(v.array(v.string())),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await connectIntegrationForUser(ctx, args.userId, args);
  },
});

// ── Mobile → web OAuth handoff ─────────────────────────────
// The mobile app opens `WebBrowser.openAuthSessionAsync(...)` which uses an
// isolated cookie jar. The web OAuth callback therefore cannot reliably
// identify the mobile user via `auth()` — whatever Clerk session happens to
// be in the in-app browser's cookies would be used, which in practice is
// often a different (or no) account. The resulting integration is persisted
// on the wrong `user` row and never appears on the mobile device.
//
// To fix this, the mobile app requests a short-lived opaque handoff code
// *before* opening the browser (using the mobile's Clerk session). The web
// OAuth callback forwards this code to the Convex HTTP action, which trades
// it for the correct mobile `userId`. The code is single-use and
// provider-scoped to prevent replay/confusion.
const OAUTH_MOBILE_HANDOFF_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OAUTH_MOBILE_HANDOFF_CODE_BYTES = 32; // 256-bit entropy

function generateOAuthMobileHandoffCode(): string {
  // Convex provides a globally-available `crypto` object (Web Crypto API).
  const bytes = new Uint8Array(OAUTH_MOBILE_HANDOFF_CODE_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export const beginOAuthMobileHandoff = mutation({
  args: { provider: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const provider = assertIntegrationProvider(args.provider);
    const plugin = getRequiredIntegrationPlugin(provider);

    if (plugin.connectionMode !== "oauth") {
      throw new Error(
        `Provider "${provider}" does not use OAuth; handoff is not required.`,
      );
    }

    const now = Date.now();
    const code = generateOAuthMobileHandoffCode();
    await ctx.db.insert("oauthMobileHandoffs", {
      code,
      userId: user._id,
      provider,
      createdAt: now,
      expiresAt: now + OAUTH_MOBILE_HANDOFF_TTL_MS,
    });

    logInfo("oauth_mobile_handoff.issued", {
      area: "oauth_mobile_handoff",
      userId: user._id,
      provider,
      codePrefix: code.slice(0, 8),
      expiresAt: now + OAUTH_MOBILE_HANDOFF_TTL_MS,
    });

    return { handoffCode: code };
  },
});

export const consumeOAuthMobileHandoffInternal = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const normalized = args.code.trim();
    if (!normalized) return null;

    const row = await ctx.db
      .query("oauthMobileHandoffs")
      .withIndex("by_code", (q) => q.eq("code", normalized))
      .unique();
    if (!row) {
      logWarn("oauth_mobile_handoff.consume_missing", {
        area: "oauth_mobile_handoff",
        codePrefix: normalized.slice(0, 8),
      });
      return null;
    }

    const now = Date.now();
    if (row.consumedAt !== undefined) {
      logWarn("oauth_mobile_handoff.consume_already_used", {
        area: "oauth_mobile_handoff",
        userId: row.userId,
        provider: row.provider,
        codePrefix: normalized.slice(0, 8),
      });
      return null;
    }
    if (row.expiresAt < now) {
      logWarn("oauth_mobile_handoff.consume_expired", {
        area: "oauth_mobile_handoff",
        userId: row.userId,
        provider: row.provider,
        codePrefix: normalized.slice(0, 8),
      });
      return null;
    }

    if (!(await getActiveUserById(ctx, row.userId))) {
      logWarn("oauth_mobile_handoff.consume_account_deleting", {
        area: "oauth_mobile_handoff",
        userId: row.userId,
        provider: row.provider,
        codePrefix: normalized.slice(0, 8),
      });
      return null;
    }

    await ctx.db.patch(row._id, { consumedAt: now });

    logInfo("oauth_mobile_handoff.consumed", {
      area: "oauth_mobile_handoff",
      userId: row.userId,
      provider: row.provider,
      codePrefix: normalized.slice(0, 8),
    });

    return { userId: row.userId, provider: row.provider };
  },
});

// Periodic purge of consumed/expired handoff rows (invoked by crons).
export const purgeExpiredOAuthMobileHandoffsInternal = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.max(1, Math.min(1000, args.limit ?? 500));
    const expired = await ctx.db
      .query("oauthMobileHandoffs")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(limit);

    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    return { deleted: expired.length };
  },
});

async function scheduleIntegrationRevocation(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  integration: IntegrationRecord,
): Promise<void> {
  const provider = assertIntegrationProvider(integration.provider);
  const plugin = getRequiredIntegrationPlugin(provider);
  const now = Date.now();

  if (plugin.connectionMode !== "oauth") {
    if (integration.tokenRef) {
      await deleteIntegrationSecretByRef(ctx.db as never, integration.tokenRef);
    }
    await ctx.db.patch(integration._id, {
      status: "disconnected",
      tokenRef: undefined,
      remoteRevocationStatus: undefined,
      remoteRevocationAttempts: undefined,
      remoteRevocationNextAttemptAt: undefined,
      remoteRevocationErrorCode: undefined,
      lastError: undefined,
    });
    return;
  }

  const recentJobs = await ctx.db
    .query("integrationRevocationJobs")
    .withIndex("by_integration_createdAt", (q) =>
      q.eq("integrationId", integration._id),
    )
    .order("desc")
    .take(10);
  const activeJob = recentJobs.find(
    (job) => job.status === "pending" || job.status === "processing",
  );
  if (activeJob) {
    await ctx.db.patch(integration._id, {
      status: "disconnected",
      tokenRef: undefined,
      remoteRevocationStatus: "pending",
      remoteRevocationAttempts: activeJob.attempts,
      remoteRevocationNextAttemptAt:
        activeJob.nextAttemptAt ?? activeJob.updatedAt,
      remoteRevocationErrorCode: activeJob.lastErrorCode,
    });
    return;
  }

  const tokenRef = integration.tokenRef;
  if (provider === "spotify") {
    if (tokenRef) {
      await deleteIntegrationSecretByRef(ctx.db as never, tokenRef);
    }
    await ctx.db.insert("integrationRevocationJobs", {
      userId: integration.userId,
      integrationId: integration._id,
      provider,
      status: "unsupported",
      attempts: 0,
      lastErrorCode: "provider_revocation_not_available",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(integration._id, {
      status: "disconnected",
      tokenRef: undefined,
      remoteRevocationStatus: "unsupported",
      remoteRevocationAttempts: 0,
      remoteRevocationNextAttemptAt: undefined,
      remoteRevocationErrorCode: "provider_revocation_not_available",
      lastError: undefined,
    });
    return;
  }

  if (!tokenRef) {
    await ctx.db.patch(integration._id, {
      status: "disconnected",
      remoteRevocationStatus: "failed",
      remoteRevocationAttempts: 0,
      remoteRevocationNextAttemptAt: undefined,
      remoteRevocationErrorCode: "credential_missing",
      lastError: undefined,
    });
    return;
  }

  const jobId = await ctx.db.insert("integrationRevocationJobs", {
    userId: integration.userId,
    integrationId: integration._id,
    provider,
    tokenRef,
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.patch(integration._id, {
    status: "disconnected",
    tokenRef: undefined,
    remoteRevocationStatus: "pending",
    remoteRevocationAttempts: 0,
    remoteRevocationNextAttemptAt: now,
    remoteRevocationErrorCode: undefined,
    lastError: undefined,
  });

  try {
    await ctx.scheduler.runAfter(0, INTEGRATION_REVOCATION_ACTION_REF, {
      jobId,
    });
  } catch (error) {
    logWarn("integration_revocation.schedule_failed", {
      status: "degraded",
      integrationId: integration._id,
      provider,
      errorType: error instanceof Error ? error.name : "unknown",
    });
  }
}

export async function enqueueUserIntegrationRevocations(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  userId: Id<"user">,
): Promise<void> {
  const integrations = await ctx.db
    .query("integrations")
    .withIndex("by_user_provider", (q) => q.eq("userId", userId))
    .collect();

  for (const integration of integrations) {
    if (
      integration.status === "connected" &&
      !integration.legacyUnsupported &&
      !isUnsupportedProvider(integration.provider)
    ) {
      await scheduleIntegrationRevocation(ctx, integration);
    }
  }
}

// ── Disconnect an integration ───────────────────────────────
export const disconnectIntegration = mutation({
  args: {
    integrationId: v.id("integrations"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const integration = await ctx.db.get(args.integrationId);

    if (!integration) {
      throw new Error("Integration not found");
    }

    requireOwnership(user, integration.userId);
    await scheduleIntegrationRevocation(ctx, integration);

    return await ctx.db.get(args.integrationId);
  },
});

export const getIntegrationAccessTokenByRefInternal = internalQuery({
  args: {
    tokenRef: v.string(),
    userId: v.id("user"),
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    const provider = assertIntegrationProvider(args.provider);
    const activeKeyId = getActiveIntegrationSecretKeyId();

    const secret = (await ctx.db
      .query("integrationSecrets")
      .withIndex("by_tokenRef", (q) => q.eq("tokenRef", args.tokenRef))
      .unique()) as
      | (IntegrationSecretRecord & {
          accessToken?: unknown;
          refreshToken?: unknown;
        })
      | null;

    if (!secret) return null;
    if (
      !constantTimeStringEquals(String(secret.userId), String(args.userId)) ||
      !constantTimeStringEquals(secret.provider, provider)
    ) {
      return null;
    }

    const cryptoContext = {
      userId: String(args.userId),
      provider,
      tokenRef: args.tokenRef,
    };

    assertEncryptedOnlySecretRecord(secret, {
      provider,
      userId: args.userId,
    });

    if (!secret.encryptedAccessToken) {
      throw new Error(
        "Integration secret payload is invalid or missing encrypted access token material.",
      );
    }

    const accessToken = await decryptIntegrationSecret(
      secret.encryptedAccessToken,
      cryptoContext,
    );

    let refreshToken: string | undefined;
    let needsKeyRotation = false;

    if (
      !constantTimeStringEquals(secret.encryptedAccessToken.keyId, activeKeyId)
    ) {
      needsKeyRotation = true;
    }

    if (secret.encryptedRefreshToken) {
      refreshToken = await decryptIntegrationSecret(
        secret.encryptedRefreshToken,
        cryptoContext,
      );

      if (
        !constantTimeStringEquals(
          secret.encryptedRefreshToken.keyId,
          activeKeyId,
        )
      ) {
        needsKeyRotation = true;
      }
    }

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: secret.accessTokenExpiresAt,
      needsKeyRotation,
    };
  },
});

export const getIntegrationRevocationJobInternal = internalQuery({
  args: { jobId: v.id("integrationRevocationJobs") },
  handler: async (ctx, args) => await ctx.db.get(args.jobId),
});

export const beginIntegrationRevocationAttemptInternal = internalMutation({
  args: { jobId: v.id("integrationRevocationJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.status !== "pending" ||
      (job.nextAttemptAt !== undefined && job.nextAttemptAt > Date.now()) ||
      !job.tokenRef
    ) {
      return null;
    }

    const attempts = job.attempts + 1;
    await ctx.db.patch(job._id, {
      status: "processing",
      attempts,
      updatedAt: Date.now(),
    });

    return {
      userId: job.userId,
      provider: job.provider,
      tokenRef: job.tokenRef,
      attempts,
    };
  },
});

async function finalizeIntegrationRevocation(
  ctx: MutationCtx,
  jobId: Id<"integrationRevocationJobs">,
  status: "revoked" | "failed",
  errorCode?: string,
): Promise<void> {
  const job = await ctx.db.get(jobId);
  if (!job) return;

  if (job.tokenRef) {
    await deleteIntegrationSecretByRef(ctx.db as never, job.tokenRef);
  }

  const now = Date.now();
  await ctx.db.patch(job._id, {
    status,
    tokenRef: undefined,
    nextAttemptAt: undefined,
    lastErrorCode: errorCode,
    updatedAt: now,
  });

  if (job.integrationId) {
    const integration = await ctx.db.get(job.integrationId);
    if (integration?.status === "disconnected" && !integration.tokenRef) {
      await ctx.db.patch(integration._id, {
        remoteRevocationStatus: status,
        remoteRevocationAttempts: job.attempts,
        remoteRevocationNextAttemptAt: undefined,
        remoteRevocationErrorCode: errorCode,
      });
    }
  }
}

export const finishIntegrationRevocationInternal = internalMutation({
  args: {
    jobId: v.id("integrationRevocationJobs"),
    status: v.union(v.literal("revoked"), v.literal("failed")),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await finalizeIntegrationRevocation(
      ctx,
      args.jobId,
      args.status,
      args.errorCode,
    );
    return { success: true };
  },
});

export const retryIntegrationRevocationInternal = internalMutation({
  args: {
    jobId: v.id("integrationRevocationJobs"),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "processing") {
      return { scheduled: false, terminal: true };
    }

    if (job.attempts >= INTEGRATION_REVOCATION_MAX_ATTEMPTS) {
      await finalizeIntegrationRevocation(
        ctx,
        job._id,
        "failed",
        "provider_unavailable_after_retries",
      );
      return { scheduled: false, terminal: true };
    }

    const delayMs = Math.min(
      12 * 60 * 60 * 1000,
      60_000 * 2 ** Math.max(job.attempts - 1, 0),
    );
    const nextAttemptAt = Date.now() + delayMs;
    await ctx.db.patch(job._id, {
      status: "pending",
      nextAttemptAt,
      lastErrorCode: args.errorCode,
      updatedAt: Date.now(),
    });

    try {
      await ctx.scheduler.runAfter(
        delayMs,
        INTEGRATION_REVOCATION_ACTION_REF,
        { jobId: job._id },
      );
    } catch (error) {
      logWarn("integration_revocation.retry_schedule_failed", {
        status: "degraded",
        jobId: job._id,
        provider: job.provider,
        errorType: error instanceof Error ? error.name : "unknown",
      });
    }

    return { scheduled: true, terminal: false, nextAttemptAt };
  },
});

export const processIntegrationRevocationInternal = internalAction({
  args: { jobId: v.id("integrationRevocationJobs") },
  handler: async (ctx, args) => {
    const job = (await ctx.runQuery(INTEGRATION_REVOCATION_JOB_QUERY_REF, {
      jobId: args.jobId,
    })) as {
      _id: Id<"integrationRevocationJobs">;
      status: string;
      provider: string;
      attempts: number;
    } | null;
    if (!job || job.status !== "pending") {
      return { processed: false };
    }

    const attempt = (await ctx.runMutation(
      INTEGRATION_REVOCATION_BEGIN_REF,
      { jobId: args.jobId },
    )) as {
      userId: Id<"user">;
      provider: string;
      tokenRef: string;
      attempts: number;
    } | null;
    if (!attempt) return { processed: false };

    let tokens: {
      accessToken: string;
      refreshToken?: string;
    } | null;
    try {
      tokens = (await ctx.runQuery(INTEGRATION_REVOCATION_SECRET_QUERY_REF, {
        tokenRef: attempt.tokenRef,
        userId: attempt.userId,
        provider: attempt.provider,
      })) as { accessToken: string; refreshToken?: string } | null;
    } catch {
      await ctx.runMutation(INTEGRATION_REVOCATION_FINISH_REF, {
        jobId: args.jobId,
        status: "failed",
        errorCode: "credential_unavailable",
      });
      return { processed: true, status: "failed" };
    }

    if (!tokens) {
      await ctx.runMutation(INTEGRATION_REVOCATION_FINISH_REF, {
        jobId: args.jobId,
        status: "failed",
        errorCode: "credential_missing",
      });
      return { processed: true, status: "failed" };
    }

    if (attempt.provider !== "google_calendar" &&
        attempt.provider !== "google_fit" &&
        attempt.provider !== "gmail_summary") {
      await ctx.runMutation(INTEGRATION_REVOCATION_FINISH_REF, {
        jobId: args.jobId,
        status: "failed",
        errorCode: "provider_revocation_not_available",
      });
      return { processed: true, status: "failed" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token: tokens.refreshToken ?? tokens.accessToken,
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        await ctx.runMutation(INTEGRATION_REVOCATION_FINISH_REF, {
          jobId: args.jobId,
          status: "revoked",
        });
        return { processed: true, status: "revoked" };
      }

      if (response.status === 429 || response.status >= 500) {
        const retry = await ctx.runMutation(INTEGRATION_REVOCATION_RETRY_REF, {
          jobId: args.jobId,
          errorCode: `provider_http_${response.status}`,
        });
        return {
          processed: true,
          status: retry.terminal ? "failed" : "pending",
        };
      }

      await ctx.runMutation(INTEGRATION_REVOCATION_FINISH_REF, {
        jobId: args.jobId,
        status: "failed",
        errorCode: "provider_rejected_revocation",
      });
      return { processed: true, status: "failed" };
    } catch {
      const retry = await ctx.runMutation(INTEGRATION_REVOCATION_RETRY_REF, {
        jobId: args.jobId,
        errorCode: "provider_network_error",
      });
      return {
        processed: true,
        status: retry.terminal ? "failed" : "pending",
      };
    } finally {
      clearTimeout(timeout);
    }
  },
});

export const scheduleDueIntegrationRevocationsInternal = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.max(1, Math.min(500, args.limit ?? 100));
    const dueJobs = await ctx.db
      .query("integrationRevocationJobs")
      .withIndex("by_status_nextAttemptAt", (q) =>
        q.eq("status", "pending").lte("nextAttemptAt", now),
      )
      .take(limit);
    const staleJobs = await ctx.db
      .query("integrationRevocationJobs")
      .withIndex("by_status_updatedAt", (q) =>
        q
          .eq("status", "processing")
          .lt("updatedAt", now - INTEGRATION_REVOCATION_STALE_ATTEMPT_MS),
      )
      .take(limit);

    for (const job of staleJobs) {
      await ctx.db.patch(job._id, {
        status: "pending",
        nextAttemptAt: now,
        updatedAt: now,
        lastErrorCode: "attempt_interrupted",
      });
    }

    const jobsToSchedule = [...dueJobs, ...staleJobs];
    for (const job of jobsToSchedule) {
      try {
        await ctx.scheduler.runAfter(0, INTEGRATION_REVOCATION_ACTION_REF, {
          jobId: job._id,
        });
      } catch (error) {
        logWarn("integration_revocation.schedule_failed", {
          status: "degraded",
          jobId: job._id,
          provider: job.provider,
          errorType: error instanceof Error ? error.name : "unknown",
        });
      }
    }

    let cleanedJobs = 0;
    const terminalCutoff = now - INTEGRATION_REVOCATION_JOB_RETENTION_MS;
    for (const status of ["revoked", "unsupported", "failed"] as const) {
      const terminalJobs = await ctx.db
        .query("integrationRevocationJobs")
        .withIndex("by_status_updatedAt", (q) =>
          q.eq("status", status).lt("updatedAt", terminalCutoff),
        )
        .take(limit);
      for (const job of terminalJobs) {
        await ctx.db.delete(job._id);
        cleanedJobs += 1;
      }
    }

    return { scheduled: jobsToSchedule.length, cleanedJobs };
  },
});

export const storeIntegrationSecretInternal = internalMutation({
  args: {
    userId: v.id("user"),
    provider: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    lastRefreshAt: v.optional(v.number()),
    existingTokenRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!(await getActiveUserById(ctx, args.userId))) {
      throw new Error("Cannot store integration secrets for an inactive user");
    }

    const provider = assertIntegrationProvider(args.provider);

    return await upsertIntegrationSecret(ctx.db as never, {
      userId: args.userId,
      provider,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      lastRefreshAt: args.lastRefreshAt,
      existingTokenRef: args.existingTokenRef,
    });
  },
});

export const updateIntegrationTokenRefInternal = internalMutation({
  args: {
    integrationId: v.id("integrations"),
    tokenRef: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenRef = assertOpaqueTokenRef(
      args.tokenRef,
      "updateIntegrationTokenRefInternal.tokenRef",
    );

    const integration = await ctx.db.get(args.integrationId);
    if (
      !integration ||
      !(await getActiveUserById(ctx, integration.userId))
    ) {
      throw new Error("Cannot update token reference for an inactive user");
    }

    await ctx.db.patch(integration._id, { tokenRef });
    return { success: true };
  },
});

export const beginIntegrationSyncRunInternal = internalMutation({
  args: {
    userId: v.id("user"),
    provider: v.string(),
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    if (!(await getActiveUserById(ctx, args.userId))) {
      throw new Error("Cannot start an integration sync for an inactive user");
    }

    const provider = assertIntegrationProvider(args.provider);
    const now = Date.now();

    const existingRun = await ctx.db
      .query("integrationSyncRuns")
      .withIndex("by_user_provider_day", (q) =>
        q
          .eq("userId", args.userId)
          .eq("provider", provider)
          .eq("dayKey", args.dayKey),
      )
      .unique();

    const existingDailyData = await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_provider_day", (q) =>
        q
          .eq("userId", args.userId)
          .eq("provider", provider)
          .eq("dayKey", args.dayKey),
      )
      .unique();

    if (
      existingRun?.status === "in_progress" &&
      now - existingRun.updatedAt < SYNC_RUN_IN_PROGRESS_TTL_MS
    ) {
      return { shouldSync: false, reason: "already_running" as const };
    }

    if (existingRun?.status === "success" && existingDailyData) {
      return { shouldSync: false, reason: "already_synced" as const };
    }

    if (existingRun) {
      await ctx.db.patch(existingRun._id, {
        status: "in_progress",
        updatedAt: now,
        startedAt: now,
        lastError: undefined,
      });
    } else {
      await ctx.db.insert("integrationSyncRuns", {
        userId: args.userId,
        provider,
        dayKey: args.dayKey,
        status: "in_progress",
        startedAt: now,
        updatedAt: now,
        lastError: undefined,
      });
    }

    return { shouldSync: true, reason: "ready" as const };
  },
});

export const completeIntegrationSyncRunInternal = internalMutation({
  args: {
    userId: v.id("user"),
    provider: v.string(),
    dayKey: v.string(),
    status: v.union(v.literal("success"), v.literal("error")),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!(await getActiveUserById(ctx, args.userId))) {
      throw new Error(
        "Cannot complete an integration sync for an inactive user",
      );
    }

    const provider = assertIntegrationProvider(args.provider);

    const existingRun = await ctx.db
      .query("integrationSyncRuns")
      .withIndex("by_user_provider_day", (q) =>
        q
          .eq("userId", args.userId)
          .eq("provider", provider)
          .eq("dayKey", args.dayKey),
      )
      .unique();

    const payload = {
      status: args.status,
      updatedAt: Date.now(),
      lastError: args.status === "error" ? args.lastError : undefined,
    };

    if (existingRun) {
      await ctx.db.patch(existingRun._id, payload);
      return { success: true };
    }

    await ctx.db.insert("integrationSyncRuns", {
      userId: args.userId,
      provider,
      dayKey: args.dayKey,
      status: args.status,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      lastError: args.status === "error" ? args.lastError : undefined,
    });

    return { success: true };
  },
});

// ── Mark an integration as errored ──────────────────────────
export const markIntegrationError = mutation({
  args: {
    integrationId: v.id("integrations"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const integration = await ctx.db.get(args.integrationId);

    if (!integration) {
      throw new Error("Integration not found");
    }

    requireOwnership(user, integration.userId);

    await ctx.db.patch(args.integrationId, {
      status: "error" as const,
      lastError: args.reason,
    });

    return await ctx.db.get(args.integrationId);
  },
});

// ── Record a successful sync timestamp ──────────────────────
export const recordSync = mutation({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const integration = await ctx.db.get(args.integrationId);

    if (!integration) {
      throw new Error("Integration not found");
    }

    requireOwnership(user, integration.userId);

    await ctx.db.patch(args.integrationId, {
      status: "connected" as const,
      lastError: undefined,
      lastSyncAt: Date.now(),
    });

    return await ctx.db.get(args.integrationId);
  },
});

// ── Get a specific integration by provider ──────────────────
export const getIntegrationByProvider = query({
  args: { provider: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const provider = assertIntegrationProvider(args.provider);

    return await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", provider),
      )
      .unique();
  },
});

// ── List all integrations for the current user ──────────────
export async function listMyIntegrationsImpl(
  ctx: QueryCtx,
  args?: { limit?: number },
) {
  const user = await requireUser(ctx);
  const limit = clampListMyIntegrationsLimit(args?.limit);

  const integrations = await ctx.db
    .query("integrations")
    .withIndex("by_user_provider", (q) => q.eq("userId", user._id))
    .take(limit);

  return integrations.filter(
    (integration) =>
      !isUnsupportedProvider(integration.provider) &&
      integration.legacyUnsupported !== true,
  );
}

export const listMyIntegrations = query({
  args: { limit: v.optional(v.number()) },
  handler: (ctx, args) => listMyIntegrationsImpl(ctx, { limit: args.limit }),
});

export const listMyIntegrationSyncRunsForDay = query({
  args: {
    dayKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);
    const limit = clampListMySyncRunsForDayLimit(args.limit);

    return await ctx.db
      .query("integrationSyncRuns")
      .withIndex("by_user_day_updatedAt", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .order("desc")
      .take(limit);
  },
});

export const listMyIntegrationStatusSnapshots = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const limit = clampListMyIntegrationsLimit(args.limit);

    const integrations = (
      await ctx.db
        .query("integrations")
        .withIndex("by_user_provider", (q) => q.eq("userId", user._id))
        .take(limit)
    ).filter(
      (integration) =>
        !isUnsupportedProvider(integration.provider) &&
        integration.legacyUnsupported !== true,
    );

    return await Promise.all(
      integrations.map(async (integration) => {
        const runs = await ctx.db
          .query("integrationSyncRuns")
          .withIndex("by_user_provider", (q) =>
            q.eq("userId", user._id).eq("provider", integration.provider),
          )
          .order("desc")
          .take(10);

        const latestRun = runs[0];
        const recentFailures = runs
          .filter((run) => run.status === "error")
          .slice(0, 3)
          .map((run) => ({
            dayKey: run.dayKey,
            updatedAt: run.updatedAt,
            lastError: run.lastError,
          }));

        let consecutiveFailures = 0;
        for (const run of runs) {
          if (run.status !== "error") {
            break;
          }

          consecutiveFailures += 1;
        }

        const lastSuccessfulRun = runs.find((run) => run.status === "success");

        return {
          provider: integration.provider,
          integrationStatus: integration.status,
          integrationLastSyncAt: integration.lastSyncAt,
          integrationLastError: integration.lastError,
          latestRunStatus: latestRun?.status,
          latestRunUpdatedAt: latestRun?.updatedAt,
          lastSuccessfulRunAt: lastSuccessfulRun?.updatedAt,
          consecutiveFailures,
          recentFailures,
        };
      }),
    );
  },
});

// ── Delete an integration entirely ──────────────────────────
export const deleteIntegration = mutation({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const startedAt = Date.now();

    logInfo("deletion.integration.started", {
      status: "started",
      userId: user._id,
      integrationId: args.integrationId,
    });

    try {
      const integration = await ctx.db.get(args.integrationId);

      if (!integration) {
        throw new Error("Integration not found");
      }

      requireOwnership(user, integration.userId);

      let deletedDailyRows = 0;
      while (true) {
        const linkedDailyRows = await ctx.db
          .query("integrationDailyData")
          .withIndex("by_user_provider", (q) =>
            q
              .eq("userId", integration.userId)
              .eq("provider", integration.provider),
          )
          .take(DELETE_BATCH_SIZE);

        if (linkedDailyRows.length === 0) break;

        for (const row of linkedDailyRows) {
          await ctx.db.delete(row._id);
          deletedDailyRows += 1;
        }
      }

      await deleteIntegrationSecretByRef(ctx.db as never, integration.tokenRef);

      let deletedSyncRuns = 0;
      while (true) {
        const syncRuns = await ctx.db
          .query("integrationSyncRuns")
          .withIndex("by_user_provider", (q) =>
            q
              .eq("userId", integration.userId)
              .eq("provider", integration.provider),
          )
          .take(DELETE_BATCH_SIZE);

        if (syncRuns.length === 0) break;

        for (const run of syncRuns) {
          await ctx.db.delete(run._id);
          deletedSyncRuns += 1;
        }
      }

      await ctx.db.delete(args.integrationId);

      await applyDashboardMetricsDelta(ctx.db, {
        totalIntegrations: -1,
      });

      logInfo("deletion.integration.succeeded", {
        status: "succeeded",
        userId: user._id,
        integrationId: args.integrationId,
        provider: integration.provider,
        deletedDailyRows,
        deletedSyncRuns,
        durationMs: Date.now() - startedAt,
      });

      return { success: true };
    } catch (error) {
      captureException("deletion.integration.failed", error, {
        status: "failed",
        userId: user._id,
        integrationId: args.integrationId,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  },
});

export const listSupportedProviders = query({
  args: {},
  handler: async () => {
    return [...integrationProviderList];
  },
});

export const getMyLocationTrackingRuntimeConfig = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    const backgroundTrackingFlag = await evaluateFeatureFlagForIdentity(
      ctx.db,
      "backgroundTrackingEnabled",
      {
        userId: user._id,
        clerkUserId: user.clerkUserId,
      },
    );

    return {
      enableBackgroundLocationTracking:
        getEnableBackgroundLocationTracking() && backgroundTrackingFlag.enabled,
      batchMaxPoints: getBackgroundLocationBatchMaxPoints(),
      maxUpdatesPerHour: getBackgroundLocationMaxUpdatesPerHour(),
      batchFlushIntervalMinutes:
        getBackgroundLocationBatchFlushIntervalMinutes(),
      maxBatteryDrainPercentPerHour:
        getBackgroundLocationMaxBatteryDrainPercentPerHour(),
    };
  },
});

export const listMyIntegrationDailyDataForDay = query({
  args: {
    dayKey: v.string(),
    limit: v.optional(v.number()),
    refreshToken: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);
    const limit = clampListMyDailyDataForDayLimit(args.limit);

    const rows = await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .order("desc")
      .take(limit);

    return await Promise.all(
      rows.map(async (row) => await withIntegrationDailySensitiveFields(row)),
    );
  },
});

export const listMyIntegrationDailyDataForDayForSummaryGeneration = query({
  args: {
    dayKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);
    const limit = clampSummaryGenerationIntegrationLimit(args.limit);

    const paginated = await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .order("desc")
      .paginate({
        numItems: limit,
        cursor: null,
      });

    const sortedRows = paginated.page
      .slice()
      .sort(
        (left, right) =>
          right.syncedAt - left.syncedAt ||
          right._creationTime - left._creationTime ||
          left.provider.localeCompare(right.provider),
      );

    return await Promise.all(
      sortedRows.map(
        async (row) => await withIntegrationDailySensitiveFields(row),
      ),
    );
  },
});

export const getMyIntegrationContextAggregateForDay = query({
  args: {
    dayKey: v.string(),
    dailyDataLimit: v.optional(v.number()),
    syncRunLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);
    const dailyDataLimit = clampListMyDailyDataForDayLimit(args.dailyDataLimit);
    const syncRunLimit = clampContextAggregateSyncRunsLimit(args.syncRunLimit);

    const rawRows = await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .order("desc")
      .take(dailyDataLimit);

    const rows = (await Promise.all(
      rawRows.map(async (row) => {
        const hydrated = await withIntegrationDailySensitiveFields(row);

        return {
          provider: hydrated.provider,
          metrics: hydrated.metrics,
          summary: hydrated.summary,
          signals: hydrated.signals,
          context: hydrated.context,
          syncedAt: hydrated.syncedAt,
        } satisfies IntegrationContextAggregateRow;
      }),
    )) as IntegrationContextAggregateRow[];

    const syncRuns = (await ctx.db
      .query("integrationSyncRuns")
      .withIndex("by_user_day_updatedAt", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .order("desc")
      .take(syncRunLimit)) as IntegrationContextAggregateSyncRun[];

    return buildIntegrationContextAggregate({
      dayKey: args.dayKey,
      rows,
      syncRuns,
    });
  },
});

export const upsertMyIntegrationDailyData = mutation({
  args: {
    provider: v.string(),
    dayKey: v.string(),
    metrics: v.optional(integrationDailyMetricsValidator),
    summary: v.optional(v.string()),
    signals: v.optional(v.array(v.string())),
    context: v.optional(integrationDailyContextValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);
    const provider = assertDailyDataProvider(args.provider);

    return await upsertIntegrationDailyDataDoc(ctx.db, {
      userId: user._id,
      provider,
      dayKey: args.dayKey,
      metrics: args.metrics,
      summary: args.summary,
      signals: args.signals,
      context: args.context,
    });
  },
});

export const upsertMyContextualDailyData = mutation({
  args: {
    type: contextualDailyDataTypeValidator,
    dayKey: v.string(),
    summary: v.optional(v.string()),
    signals: v.optional(v.array(v.string())),
    metrics: v.optional(integrationDailyMetricsValidator),
    context: integrationDailyContextValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);

    return await upsertIntegrationDailyDataDoc(ctx.db, {
      userId: user._id,
      provider: assertDailyDataProvider(args.type),
      dayKey: args.dayKey,
      summary: args.summary,
      signals: args.signals,
      metrics: args.metrics,
      context: args.context,
    });
  },
});

export const syncAppleHealthDailyData = mutation({
  args: {
    dayKey: v.string(),
    metrics: integrationDailyMetricsValidator,
    summary: v.optional(v.string()),
    signals: v.optional(v.array(v.string())),
    context: v.optional(integrationDailyContextValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);

    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", "apple_health"),
      )
      .unique();

    if (!integration) {
      throw new Error(
        "Apple Health integration is not connected. Connect provider before syncing data.",
      );
    }

    const upserted = await upsertIntegrationDailyDataDoc(ctx.db, {
      userId: user._id,
      provider: "apple_health",
      dayKey: args.dayKey,
      metrics: args.metrics,
      summary:
        args.summary ??
        `Apple Health: ${args.metrics.steps ?? 0} steps, ${args.metrics.sleepMinutes ?? 0} sleep minutes.`,
      signals: args.signals,
      context: args.context,
    });

    await ctx.db.patch(integration._id, {
      status: "connected",
      lastError: undefined,
      lastSyncAt: Date.now(),
    });

    await recordIntegrationHealthEventInDb(ctx.db, {
      provider: "apple_health",
      userId: user._id,
      integrationId: integration._id,
      dayKey: args.dayKey,
      outcome: "success",
      tokenValidityStatus: "unknown",
    });

    return upserted;
  },
});

export const syncAppleCalendarDailyData = mutation({
  args: {
    dayKey: v.string(),
    summary: v.optional(v.string()),
    signals: v.optional(v.array(v.string())),
    context: v.optional(integrationDailyContextValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);

    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", "apple_calendar"),
      )
      .unique();

    if (!integration) {
      throw new Error(
        "Apple Calendar integration is not connected. Connect provider before syncing data.",
      );
    }

    const calendarContext = args.context?.calendar;
    const defaultSummary = calendarContext?.meetingsCount
      ? `Apple Calendar: ${calendarContext.meetingsCount} event${calendarContext.meetingsCount === 1 ? "" : "s"}${calendarContext.busyMinutes ? `, ${calendarContext.busyMinutes} busy minutes` : ""}.`
      : "Apple Calendar: calendar context captured from this device.";

    const upserted = await upsertIntegrationDailyDataDoc(ctx.db, {
      userId: user._id,
      provider: "apple_calendar",
      dayKey: args.dayKey,
      summary: args.summary ?? defaultSummary,
      signals: args.signals,
      context: args.context,
    });

    await ctx.db.patch(integration._id, {
      status: "connected",
      lastError: undefined,
      lastSyncAt: Date.now(),
    });

    await recordIntegrationHealthEventInDb(ctx.db, {
      provider: "apple_calendar",
      userId: user._id,
      integrationId: integration._id,
      dayKey: args.dayKey,
      outcome: "success",
      tokenValidityStatus: "unknown",
    });

    return upserted;
  },
});

export const upsertIntegrationDailyDataInternal = internalMutation({
  args: {
    userId: v.id("user"),
    provider: v.string(),
    dayKey: v.string(),
    metrics: v.optional(integrationDailyMetricsValidator),
    summary: v.optional(v.string()),
    signals: v.optional(v.array(v.string())),
    context: v.optional(integrationDailyContextValidator),
  },
  handler: async (ctx, args) => {
    if (!(await getActiveUserById(ctx, args.userId))) {
      throw new Error(
        "Cannot store integration data for an inactive user",
      );
    }

    validateDayKey(args.dayKey);
    const provider = assertDailyDataProvider(args.provider);

    return await upsertIntegrationDailyDataDoc(ctx.db, {
      userId: args.userId,
      provider,
      dayKey: args.dayKey,
      metrics: args.metrics,
      summary: args.summary,
      signals: args.signals,
      context: args.context,
    });
  },
});

export const syncMyIntegrationForDay = action({
  args: {
    provider: v.string(),
    dayKey: v.string(),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    return await syncMyIntegrationForDayImpl(ctx, args);
  },
});
export { syncMyIntegrationForDayImpl };

// Runbook (legacy integrations.tokenRef migration):
// 1) Audit candidates with adminAuditLegacyIntegrationTokenRefs.
// 2) Execute migration with adminMigrateLegacyIntegrationTokenRefsAll.
// 3) Verify completion with adminCountLegacyNonOpaqueIntegrationTokenRefs and
//    adminAuditUnsafeIntegrationTokenRefs.
// 4) Validate encrypted-only storage with adminAuditIntegrationSecretsEncryptionStatus.
// 5) A successful rollout ends with nonOpaqueCount === 0, unsafeCount === 0,
//    and legacyPlaintextRows === 0.
type LegacyTokenRefAuditArgs = {
  pageSize?: number;
  maxPages?: number;
  maxRows?: number;
};

type LegacyTokenRefCountArgs = {
  pageSize?: number;
  maxPages?: number;
};

type LegacyUnsupportedCleanupArgs = {
  batchSizePerProvider?: number;
  maxPasses?: number;
  force?: boolean;
  cursorByProvider?: LegacyUnsupportedProviderCursorMap;
};

type LegacyUnsupportedCountArgs = {
  batchSizePerProvider?: number;
  maxPasses?: number;
  cursorByProvider?: LegacyUnsupportedProviderCursorMap;
};

export async function adminAuditLegacyIntegrationTokenRefsImpl(
  ctx: QueryCtx,
  args: LegacyTokenRefAuditArgs,
) {
  await requireAdmin(ctx as never);

  const pageSize = normalizeAuditPageSize(args.pageSize);
  const maxPages = normalizeAuditMaxPages(args.maxPages);
  const maxRows = normalizeAuditMaxRows(args.maxRows);

  const counts = await scanLegacyIntegrationTokenRefs(ctx.db, {
    pageSize,
    maxPages,
    includeRows: true,
    maxRows,
  });

  return {
    ...counts,
    maxRows,
    opaqueTokenRefDefinition: OPAQUE_TOKEN_REF_DEFINITION,
  };
}

export async function adminCountLegacyNonOpaqueIntegrationTokenRefsImpl(
  ctx: QueryCtx,
  args: LegacyTokenRefCountArgs,
) {
  await requireAdmin(ctx as never);

  const pageSize = normalizeAuditPageSize(args.pageSize);
  const maxPages = normalizeAuditMaxPages(args.maxPages);

  const counts = await scanLegacyIntegrationTokenRefs(ctx.db, {
    pageSize,
    maxPages,
    includeRows: false,
    maxRows: 0,
  });

  return {
    nonOpaqueCount: counts.nonOpaqueCount,
    totalRows: counts.totalRows,
    opaqueCount: counts.opaqueCount,
    missingTokenRefRows: counts.missingTokenRefRows,
    pagesScanned: counts.pagesScanned,
    pageSize: counts.pageSize,
    isDone: counts.isDone,
    continueCursor: counts.continueCursor,
    opaqueTokenRefDefinition: OPAQUE_TOKEN_REF_DEFINITION,
  };
}

export async function adminAuditUnsafeIntegrationTokenRefsImpl(
  ctx: QueryCtx,
  args: LegacyTokenRefAuditArgs,
) {
  await requireAdmin(ctx as never);

  const pageSize = normalizeAuditPageSize(args.pageSize);
  const maxPages = normalizeAuditMaxPages(args.maxPages);
  const maxRows = normalizeAuditMaxRows(args.maxRows);

  const counts = await scanUnsafeIntegrationTokenRefs(ctx.db, {
    pageSize,
    maxPages,
    includeRows: true,
    maxRows,
  });

  return {
    ...counts,
    maxRows,
    opaqueTokenRefDefinition: OPAQUE_TOKEN_REF_DEFINITION,
  };
}

export async function adminCountLegacyUnsupportedIntegrationsImpl(
  ctx: QueryCtx,
  args: LegacyUnsupportedCountArgs = {},
) {
  await requireAdmin(ctx as never);
  return await countLegacyUnsupportedIntegrations(ctx.db, {
    batchSizePerProvider: normalizeCleanupBatchSizePerProvider(
      args.batchSizePerProvider,
    ),
    maxPasses: normalizeLegacyUnsupportedCountMaxPasses(args.maxPasses),
    cursorByProvider: args.cursorByProvider,
  });
}

export async function adminCleanupLegacyUnsupportedIntegrationsImpl(
  ctx: MutationCtx,
  args: LegacyUnsupportedCleanupArgs = {},
) {
  const admin = await requireAdmin(ctx as never);

  return await runLegacyUnsupportedCleanup(ctx, {
    trigger: "manual",
    actorUserId: admin._id,
    force: args.force === true,
    batchSizePerProvider: normalizeCleanupBatchSizePerProvider(
      args.batchSizePerProvider,
    ),
    maxPasses: normalizeCleanupMaxPasses(args.maxPasses),
    cursorByProvider: args.cursorByProvider,
  });
}

export async function adminMigrateLegacyIntegrationTokenRefsAllImpl(
  ctx: MutationCtx,
  args: LegacyTokenRefCountArgs,
) {
  const adminUser = await requireAdmin(ctx as never);

  const pageSize = normalizeAuditPageSize(args.pageSize);
  const maxPages = normalizeAuditMaxPages(args.maxPages);

  let cursor: string | null = null;
  let pagesScanned = 0;

  const counts: LegacyIntegrationTokenRefMigrationCounts = {
    migratedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    invalidatedCount: 0,
    auditLogCount: 0,
    scannedRows: 0,
    nonOpaqueDetectedCount: 0,
    opaqueCount: 0,
    missingTokenRefRows: 0,
  };

  while (pagesScanned < maxPages) {
    const page = await ctx.db.query("integrations").paginate({
      numItems: pageSize,
      cursor,
    });

    pagesScanned += 1;

    for (const integration of page.page as IntegrationRecord[]) {
      counts.scannedRows += 1;

      if (isLegacyNonOpaqueTokenRef(integration.tokenRef)) {
        counts.nonOpaqueDetectedCount += 1;

        try {
          const status = await migrateLegacyIntegrationTokenRef(
            ctx,
            adminUser._id,
            integration,
          );

          if (status === "migrated") {
            counts.migratedCount += 1;
            counts.auditLogCount += 1;
          } else {
            counts.skippedCount += 1;
          }
        } catch {
          counts.failedCount += 1;
        }

        continue;
      }

      const tokenRef = normalizeTokenRef(integration.tokenRef);
      if (!tokenRef) {
        counts.missingTokenRefRows += 1;

        if (classifyUnsafeTokenRefState(integration) === "missing") {
          await ctx.db.patch(integration._id, {
            status: "disconnected",
            tokenRef: undefined,
            lastSyncAt: undefined,
            lastError: UNSAFE_LEGACY_TOKEN_REF_REASON,
          });
          counts.invalidatedCount += 1;
        }
      } else if (isOpaqueTokenRef(tokenRef)) {
        counts.opaqueCount += 1;
      }

      counts.skippedCount += 1;
    }

    if (page.isDone) {
      return {
        ...counts,
        pagesScanned,
        pageSize,
        isDone: true,
        continueCursor: null,
        opaqueTokenRefDefinition: OPAQUE_TOKEN_REF_DEFINITION,
      };
    }

    cursor = page.continueCursor;
    if (!cursor) break;
  }

  return {
    ...counts,
    pagesScanned,
    pageSize,
    isDone: false,
    continueCursor: cursor,
    opaqueTokenRefDefinition: OPAQUE_TOKEN_REF_DEFINITION,
  };
}

export const adminAuditLegacyIntegrationTokenRefs = query({
  args: {
    pageSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
    maxRows: v.optional(v.number()),
  },
  handler: (ctx, args) =>
    adminAuditLegacyIntegrationTokenRefsImpl(ctx, {
      pageSize: args.pageSize,
      maxPages: args.maxPages,
      maxRows: args.maxRows,
    }),
});

export const adminCountLegacyNonOpaqueIntegrationTokenRefs = query({
  args: {
    pageSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
  },
  handler: (ctx, args) =>
    adminCountLegacyNonOpaqueIntegrationTokenRefsImpl(ctx, {
      pageSize: args.pageSize,
      maxPages: args.maxPages,
    }),
});

export const adminAuditUnsafeIntegrationTokenRefs = query({
  args: {
    pageSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
    maxRows: v.optional(v.number()),
  },
  handler: (ctx, args) =>
    adminAuditUnsafeIntegrationTokenRefsImpl(ctx, {
      pageSize: args.pageSize,
      maxPages: args.maxPages,
      maxRows: args.maxRows,
    }),
});

export const adminCountLegacyUnsupportedIntegrations = query({
  args: {
    batchSizePerProvider: v.optional(v.number()),
    maxPasses: v.optional(v.number()),
    cursorByProvider: v.optional(
      v.object({
        slack: v.optional(v.string()),
        strava: v.optional(v.string()),
        todoist: v.optional(v.string()),
      }),
    ),
  },
  handler: (ctx, args) =>
    adminCountLegacyUnsupportedIntegrationsImpl(ctx, {
      batchSizePerProvider: args.batchSizePerProvider,
      maxPasses: args.maxPasses,
      cursorByProvider: args.cursorByProvider,
    }),
});

export const adminCleanupLegacyUnsupportedIntegrations = mutation({
  args: {
    batchSizePerProvider: v.optional(v.number()),
    maxPasses: v.optional(v.number()),
    force: v.optional(v.boolean()),
    cursorByProvider: v.optional(
      v.object({
        slack: v.optional(v.string()),
        strava: v.optional(v.string()),
        todoist: v.optional(v.string()),
      }),
    ),
  },
  handler: (ctx, args) =>
    adminCleanupLegacyUnsupportedIntegrationsImpl(ctx, {
      batchSizePerProvider: args.batchSizePerProvider,
      maxPasses: args.maxPasses,
      force: args.force,
      cursorByProvider: args.cursorByProvider,
    }),
});

export const cleanupLegacyUnsupportedIntegrationsInternal = internalMutation({
  args: {
    batchSizePerProvider: v.optional(v.number()),
    maxPasses: v.optional(v.number()),
    force: v.optional(v.boolean()),
    cursorByProvider: v.optional(
      v.object({
        slack: v.optional(v.string()),
        strava: v.optional(v.string()),
        todoist: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const persistedCursorByProvider =
      args.cursorByProvider === undefined
        ? await readPersistedLegacyUnsupportedCleanupCursorByProvider(ctx.db)
        : null;

    const resumedCursorByProvider = persistedCursorByProvider
      ? toLegacyUnsupportedProviderCursorArgs(persistedCursorByProvider)
      : undefined;

    const result = await runLegacyUnsupportedCleanup(ctx, {
      trigger: "cron",
      force: args.force === true,
      batchSizePerProvider: normalizeCleanupBatchSizePerProvider(
        args.batchSizePerProvider,
      ),
      maxPasses: normalizeCleanupMaxPasses(args.maxPasses),
      cursorByProvider: args.cursorByProvider ?? resumedCursorByProvider,
    });

    try {
      await persistLegacyUnsupportedCleanupCursorState(ctx.db, result);
    } catch (error) {
      logWarn(
        "legacy_unsupported_integrations_cleanup.cursor_state_persist_failed",
        {
          status: "warning",
          attemptId: result.attemptId,
          message: error instanceof Error ? error.message : "unknown_error",
        },
      );

      captureException(
        "legacy_unsupported_integrations_cleanup.cursor_state_persist_failed",
        error,
        {
          status: "failed",
          attemptId: result.attemptId,
        },
      );
    }

    logInfo("legacy_unsupported_integrations_cleanup.cursor_state_applied", {
      status: "info",
      attemptId: result.attemptId,
      resumedFromStoredCursor: Boolean(resumedCursorByProvider),
      usedExplicitCursor: args.cursorByProvider !== undefined,
      hasNextCursorSlack: Boolean(result.nextCursorByProvider.slack),
      hasNextCursorStrava: Boolean(result.nextCursorByProvider.strava),
      hasNextCursorTodoist: Boolean(result.nextCursorByProvider.todoist),
      isDone: result.isDone,
    });

    return result;
  },
});

export const adminMigrateLegacyIntegrationTokenRefsAll = mutation({
  args: {
    pageSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
  },
  handler: (ctx, args) =>
    adminMigrateLegacyIntegrationTokenRefsAllImpl(ctx, {
      pageSize: args.pageSize,
      maxPages: args.maxPages,
    }),
});

export const adminAuditIntegrationSecretsEncryptionStatus = query({
  args: {
    pageSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const pageSize = normalizeAuditPageSize(args.pageSize);
    const maxPages = normalizeAuditMaxPages(args.maxPages);

    let cursor: string | null = null;
    let pagesScanned = 0;

    let totalRows = 0;
    let legacyPlaintextRows = 0;
    let encryptedRows = 0;
    let missingEncryptedAccessRows = 0;

    while (pagesScanned < maxPages) {
      const page = await ctx.db.query("integrationSecrets").paginate({
        numItems: pageSize,
        cursor,
      });

      pagesScanned += 1;

      for (const secret of page.page as IntegrationSecretRecord[]) {
        totalRows += 1;

        if (hasLegacyPlaintextSecretFields(secret)) {
          legacyPlaintextRows += 1;
        }

        if (secret.encryptedAccessToken) {
          encryptedRows += 1;
        } else {
          missingEncryptedAccessRows += 1;
        }
      }

      if (page.isDone) {
        return {
          totalRows,
          encryptedRows,
          legacyPlaintextRows,
          missingEncryptedAccessRows,
          pagesScanned,
          pageSize,
          isDone: true,
          continueCursor: null,
        };
      }

      cursor = page.continueCursor;
      if (!cursor) break;
    }

    return {
      totalRows,
      encryptedRows,
      legacyPlaintextRows,
      missingEncryptedAccessRows,
      pagesScanned,
      pageSize,
      isDone: false,
      continueCursor: cursor,
    };
  },
});

export const syncAllMyIntegrationsForDay = action({
  args: {
    dayKey: v.string(),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateDayKey(args.dayKey);

    const integrations = (await ctx.runQuery(
      api.integrations.listMyIntegrations,
      {},
    )) as Array<{
      provider: string;
      status: "connected" | "disconnected" | "error";
    }>;

    const results: Array<{
      provider: string;
      success: boolean;
      message?: string;
    }> = [];

    for (const integration of integrations) {
      const provider = asIntegrationProvider(integration.provider);
      if (!provider) continue;
      if (integration.status !== "connected") continue;

      const plugin = getRequiredIntegrationPlugin(provider);
      if (plugin.syncMode === "client_push") {
        results.push({
          provider,
          success: true,
          message: "Skipped server sync (client-managed provider).",
        });
        continue;
      }

      try {
        await ctx.runAction(api.integrations.syncMyIntegrationForDay, {
          provider,
          dayKey: args.dayKey,
          timeZone: args.timeZone,
        });
        results.push({ provider, success: true });
      } catch (error) {
        results.push({
          provider,
          success: false,
          message: error instanceof Error ? error.message : "Sync failed",
        });
      }
    }

    return {
      dayKey: args.dayKey,
      results,
    };
  },
});
