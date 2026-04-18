import { v } from "convex/values";
import {
  type ActionCtx,
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  mutation,
  query,
} from "./_generated/server";
import { requireAdmin, requireUser, requireOwnership } from "./authz";
import { clampLimit, validateDayKey } from "./validators";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  asIntegrationProvider,
  asOAuthRefreshProvider,
  assertDailyDataProvider,
  assertIntegrationProvider,
  integrationProviderList,
  type DailyDataProvider,
  type IntegrationProvider,
  type OAuthRefreshProvider,
} from "./integrationProviders";
import {
  getOAuthCredentialEnvNames,
  getRequiredIntegrationPlugin,
} from "./integrationPlugins";
import { applyDashboardMetricsDelta } from "./dashboardMetrics";
import {
  resolveIntegrationSyncAdapter,
  type NormalizedIntegrationDailySync,
} from "./providerAdapters";
import { getResolvedTimeZone, resolveTimeZone } from "../../ui/lib/day-window";
import {
  constantTimeStringEquals,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  getActiveIntegrationSecretKeyId,
  type EncryptedSecretEnvelope,
} from "./integrationSecretsCrypto";
import {
  deriveTokenValidityStatus,
  recordIntegrationHealthEventInDb,
} from "./integrationHealth";
import { captureException, logInfo } from "./observability";
import {
  getBackgroundLocationBatchFlushIntervalMinutes,
  getBackgroundLocationBatchMaxPoints,
  getBackgroundLocationMaxBatteryDrainPercentPerHour,
  getBackgroundLocationMaxUpdatesPerHour,
  getEnableBackgroundLocationTracking,
} from "./runtimeConfig";
import { evaluateFeatureFlagForIdentity } from "./featureFlags";

const OPAQUE_TOKEN_REF_PREFIX = "tokref_";
const PROVIDER_SYNC_MAX_ATTEMPTS = 3;
const PROVIDER_SYNC_BASE_BACKOFF_MS = 300;
const PROVIDER_SYNC_TIMEOUT_MS = 8_000;
const PROVIDER_SYNC_TOTAL_BUDGET_MS = 20_000;
const SYNC_RUN_IN_PROGRESS_TTL_MS = 60_000;
const ACCESS_TOKEN_REFRESH_LEEWAY_MS = 60_000;
const TOKEN_REFRESH_MAX_ATTEMPTS = 3;
const TOKEN_REFRESH_BASE_BACKOFF_MS = 300;
const DELETE_BATCH_SIZE = 256;
const LEGACY_SECRETS_AUDIT_DEFAULT_PAGE_SIZE = 200;
const LEGACY_SECRETS_AUDIT_MAX_PAGE_SIZE = 500;
const LEGACY_SECRETS_AUDIT_DEFAULT_MAX_PAGES = 100;
const LEGACY_SECRETS_AUDIT_MAX_PAGES = 2_000;
const LEGACY_TOKEN_REF_AUDIT_DEFAULT_MAX_ROWS = 500;
const LEGACY_TOKEN_REF_AUDIT_MAX_ROWS = 5_000;
const DEFAULT_SUMMARY_GENERATION_INTEGRATION_LIMIT = 32;
const MAX_SUMMARY_GENERATION_INTEGRATION_LIMIT = 128;
const LEGACY_TOKEN_REF_MIGRATION_AUDIT_ACTION =
  "migrate_legacy_integration_token_ref";
const OPAQUE_TOKEN_REF_DEFINITION =
  'A tokenRef is opaque when it is a non-empty string prefixed with "tokref_" and does not store raw provider tokens.';

function clampSummaryGenerationIntegrationLimit(
  value: number | undefined,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SUMMARY_GENERATION_INTEGRATION_LIMIT;
  }

  const normalized = Math.floor(value);

  if (normalized < 1) {
    return 1;
  }

  if (normalized > MAX_SUMMARY_GENERATION_INTEGRATION_LIMIT) {
    return MAX_SUMMARY_GENERATION_INTEGRATION_LIMIT;
  }

  return normalized;
}

type IntegrationDailyMetrics = {
  steps?: number;
  sleepMinutes?: number;
  screenTimeMinutes?: number;
  spendingTotal?: number;
};

type IntegrationLocationStayPoint = {
  label: string;
  startedAt: number;
  endedAt: number;
  durationMinutes: number;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
};

type IntegrationDailyContext = {
  schemaVersion?: number;
  location?: {
    mode: "foreground" | "background_controlled";
    totalTrackedMinutes?: number;
    totalDistanceMeters?: number;
    stayPoints?: IntegrationLocationStayPoint[];
  };
  fitness?: {
    steps?: number;
    distanceMeters?: number;
    activeMinutes?: number;
    idleMinutes?: number;
    source?: string;
  };
  calendar?: {
    meetingsCount?: number;
    busyMinutes?: number;
    remindersCount?: number;
    eventTitles?: string[];
  };
  activitySummary?: {
    callsCount?: number;
    callDurationMinutes?: number;
    mood?: string;
    moodConfidence?: number;
    activityLevel?: "active" | "mixed" | "idle";
  };
};

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

class ProviderRequestError extends Error {
  status: number;
  retryable: boolean;

  constructor(status: number, message: string, retryable: boolean) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
    this.retryable = retryable;
  }
}

class ProviderTokenRefreshError extends Error {
  status: number;
  retryable: boolean;

  constructor(status: number, message: string, retryable: boolean) {
    super(message);
    this.name = "ProviderTokenRefreshError";
    this.status = status;
    this.retryable = retryable;
  }
}

type ProviderOAuthCredentials = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
};

type RefreshedTokenPayload = {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
};

type IntegrationSecretRecord = {
  _id: Id<"integrationSecrets">;
  userId: Id<"user">;
  provider: string;
  tokenRef: string;
  encryptedAccessToken?: EncryptedSecretEnvelope;
  encryptedRefreshToken?: EncryptedSecretEnvelope;
  accessTokenExpiresAt?: number;
  lastRefreshAt?: number;
  createdAt?: number;
  updatedAt?: number;
};

type IntegrationRecord = {
  _id: Id<"integrations">;
  userId: Id<"user">;
  provider: string;
  status: "connected" | "disconnected" | "error";
  tokenRef?: string;
};

type LegacyIntegrationTokenRefAuditRow = {
  integrationId: Id<"integrations">;
  userId: Id<"user">;
  provider: string;
  status: "connected" | "disconnected" | "error";
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
  auditLogCount: number;
  scannedRows: number;
  nonOpaqueDetectedCount: number;
  opaqueCount: number;
  missingTokenRefRows: number;
};

function hasLegacyPlaintextSecretFields(
  secret: IntegrationSecretRecord,
): boolean {
  const legacySecret = secret as {
    accessToken?: unknown;
    refreshToken?: unknown;
  };

  return (
    typeof legacySecret.accessToken === "string" ||
    typeof legacySecret.refreshToken === "string"
  );
}

function assertEncryptedOnlySecretRecord(
  secret: IntegrationSecretRecord,
  context: {
    provider: string;
    userId: Id<"user">;
  },
): void {
  if (!hasLegacyPlaintextSecretFields(secret)) {
    return;
  }

  throw new Error(
    `Legacy plaintext integration secret fields detected for provider "${context.provider}". Encrypted-only secret storage is required before processing this record.`,
  );
}

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

function getProviderOAuthCredentials(
  provider: OAuthRefreshProvider,
): ProviderOAuthCredentials {
  const plugin = getRequiredIntegrationPlugin(provider);
  if (!plugin.oauth) {
    throw new Error(`Provider "${provider}" does not support OAuth refresh.`);
  }

  const { clientIdEnv, clientSecretEnv } = getOAuthCredentialEnvNames(
    plugin.oauth.credentialSource,
  );

  return {
    tokenUrl: plugin.oauth.tokenUrl,
    clientId: process.env[clientIdEnv] ?? "",
    clientSecret: process.env[clientSecretEnv] ?? "",
  };
}

function sanitizeSignals(signals: string[] | undefined) {
  return (signals ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function sanitizeSummaryText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const next = value.trim();
  if (!next) return undefined;
  return next.slice(0, 400);
}

function sanitizeSignalText(value: string): string {
  return value.trim().slice(0, 160);
}

function sanitizeNonNegativeNumber(
  value: number | undefined,
  maxValue: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return undefined;
  return Math.min(value, maxValue);
}

function toRounded(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sanitizeLatitude(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < -90 || value > 90) return undefined;
  return toRounded(value, 2);
}

function sanitizeLongitude(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < -180 || value > 180) return undefined;
  return toRounded(value, 2);
}

function sanitizeLocationMode(
  mode: string | undefined,
): "foreground" | "background_controlled" {
  return mode === "background_controlled"
    ? "background_controlled"
    : "foreground";
}

function sanitizeContext(
  context: IntegrationDailyContext | undefined,
): IntegrationDailyContext | undefined {
  if (!context) return undefined;

  const locationStayPoints: IntegrationLocationStayPoint[] = [];
  for (const point of context.location?.stayPoints ?? []) {
    const label = sanitizeSummaryText(point.label)?.slice(0, 100);
    const startedAt = sanitizeNonNegativeNumber(point.startedAt, 1e16);
    const endedAt = sanitizeNonNegativeNumber(point.endedAt, 1e16);
    const durationMinutes = sanitizeNonNegativeNumber(
      point.durationMinutes,
      24 * 60,
    );

    if (!label || startedAt === undefined || endedAt === undefined) {
      continue;
    }

    if (endedAt < startedAt) {
      continue;
    }

    const normalized: IntegrationLocationStayPoint = {
      label,
      startedAt,
      endedAt,
      durationMinutes:
        durationMinutes ??
        Math.max(1, Math.round((endedAt - startedAt) / 60000)),
    };

    const latitude = sanitizeLatitude(point.latitude);
    const longitude = sanitizeLongitude(point.longitude);
    const radiusMeters = sanitizeNonNegativeNumber(point.radiusMeters, 5_000);

    if (latitude !== undefined) {
      normalized.latitude = latitude;
    }

    if (longitude !== undefined) {
      normalized.longitude = longitude;
    }

    if (radiusMeters !== undefined) {
      normalized.radiusMeters = radiusMeters;
    }

    locationStayPoints.push(normalized);

    if (locationStayPoints.length >= 24) {
      break;
    }
  }

  const location = context.location
    ? {
        mode: sanitizeLocationMode(context.location.mode),
        totalTrackedMinutes: sanitizeNonNegativeNumber(
          context.location.totalTrackedMinutes,
          24 * 60,
        ),
        totalDistanceMeters: sanitizeNonNegativeNumber(
          context.location.totalDistanceMeters,
          300_000,
        ),
        stayPoints:
          locationStayPoints.length > 0 ? locationStayPoints : undefined,
      }
    : undefined;

  const fitness = context.fitness
    ? {
        steps: sanitizeNonNegativeNumber(context.fitness.steps, 200_000),
        distanceMeters: sanitizeNonNegativeNumber(
          context.fitness.distanceMeters,
          300_000,
        ),
        activeMinutes: sanitizeNonNegativeNumber(
          context.fitness.activeMinutes,
          24 * 60,
        ),
        idleMinutes: sanitizeNonNegativeNumber(
          context.fitness.idleMinutes,
          24 * 60,
        ),
        source: sanitizeSummaryText(context.fitness.source)?.slice(0, 64),
      }
    : undefined;

  const calendarEventTitles = (context.calendar?.eventTitles ?? [])
    .map((title) => sanitizeSummaryText(title)?.slice(0, 100))
    .filter((value): value is string => Boolean(value))
    .slice(0, 10);

  const calendar = context.calendar
    ? {
        meetingsCount: sanitizeNonNegativeNumber(
          context.calendar.meetingsCount,
          100,
        ),
        busyMinutes: sanitizeNonNegativeNumber(
          context.calendar.busyMinutes,
          1440,
        ),
        remindersCount: sanitizeNonNegativeNumber(
          context.calendar.remindersCount,
          200,
        ),
        eventTitles:
          calendarEventTitles.length > 0 ? calendarEventTitles : undefined,
      }
    : undefined;

  const moodConfidence = context.activitySummary?.moodConfidence;
  const activitySummary = context.activitySummary
    ? {
        callsCount: sanitizeNonNegativeNumber(
          context.activitySummary.callsCount,
          200,
        ),
        callDurationMinutes: sanitizeNonNegativeNumber(
          context.activitySummary.callDurationMinutes,
          24 * 60,
        ),
        mood: sanitizeSummaryText(context.activitySummary.mood)?.slice(0, 32),
        moodConfidence:
          typeof moodConfidence === "number" &&
          Number.isFinite(moodConfidence) &&
          moodConfidence >= 0 &&
          moodConfidence <= 1
            ? toRounded(moodConfidence, 2)
            : undefined,
        activityLevel:
          context.activitySummary.activityLevel === "active" ||
          context.activitySummary.activityLevel === "mixed" ||
          context.activitySummary.activityLevel === "idle"
            ? context.activitySummary.activityLevel
            : undefined,
      }
    : undefined;

  const normalized: IntegrationDailyContext = {
    schemaVersion: 1,
    location,
    fitness,
    calendar,
    activitySummary,
  };

  if (
    !normalized.location &&
    !normalized.fitness &&
    !normalized.calendar &&
    !normalized.activitySummary
  ) {
    return undefined;
  }

  return normalized;
}

function sanitizeMetrics(
  metrics: IntegrationDailyMetrics | undefined,
): IntegrationDailyMetrics | undefined {
  if (!metrics) return undefined;

  const normalized: IntegrationDailyMetrics = {
    steps: sanitizeNonNegativeNumber(metrics.steps, 200_000),
    sleepMinutes: sanitizeNonNegativeNumber(metrics.sleepMinutes, 24 * 60),
    screenTimeMinutes: sanitizeNonNegativeNumber(
      metrics.screenTimeMinutes,
      24 * 60,
    ),
    spendingTotal: sanitizeNonNegativeNumber(metrics.spendingTotal, 1_000_000),
  };

  if (Object.values(normalized).every((value) => value === undefined)) {
    return undefined;
  }

  return normalized;
}

function toWholeMinutesLabel(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (remainder === 0) return `${hours}h`;
    return `${hours}h ${remainder}m`;
  }

  return `${minutes}m`;
}

function maxDefined(
  current: number | undefined,
  incoming: number | undefined,
): number | undefined {
  if (incoming === undefined) return current;
  if (current === undefined) return incoming;
  return Math.max(current, incoming);
}

function isOpaqueTokenRef(value: string): boolean {
  return value.startsWith(OPAQUE_TOKEN_REF_PREFIX);
}

function normalizeTokenRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
}

function isLegacyNonOpaqueTokenRef(value: unknown): value is string {
  const tokenRef = normalizeTokenRef(value);
  return tokenRef !== null && !isOpaqueTokenRef(tokenRef);
}

function redactTokenRef(value: string): string {
  if (value.length < 9) {
    return "<redacted>";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function createOpaqueTokenRef(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  return `${OPAQUE_TOKEN_REF_PREFIX}${uuid}`;
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

async function findExistingOpaqueTokenRef(
  db: MutationCtx["db"],
  integration: IntegrationRecord,
): Promise<string | undefined> {
  const existingSecrets = (await db
    .query("integrationSecrets")
    .withIndex("by_user_provider", (q) =>
      q.eq("userId", integration.userId).eq("provider", integration.provider),
    )
    .collect()) as IntegrationSecretRecord[];

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

  const provider = assertIntegrationProvider(integration.provider);
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

function isRetryableProviderStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableTokenRefreshStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderRequestError) return error.retryable;
  if (error instanceof TypeError) return true;
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  ) {
    return true;
  }
  return false;
}

function isRetryableTokenRefreshError(error: unknown): boolean {
  if (error instanceof ProviderTokenRefreshError) return error.retryable;
  if (error instanceof TypeError) return true;
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  ) {
    return true;
  }
  return false;
}

function sanitizeSyncError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Provider sync failed";
  return message.slice(0, 220);
}

async function recordIntegrationHealthEvent(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    provider: string;
    userId: Id<"user">;
    integrationId: Id<"integrations">;
    dayKey: string;
    outcome: "success" | "error" | "skipped";
    tokenValidityStatus: "valid" | "expiring_soon" | "expired" | "unknown";
    error?: string;
    latencyMs?: number;
  },
) {
  await ctx.runMutation(
    (internal as any).integrationHealth.recordIntegrationHealthEventInternal,
    args,
  );
}

function jitteredBackoff(attempt: number): number {
  const base = PROVIDER_SYNC_BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 180);
  return base + jitter;
}

function tokenRefreshBackoff(attempt: number): number {
  const base = TOKEN_REFRESH_BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 180);
  return base + jitter;
}

function isAccessTokenNearExpiry(expiresAt: number | undefined): boolean {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    return false;
  }

  return expiresAt - Date.now() <= ACCESS_TOKEN_REFRESH_LEEWAY_MS;
}

async function refreshOAuthAccessToken(
  provider: OAuthRefreshProvider,
  refreshToken: string,
): Promise<RefreshedTokenPayload> {
  const credentials = getProviderOAuthCredentials(provider);
  const plugin = getRequiredIntegrationPlugin(provider);
  const oauth = plugin.oauth;

  if (!oauth) {
    throw new Error(`Provider "${provider}" does not support OAuth refresh.`);
  }

  const { clientIdEnv, clientSecretEnv } = getOAuthCredentialEnvNames(
    oauth.credentialSource,
  );

  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error(
      `OAuth client credentials are missing for provider "${provider}". Configure ${clientIdEnv}/${clientSecretEnv} in Convex environment variables.`,
    );
  }

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", refreshToken);
  form.set("client_id", credentials.clientId);
  form.set("client_secret", credentials.clientSecret);

  const response = await fetch(credentials.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!response.ok) {
    const status = response.status;
    const retryable = isRetryableTokenRefreshStatus(status);
    throw new ProviderTokenRefreshError(
      status,
      `Token refresh failed (${status}) for provider "${provider}".`,
      retryable,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new Error(
      `Token refresh returned no access_token for provider "${provider}".`,
    );
  }

  const expiresInSeconds =
    typeof payload.expires_in === "number" &&
    Number.isFinite(payload.expires_in) &&
    payload.expires_in > 0
      ? payload.expires_in
      : undefined;

  return {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string" &&
      payload.refresh_token.trim().length > 0
        ? payload.refresh_token
        : undefined,
    accessTokenExpiresAt: expiresInSeconds
      ? Date.now() + expiresInSeconds * 1000
      : undefined,
  };
}

async function refreshOAuthAccessTokenWithRetry(
  provider: OAuthRefreshProvider,
  refreshToken: string,
): Promise<RefreshedTokenPayload> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= TOKEN_REFRESH_MAX_ATTEMPTS; attempt++) {
    try {
      return await refreshOAuthAccessToken(provider, refreshToken);
    } catch (error) {
      lastError = error;

      const shouldRetry =
        attempt < TOKEN_REFRESH_MAX_ATTEMPTS &&
        isRetryableTokenRefreshError(error);

      if (!shouldRetry) break;

      await sleep(tokenRefreshBackoff(attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Token refresh failed unexpectedly.");
}

function remainingBudget(syncStartedAt: number): number {
  return PROVIDER_SYNC_TOTAL_BUDGET_MS - (Date.now() - syncStartedAt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertIntegrationSecret(
  db: {
    query: (table: "integrationSecrets") => {
      withIndex: (
        indexName: string,
        apply: (q: {
          eq: (field: string, value: unknown) => unknown;
        }) => unknown,
      ) => {
        unique: () => Promise<{
          _id: Id<"integrationSecrets">;
          userId: Id<"user">;
          provider: string;
          tokenRef: string;
          encryptedAccessToken?: EncryptedSecretEnvelope;
          encryptedRefreshToken?: EncryptedSecretEnvelope;
          accessToken?: unknown;
          refreshToken?: unknown;
          accessTokenExpiresAt?: number;
          lastRefreshAt?: number;
        } | null>;
      };
    };
    patch: (
      id: Id<"integrationSecrets">,
      value: Record<string, unknown>,
    ) => Promise<void>;
    insert: (
      table: "integrationSecrets",
      value: Record<string, unknown>,
    ) => Promise<Id<"integrationSecrets">>;
    get: (id: Id<"integrationSecrets">) => Promise<{ tokenRef: string } | null>;
  },
  args: {
    userId: Id<"user">;
    provider: IntegrationProvider;
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresAt?: number;
    lastRefreshAt?: number;
    existingTokenRef?: string;
  },
): Promise<string> {
  const provider = assertIntegrationProvider(args.provider);
  const now = Date.now();
  const tokenRef =
    args.existingTokenRef && isOpaqueTokenRef(args.existingTokenRef)
      ? args.existingTokenRef
      : createOpaqueTokenRef();

  const existing = await db
    .query("integrationSecrets")
    .withIndex("by_tokenRef", (q) => q.eq("tokenRef", tokenRef))
    .unique();

  if (existing) {
    assertEncryptedOnlySecretRecord(existing, {
      provider,
      userId: args.userId,
    });
  }

  const cryptoContext = {
    userId: String(args.userId),
    provider,
    tokenRef,
  };

  const encryptedAccessToken = await encryptIntegrationSecret(
    args.accessToken,
    cryptoContext,
    now,
  );

  const encryptedRefreshToken =
    args.refreshToken !== undefined
      ? await encryptIntegrationSecret(args.refreshToken, cryptoContext, now)
      : undefined;

  if (existing) {
    const patchPayload: Record<string, unknown> = {
      userId: args.userId,
      provider,
      encryptedAccessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      lastRefreshAt: args.lastRefreshAt,
      updatedAt: now,
    };

    if (args.refreshToken !== undefined) {
      patchPayload.encryptedRefreshToken = encryptedRefreshToken;
    }

    await db.patch(existing._id, {
      ...patchPayload,
    });
    return tokenRef;
  }

  await db.insert("integrationSecrets", {
    userId: args.userId,
    provider,
    tokenRef,
    encryptedAccessToken,
    encryptedRefreshToken,
    accessTokenExpiresAt: args.accessTokenExpiresAt,
    lastRefreshAt: args.lastRefreshAt,
    createdAt: now,
    updatedAt: now,
  });

  return tokenRef;
}

async function deleteIntegrationSecretByRef(
  db: {
    query: (table: "integrationSecrets") => {
      withIndex: (
        indexName: string,
        apply: (q: {
          eq: (field: string, value: unknown) => unknown;
        }) => unknown,
      ) => {
        unique: () => Promise<{ _id: Id<"integrationSecrets"> } | null>;
      };
    };
    delete: (id: Id<"integrationSecrets">) => Promise<void>;
  },
  tokenRef: string | undefined,
): Promise<void> {
  if (!tokenRef || !isOpaqueTokenRef(tokenRef)) return;

  const secret = await db
    .query("integrationSecrets")
    .withIndex("by_tokenRef", (q) => q.eq("tokenRef", tokenRef))
    .unique();

  if (!secret) return;
  await db.delete(secret._id);
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

  const typedDb = db as {
    query: (table: "integrationDailyData") => {
      withIndex: (
        indexName: "by_user_provider_day",
        apply: (q: {
          eq: (
            field: string,
            value: unknown,
          ) => {
            eq: (
              field: string,
              value: unknown,
            ) => {
              eq: (field: string, value: unknown) => unknown;
            };
          };
        }) => unknown,
      ) => {
        unique: () => Promise<{ _id: Id<"integrationDailyData"> } | null>;
      };
    };
    patch: (
      id: Id<"integrationDailyData">,
      value: {
        metrics?: IntegrationDailyMetrics;
        summary?: string;
        signals?: string[];
        context?: IntegrationDailyContext;
        syncedAt: number;
      },
    ) => Promise<void>;
    get: (id: Id<"integrationDailyData">) => Promise<unknown>;
    insert: (
      table: "integrationDailyData",
      value: {
        userId: Id<"user">;
        provider: string;
        dayKey: string;
        metrics?: IntegrationDailyMetrics;
        summary?: string;
        signals?: string[];
        context?: IntegrationDailyContext;
        syncedAt: number;
      },
    ) => Promise<Id<"integrationDailyData">>;
  };

  const existing = await typedDb
    .query("integrationDailyData")
    .withIndex("by_user_provider_day", (q) =>
      q
        .eq("userId", args.userId)
        .eq("provider", provider)
        .eq("dayKey", args.dayKey),
    )
    .unique();

  const payload = {
    metrics: sanitizeMetrics(args.metrics),
    summary: sanitizeSummaryText(args.summary),
    signals: sanitizeSignals(args.signals).map(sanitizeSignalText),
    context: sanitizeContext(args.context),
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

async function fetchJson<T>(
  url: string,
  accessToken: string,
  syncStartedAt: number,
  init?: RequestInit,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= PROVIDER_SYNC_MAX_ATTEMPTS; attempt++) {
    const budgetMs = remainingBudget(syncStartedAt);
    if (budgetMs <= 0) {
      throw new Error("Provider sync timed out before request could complete.");
    }

    const timeoutMs = Math.max(
      250,
      Math.min(PROVIDER_SYNC_TIMEOUT_MS, budgetMs),
    );
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...(init ?? {}),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ProviderRequestError(
          response.status,
          `Provider request failed (${response.status})`,
          isRetryableProviderStatus(response.status),
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      const shouldRetry =
        attempt < PROVIDER_SYNC_MAX_ATTEMPTS &&
        isRetryableProviderError(error) &&
        remainingBudget(syncStartedAt) > 0;

      if (!shouldRetry) {
        throw error;
      }

      const backoffMs = Math.min(
        jitteredBackoff(attempt),
        Math.max(50, remainingBudget(syncStartedAt) - 50),
      );
      await sleep(backoffMs);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Provider sync failed after retries.");
}

async function syncProviderForDay(
  provider: IntegrationProvider,
  accessToken: string,
  dayKey: string,
  timeZone: string,
  syncStartedAt: number,
): Promise<NormalizedIntegrationDailySync> {
  const adapter = resolveIntegrationSyncAdapter(provider);
  return await adapter.execute({
    accessToken,
    dayKey,
    timeZone,
    syncStartedAt,
    requestJson: fetchJson,
  });
}

async function syncDerivedAppleCalendarForDay(
  ctx: Pick<ActionCtx, "runQuery">,
  dayKey: string,
): Promise<NormalizedIntegrationDailySync> {
  const dailyRows = (await ctx.runQuery(
    api.integrations.listMyIntegrationDailyDataForDay,
    {
      dayKey,
    },
  )) as Array<{
    provider: string;
    summary?: string;
    signals?: string[];
    context?: IntegrationDailyContext;
  }>;

  const calendarRow = dailyRows.find((row) => row.provider === "calendar");
  if (!calendarRow) {
    return {
      summary: "Apple Calendar: no calendar context captured for this day.",
      signals: ["No calendar context captured for this day"],
    };
  }

  const calendarContext = calendarRow.context?.calendar;
  const summaryFromSource = sanitizeSummaryText(calendarRow.summary);
  const summary = summaryFromSource
    ? `Apple Calendar: ${summaryFromSource}`
    : calendarContext?.meetingsCount
      ? `Apple Calendar: ${calendarContext.meetingsCount} event${calendarContext.meetingsCount === 1 ? "" : "s"} captured from device context.`
      : "Apple Calendar: calendar context captured for this day.";

  return {
    summary,
    signals: sanitizeSignals([
      ...(calendarRow.signals ?? []),
      calendarContext?.meetingsCount
        ? `${calendarContext.meetingsCount} calendar events`
        : "No calendar events captured",
      calendarContext?.busyMinutes
        ? `${calendarContext.busyMinutes} busy minutes`
        : "No busy-time data",
      calendarContext?.remindersCount
        ? `${calendarContext.remindersCount} reminders`
        : "No reminder count",
    ]),
    context: calendarContext
      ? {
          schemaVersion: 1,
          calendar: {
            meetingsCount: calendarContext.meetingsCount,
            busyMinutes: calendarContext.busyMinutes,
            remindersCount: calendarContext.remindersCount,
            eventTitles: calendarContext.eventTitles,
          },
        }
      : undefined,
  };
}

// ── Connect a new integration ───────────────────────────────
export const connectIntegration = mutation({
  args: {
    provider: v.string(),
    scopes: v.optional(v.array(v.string())),
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    tokenRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const provider = assertIntegrationProvider(args.provider);
    const plugin = getRequiredIntegrationPlugin(provider);

    logInfo("integration_connect.started", {
      status: "started",
      userId: user._id,
      provider,
      scopesCount: args.scopes?.length ?? 0,
      hasAccessToken: Boolean(args.accessToken),
      hasRefreshToken: Boolean(args.refreshToken),
      hasTokenRefInput: Boolean(args.tokenRef),
    });

    const accessToken = args.accessToken ?? args.tokenRef;

    if (plugin.connectionMode === "oauth" && !accessToken) {
      throw new Error(
        `Provider "${provider}" requires an OAuth access token. Start the OAuth flow before connecting.`,
      );
    }

    const nextTokenRef = accessToken
      ? await upsertIntegrationSecret(ctx.db as never, {
          userId: user._id,
          provider,
          accessToken,
          refreshToken: args.refreshToken,
          accessTokenExpiresAt: args.accessTokenExpiresAt,
        })
      : undefined;

    // Check if this provider is already connected
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", provider),
      )
      .unique();

    if (existing) {
      // Re-connect / update
      await ctx.db.patch(existing._id, {
        status: "connected" as const,
        lastError: undefined,
        scopes: args.scopes,
        tokenRef: nextTokenRef ?? existing.tokenRef,
        lastSyncAt: Date.now(),
      });

      logInfo("integration_connect.succeeded", {
        status: "succeeded",
        userId: user._id,
        provider,
        integrationId: existing._id,
        mode: "reconnect",
        tokenRefPersisted: Boolean(nextTokenRef ?? existing.tokenRef),
      });

      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("integrations", {
      userId: user._id,
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
      userId: user._id,
      provider,
      integrationId: id,
      mode: "create",
      tokenRefPersisted: Boolean(nextTokenRef),
    });

    return await ctx.db.get(id);
  },
});

// ── Disconnect an integration ───────────────────────────────
export const disconnectIntegration = mutation({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const integration = await ctx.db.get(args.integrationId);

    if (!integration) {
      throw new Error("Integration not found");
    }

    requireOwnership(user, integration.userId);

    await ctx.db.patch(args.integrationId, {
      status: "disconnected" as const,
      lastError: undefined,
      tokenRef: undefined,
    });

    await deleteIntegrationSecretByRef(ctx.db as never, integration.tokenRef);

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
      .unique()) as {
      _id: Id<"integrationSecrets">;
      userId: Id<"user">;
      provider: string;
      tokenRef: string;
      encryptedAccessToken?: EncryptedSecretEnvelope;
      encryptedRefreshToken?: EncryptedSecretEnvelope;
      accessToken?: unknown;
      refreshToken?: unknown;
      accessTokenExpiresAt?: number;
    } | null;

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
    await ctx.db.patch(args.integrationId, { tokenRef: args.tokenRef });
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
export const listMyIntegrations = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    return await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) => q.eq("userId", user._id))
      .collect();
  },
});

export const listMyIntegrationSyncRunsForDay = query({
  args: { dayKey: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);

    return await ctx.db
      .query("integrationSyncRuns")
      .withIndex("by_user_day_updatedAt", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .order("desc")
      .collect();
  },
});

export const listMyIntegrationStatusSnapshots = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) => q.eq("userId", user._id))
      .collect();

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
    refreshToken: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);

    return await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .collect();
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

    return paginated.page
      .slice()
      .sort(
        (left, right) =>
          right.syncedAt - left.syncedAt ||
          right._creationTime - left._creationTime ||
          left.provider.localeCompare(right.provider),
      );
  },
});

export const getMyIntegrationContextAggregateForDay = query({
  args: { dayKey: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDayKey(args.dayKey);

    const rows = (await ctx.db
      .query("integrationDailyData")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .collect()) as Array<{
      provider: string;
      metrics?: IntegrationDailyMetrics;
      summary?: string;
      signals?: string[];
      context?: IntegrationDailyContext;
      syncedAt: number;
    }>;

    const syncRuns = (await ctx.db
      .query("integrationSyncRuns")
      .withIndex("by_user_day_updatedAt", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .collect()) as Array<{
      provider: string;
      status: "in_progress" | "success" | "error";
      updatedAt: number;
      lastError?: string;
    }>;

    const latestSyncRunByProvider = new Map<
      string,
      {
        provider: string;
        status: "in_progress" | "success" | "error";
        updatedAt: number;
        lastError?: string;
      }
    >();

    for (const run of syncRuns) {
      const existing = latestSyncRunByProvider.get(run.provider);
      if (!existing || run.updatedAt >= existing.updatedAt) {
        latestSyncRunByProvider.set(run.provider, run);
      }
    }

    const degradedProviders = [...latestSyncRunByProvider.values()]
      .filter((run) => run.status === "error")
      .map((run) => ({
        provider: run.provider,
        lastError: run.lastError,
        updatedAt: run.updatedAt,
      }));

    const pendingProviders = [...latestSyncRunByProvider.values()]
      .filter((run) => run.status === "in_progress")
      .map((run) => ({
        provider: run.provider,
        updatedAt: run.updatedAt,
      }));

    const providers = Array.from(new Set(rows.map((row) => row.provider)));

    let steps: number | undefined;
    let sleepMinutes: number | undefined;
    let screenTimeMinutes: number | undefined;
    let spendingTotal = 0;

    let distanceMeters: number | undefined;
    let activeMinutes: number | undefined;
    let idleMinutes: number | undefined;

    let meetingsCount = 0;
    let busyMinutes = 0;
    let remindersCount = 0;

    let callsCount = 0;
    let callDurationMinutes = 0;

    const locationStayPoints: IntegrationLocationStayPoint[] = [];
    let locationTrackedMinutes = 0;
    let locationDistanceMeters = 0;

    const activityLevelCounts: Record<"active" | "mixed" | "idle", number> = {
      active: 0,
      mixed: 0,
      idle: 0,
    };

    let preferredMood: string | undefined;
    let preferredMoodConfidence = -1;

    const mergedSignals: string[] = [];

    for (const row of rows) {
      steps = maxDefined(steps, row.metrics?.steps);
      sleepMinutes = maxDefined(sleepMinutes, row.metrics?.sleepMinutes);
      screenTimeMinutes = maxDefined(
        screenTimeMinutes,
        row.metrics?.screenTimeMinutes,
      );

      if (typeof row.metrics?.spendingTotal === "number") {
        spendingTotal += row.metrics.spendingTotal;
      }

      for (const signal of row.signals ?? []) {
        const cleaned = sanitizeSignalText(signal);
        if (cleaned) {
          mergedSignals.push(cleaned);
        }
      }

      const context = row.context;
      if (!context) continue;

      if (context.location) {
        locationTrackedMinutes += context.location.totalTrackedMinutes ?? 0;
        locationDistanceMeters += context.location.totalDistanceMeters ?? 0;
        for (const stayPoint of context.location.stayPoints ?? []) {
          locationStayPoints.push(stayPoint);
        }
      }

      if (context.fitness) {
        steps = maxDefined(steps, context.fitness.steps);
        distanceMeters = maxDefined(
          distanceMeters,
          context.fitness.distanceMeters,
        );
        activeMinutes = maxDefined(
          activeMinutes,
          context.fitness.activeMinutes,
        );
        idleMinutes = maxDefined(idleMinutes, context.fitness.idleMinutes);
      }

      if (context.calendar) {
        meetingsCount += context.calendar.meetingsCount ?? 0;
        busyMinutes += context.calendar.busyMinutes ?? 0;
        remindersCount += context.calendar.remindersCount ?? 0;
      }

      if (context.activitySummary) {
        callsCount += context.activitySummary.callsCount ?? 0;
        callDurationMinutes += context.activitySummary.callDurationMinutes ?? 0;

        const level = context.activitySummary.activityLevel;
        if (level) {
          activityLevelCounts[level] += 1;
        }

        if (
          context.activitySummary.mood &&
          (context.activitySummary.moodConfidence ?? 0) >=
            preferredMoodConfidence
        ) {
          preferredMood = context.activitySummary.mood;
          preferredMoodConfidence = context.activitySummary.moodConfidence ?? 0;
        }
      }
    }

    const topStayPoints = [...locationStayPoints]
      .sort((a, b) => b.durationMinutes - a.durationMinutes)
      .slice(0, 8);

    const topLocationSummary = topStayPoints
      .slice(0, 3)
      .map(
        (stayPoint) =>
          `${toWholeMinutesLabel(stayPoint.durationMinutes)} at ${stayPoint.label}`,
      );

    const locationSummary =
      topLocationSummary.length > 0
        ? `Spent ${topLocationSummary.join(", ")}.`
        : locationTrackedMinutes > 0
          ? `Tracked coarse location for ${toWholeMinutesLabel(locationTrackedMinutes)}.`
          : undefined;

    const derivedSignals: string[] = [];
    if (locationSummary) {
      derivedSignals.push(locationSummary);
    }
    if (meetingsCount > 0) {
      derivedSignals.push(
        `${meetingsCount} meetings, ${busyMinutes} busy minutes`,
      );
    }
    if (callsCount > 0) {
      derivedSignals.push(
        `${callsCount} calls, ${callDurationMinutes} total call minutes`,
      );
    }

    const activityLevel =
      activityLevelCounts.active >= activityLevelCounts.mixed &&
      activityLevelCounts.active >= activityLevelCounts.idle
        ? activityLevelCounts.active > 0
          ? "active"
          : undefined
        : activityLevelCounts.mixed >= activityLevelCounts.idle
          ? "mixed"
          : "idle";

    return {
      dayKey: args.dayKey,
      providerCount: providers.length,
      providers,
      metrics: {
        steps,
        sleepMinutes,
        screenTimeMinutes,
        spendingTotal:
          spendingTotal > 0 ? Math.round(spendingTotal * 100) / 100 : undefined,
      },
      location: {
        totalTrackedMinutes:
          locationTrackedMinutes > 0 ? locationTrackedMinutes : undefined,
        totalDistanceMeters:
          locationDistanceMeters > 0 ? locationDistanceMeters : undefined,
        stayPoints: topStayPoints,
        humanSummary: locationSummary,
      },
      fitness: {
        steps,
        distanceMeters,
        activeMinutes,
        idleMinutes,
      },
      calendar: {
        meetingsCount: meetingsCount > 0 ? meetingsCount : undefined,
        busyMinutes: busyMinutes > 0 ? busyMinutes : undefined,
        remindersCount: remindersCount > 0 ? remindersCount : undefined,
      },
      activitySummary: {
        callsCount: callsCount > 0 ? callsCount : undefined,
        callDurationMinutes:
          callDurationMinutes > 0 ? callDurationMinutes : undefined,
        mood: preferredMood,
        moodConfidence:
          preferredMoodConfidence >= 0
            ? toRounded(preferredMoodConfidence, 2)
            : undefined,
        activityLevel,
      },
      signals: Array.from(new Set([...mergedSignals, ...derivedSignals])).slice(
        0,
        24,
      ),
      health: {
        isDegraded: degradedProviders.length > 0,
        degradedProviders,
        pendingProviders,
      },
      syncedAtMax: rows.reduce(
        (maxValue, row) => Math.max(maxValue, row.syncedAt),
        0,
      ),
    };
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
    return await syncMyIntegrationForDayImpl(ctx, args);
  },
});

export async function syncMyIntegrationForDayImpl(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  args: {
    provider: string;
    dayKey: string;
    timeZone?: string;
  },
) {
  validateDayKey(args.dayKey);
  const provider = assertIntegrationProvider(args.provider);
  const plugin = getRequiredIntegrationPlugin(provider);
  const syncTimeZone = resolveTimeZone(args.timeZone, getResolvedTimeZone());

  logInfo("integration_sync.started", {
    status: "started",
    provider,
    syncMode: plugin.syncMode,
    dayKey: args.dayKey,
    timeZone: syncTimeZone,
  });

  const integration = (await ctx.runQuery(
    api.integrations.getIntegrationByProvider,
    {
      provider,
    },
  )) as {
    _id: Id<"integrations">;
    userId: Id<"user">;
    tokenRef?: string;
    status: "connected" | "disconnected" | "error";
  } | null;

  if (!integration) {
    throw new Error(
      `Provider "${provider}" is not connected for this account.`,
    );
  }
  if (integration.status === "disconnected") {
    throw new Error(`Provider "${provider}" is disconnected.`);
  }

  const syncRunState = (await ctx.runMutation(
    internal.integrations.beginIntegrationSyncRunInternal,
    {
      userId: integration.userId,
      provider,
      dayKey: args.dayKey,
    },
  )) as {
    shouldSync: boolean;
    reason: "ready" | "already_synced" | "already_running";
  };

  if (!syncRunState.shouldSync) {
    await recordIntegrationHealthEvent(ctx, {
      provider,
      userId: integration.userId,
      integrationId: integration._id,
      dayKey: args.dayKey,
      outcome: "skipped",
      tokenValidityStatus: "unknown",
      error: `Sync skipped (${syncRunState.reason})`,
    });

    logInfo("integration_sync.skipped", {
      status: "skipped",
      provider,
      dayKey: args.dayKey,
      userId: integration.userId,
      reason: syncRunState.reason,
    });

    return {
      success: true,
      provider,
      dayKey: args.dayKey,
      idempotent: true,
      skippedReason: syncRunState.reason,
    };
  }

  const syncStartedAt = Date.now();
  const oauthRefreshProvider = asOAuthRefreshProvider(provider);
  let latestTokenValidityStatus = deriveTokenValidityStatus(undefined);

  try {
    let currentTokenRef = integration.tokenRef ?? "";
    let accessToken = "";
    let refreshToken: string | undefined;
    let accessTokenExpiresAt: number | undefined;

    if (plugin.requiresStoredToken) {
      if (!integration.tokenRef) {
        throw new Error(
          `Provider "${provider}" is missing tokenRef. Reconnect integration before syncing.`,
        );
      }

      currentTokenRef = integration.tokenRef;
      accessToken = integration.tokenRef;

      if (isOpaqueTokenRef(integration.tokenRef)) {
        const secret = (await ctx.runQuery(
          internal.integrations.getIntegrationAccessTokenByRefInternal,
          {
            tokenRef: integration.tokenRef,
            userId: integration.userId,
            provider,
          },
        )) as {
          accessToken: string;
          refreshToken?: string;
          accessTokenExpiresAt?: number;
          needsKeyRotation?: boolean;
        } | null;

        if (!secret?.accessToken) {
          throw new Error(
            `Provider "${provider}" secret not found. Reconnect integration before syncing.`,
          );
        }

        accessToken = secret.accessToken;
        refreshToken = secret.refreshToken;
        accessTokenExpiresAt = secret.accessTokenExpiresAt;
        latestTokenValidityStatus =
          deriveTokenValidityStatus(accessTokenExpiresAt);

        if (secret.needsKeyRotation) {
          currentTokenRef = await ctx.runMutation(
            internal.integrations.storeIntegrationSecretInternal,
            {
              userId: integration.userId,
              provider,
              accessToken,
              refreshToken,
              accessTokenExpiresAt,
              existingTokenRef: currentTokenRef,
            },
          );
        }
      } else {
        const migratedTokenRef = await ctx.runMutation(
          internal.integrations.storeIntegrationSecretInternal,
          {
            userId: integration.userId,
            provider,
            accessToken: integration.tokenRef,
          },
        );

        await ctx.runMutation(
          internal.integrations.updateIntegrationTokenRefInternal,
          {
            integrationId: integration._id,
            tokenRef: migratedTokenRef,
          },
        );

        currentTokenRef = migratedTokenRef;
      }
    }

    if (
      plugin.requiresStoredToken &&
      oauthRefreshProvider &&
      isAccessTokenNearExpiry(accessTokenExpiresAt)
    ) {
      if (!refreshToken) {
        throw new Error(
          `Provider "${provider}" access token has expired and no refresh token is available. Reconnect integration.`,
        );
      }

      const refreshed = await refreshOAuthAccessTokenWithRetry(
        oauthRefreshProvider,
        refreshToken,
      );

      const nextRefreshToken = refreshed.refreshToken ?? refreshToken;

      currentTokenRef = await ctx.runMutation(
        internal.integrations.storeIntegrationSecretInternal,
        {
          userId: integration.userId,
          provider,
          accessToken: refreshed.accessToken,
          refreshToken: nextRefreshToken,
          accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
          lastRefreshAt: Date.now(),
          existingTokenRef: currentTokenRef,
        },
      );

      accessToken = refreshed.accessToken;
      refreshToken = nextRefreshToken;
      accessTokenExpiresAt = refreshed.accessTokenExpiresAt;
      latestTokenValidityStatus =
        deriveTokenValidityStatus(accessTokenExpiresAt);
    }

    let normalized: NormalizedIntegrationDailySync;

    if (plugin.syncMode === "derived_contextual_calendar") {
      normalized = await syncDerivedAppleCalendarForDay(ctx, args.dayKey);
    } else if (plugin.syncMode === "client_push") {
      throw new Error(
        `Provider "${provider}" sync is managed by device-side upload. Use the provider-specific client sync flow.`,
      );
    } else {
      try {
        normalized = await syncProviderForDay(
          provider,
          accessToken,
          args.dayKey,
          syncTimeZone,
          syncStartedAt,
        );
      } catch (error) {
        const shouldRetryAfterRefresh =
          plugin.requiresStoredToken &&
          !!oauthRefreshProvider &&
          !!refreshToken &&
          error instanceof ProviderRequestError &&
          error.status === 401;

        if (!shouldRetryAfterRefresh) {
          throw error;
        }

        if (!oauthRefreshProvider || !refreshToken) {
          throw error;
        }

        const refreshed = await refreshOAuthAccessTokenWithRetry(
          oauthRefreshProvider,
          refreshToken,
        );

        const nextRefreshToken = refreshed.refreshToken ?? refreshToken;
        await ctx.runMutation(
          internal.integrations.storeIntegrationSecretInternal,
          {
            userId: integration.userId,
            provider,
            accessToken: refreshed.accessToken,
            refreshToken: nextRefreshToken,
            accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
            lastRefreshAt: Date.now(),
            existingTokenRef: currentTokenRef,
          },
        );

        accessToken = refreshed.accessToken;
        refreshToken = nextRefreshToken;
        accessTokenExpiresAt = refreshed.accessTokenExpiresAt;
        latestTokenValidityStatus =
          deriveTokenValidityStatus(accessTokenExpiresAt);

        normalized = await syncProviderForDay(
          provider,
          accessToken,
          args.dayKey,
          syncTimeZone,
          syncStartedAt,
        );
      }
    }

    await ctx.runMutation(
      internal.integrations.upsertIntegrationDailyDataInternal,
      {
        userId: integration.userId,
        provider,
        dayKey: args.dayKey,
        metrics: normalized.metrics,
        summary: normalized.summary,
        signals: normalized.signals,
        context: normalized.context,
      },
    );

    await ctx.runMutation(api.integrations.recordSync, {
      integrationId: integration._id,
    });

    await ctx.runMutation(
      internal.integrations.completeIntegrationSyncRunInternal,
      {
        userId: integration.userId,
        provider,
        dayKey: args.dayKey,
        status: "success",
      },
    );

    await recordIntegrationHealthEvent(ctx, {
      provider,
      userId: integration.userId,
      integrationId: integration._id,
      dayKey: args.dayKey,
      outcome: "success",
      tokenValidityStatus: latestTokenValidityStatus,
      latencyMs: Date.now() - syncStartedAt,
    });

    logInfo("integration_sync.succeeded", {
      status: "succeeded",
      provider,
      dayKey: args.dayKey,
      userId: integration.userId,
      durationMs: Date.now() - syncStartedAt,
      tokenValidityStatus: latestTokenValidityStatus,
    });

    return {
      success: true,
      provider,
      dayKey: args.dayKey,
    };
  } catch (error) {
    const message = sanitizeSyncError(error);

    await ctx.runMutation(api.integrations.markIntegrationError, {
      integrationId: integration._id,
      reason: message,
    });

    await ctx.runMutation(
      internal.integrations.completeIntegrationSyncRunInternal,
      {
        userId: integration.userId,
        provider,
        dayKey: args.dayKey,
        status: "error",
        lastError: message,
      },
    );

    await recordIntegrationHealthEvent(ctx, {
      provider,
      userId: integration.userId,
      integrationId: integration._id,
      dayKey: args.dayKey,
      outcome: "error",
      tokenValidityStatus: latestTokenValidityStatus,
      error: message,
      latencyMs: Date.now() - syncStartedAt,
    });

    captureException("integration_sync.failed", error, {
      status: "failed",
      provider,
      dayKey: args.dayKey,
      userId: integration.userId,
      durationMs: Date.now() - syncStartedAt,
      tokenValidityStatus: latestTokenValidityStatus,
    });

    throw error;
  }
}

// Runbook (legacy integrations.tokenRef migration):
// 1) Audit candidates with adminAuditLegacyIntegrationTokenRefs.
// 2) Execute migration with adminMigrateLegacyIntegrationTokenRefsAll.
// 3) Verify completion with adminCountLegacyNonOpaqueIntegrationTokenRefs.
// 4) A successful rollout ends with nonOpaqueCount === 0.
type LegacyTokenRefAuditArgs = {
  pageSize?: number;
  maxPages?: number;
  maxRows?: number;
};

type LegacyTokenRefCountArgs = {
  pageSize?: number;
  maxPages?: number;
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
