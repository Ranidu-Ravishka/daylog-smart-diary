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
import { paginationOptsValidator } from "convex/server";
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
import { applyDashboardMetricsDelta } from "./dashboardMetrics";
import {
  resolveIntegrationSyncAdapter,
  type NormalizedIntegrationDailySync,
} from "./providerAdapters";
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
const LEGACY_TOKEN_REF_MIGRATION_AUDIT_ACTION =
  "migrate_legacy_integration_token_ref";
const OPAQUE_TOKEN_REF_DEFINITION =
  'A tokenRef is opaque when it is a non-empty string prefixed with "tokref_" and does not store raw provider tokens.';

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
  accessToken?: string;
  refreshToken?: string;
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

type LegacySecretMigrationCounts = {
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
};

function hasLegacyPlaintextSecret(secret: IntegrationSecretRecord): boolean {
  return (
    typeof secret.accessToken === "string" ||
    typeof secret.refreshToken === "string"
  );
}

async function migrateLegacySecretRecord(
  db: MutationCtx["db"],
  secret: IntegrationSecretRecord,
): Promise<"migrated" | "skipped"> {
  const hasLegacyAccessToken = typeof secret.accessToken === "string";
  const hasLegacyRefreshToken = typeof secret.refreshToken === "string";
  const hasLegacyPlaintext = hasLegacyAccessToken || hasLegacyRefreshToken;

  if (!hasLegacyPlaintext) {
    return "skipped";
  }

  const provider = assertIntegrationProvider(secret.provider);
  const cryptoContext = {
    userId: String(secret.userId),
    provider,
    tokenRef: secret.tokenRef,
  };

  let accessTokenForMigration: string | undefined;

  if (hasLegacyAccessToken) {
    accessTokenForMigration = secret.accessToken;
  } else if (secret.encryptedAccessToken) {
    accessTokenForMigration = await decryptIntegrationSecret(
      secret.encryptedAccessToken,
      cryptoContext,
    );
  }

  if (!accessTokenForMigration) {
    return "skipped";
  }

  await upsertIntegrationSecret(db as never, {
    userId: secret.userId,
    provider,
    accessToken: accessTokenForMigration,
    refreshToken: hasLegacyRefreshToken ? secret.refreshToken : undefined,
    accessTokenExpiresAt: secret.accessTokenExpiresAt,
    lastRefreshAt: secret.lastRefreshAt,
    existingTokenRef: secret.tokenRef,
  });

  return "migrated";
}

async function migrateLegacySecretPage(
  db: MutationCtx["db"],
  pageRecords: IntegrationSecretRecord[],
): Promise<LegacySecretMigrationCounts> {
  const counts: LegacySecretMigrationCounts = {
    migratedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  };

  for (const secret of pageRecords) {
    try {
      const status = await migrateLegacySecretRecord(db, secret);
      if (status === "migrated") {
        counts.migratedCount += 1;
      } else {
        counts.skippedCount += 1;
      }
    } catch {
      counts.failedCount += 1;
    }
  }

  return counts;
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
  if (provider === "google_calendar" || provider === "google_fit") {
    return {
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    };
  }

  return {
    tokenUrl: "https://accounts.spotify.com/api/token",
    clientId: process.env.SPOTIFY_CLIENT_ID ?? "",
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",
  };
}

function sanitizeSignals(signals: string[] | undefined) {
  return (signals ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
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

  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error(
      `OAuth client credentials are missing for provider "${provider}". Configure ${provider === "spotify" ? "SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET" : "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET"} in Convex environment variables.`,
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
          accessToken?: string;
          refreshToken?: string;
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

  const refreshTokenSource =
    args.refreshToken !== undefined
      ? args.refreshToken
      : existing?.refreshToken !== undefined
        ? existing.refreshToken
        : undefined;

  const encryptedRefreshToken =
    refreshTokenSource !== undefined
      ? await encryptIntegrationSecret(refreshTokenSource, cryptoContext, now)
      : undefined;

  if (existing) {
    const patchPayload: Record<string, unknown> = {
      userId: args.userId,
      provider,
      encryptedAccessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      lastRefreshAt: args.lastRefreshAt,
      accessToken: undefined,
      refreshToken: undefined,
      updatedAt: now,
    };

    if (
      args.refreshToken !== undefined ||
      existing.refreshToken !== undefined
    ) {
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
    metrics?: {
      steps?: number;
      sleepMinutes?: number;
      screenTimeMinutes?: number;
      spendingTotal?: number;
    };
    summary?: string;
    signals?: string[];
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
        metrics?: {
          steps?: number;
          sleepMinutes?: number;
          screenTimeMinutes?: number;
          spendingTotal?: number;
        };
        summary?: string;
        signals?: string[];
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
        metrics?: {
          steps?: number;
          sleepMinutes?: number;
          screenTimeMinutes?: number;
          spendingTotal?: number;
        };
        summary?: string;
        signals?: string[];
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
    metrics: args.metrics,
    summary: args.summary,
    signals: sanitizeSignals(args.signals),
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
  syncStartedAt: number,
): Promise<NormalizedIntegrationDailySync> {
  const adapter = resolveIntegrationSyncAdapter(provider);
  return await adapter.execute({
    accessToken,
    dayKey,
    syncStartedAt,
    requestJson: fetchJson,
  });
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

    const accessToken = args.accessToken ?? args.tokenRef;

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
      encryptedAccessToken?: EncryptedSecretEnvelope;
      encryptedRefreshToken?: EncryptedSecretEnvelope;
      accessToken?: string;
      refreshToken?: string;
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

    let accessToken: string;
    let refreshToken: string | undefined;
    let isLegacyPlaintext = false;
    let needsKeyRotation = false;

    if (secret.encryptedAccessToken) {
      accessToken = await decryptIntegrationSecret(
        secret.encryptedAccessToken,
        cryptoContext,
      );

      if (
        !constantTimeStringEquals(
          secret.encryptedAccessToken.keyId,
          activeKeyId,
        )
      ) {
        needsKeyRotation = true;
      }
    } else if (secret.accessToken) {
      accessToken = secret.accessToken;
      isLegacyPlaintext = true;
      needsKeyRotation = true;
    } else {
      throw new Error(
        "Integration secret payload is invalid or missing token material.",
      );
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
    } else if (secret.refreshToken !== undefined) {
      refreshToken = secret.refreshToken;
      isLegacyPlaintext = true;
      needsKeyRotation = true;
    }

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: secret.accessTokenExpiresAt,
      isLegacyPlaintext,
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

// ── Delete an integration entirely ──────────────────────────
export const deleteIntegration = mutation({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const integration = await ctx.db.get(args.integrationId);

    if (!integration) {
      throw new Error("Integration not found");
    }

    requireOwnership(user, integration.userId);

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
      }
    }

    await deleteIntegrationSecretByRef(ctx.db as never, integration.tokenRef);

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
      }
    }

    await ctx.db.delete(args.integrationId);

    await applyDashboardMetricsDelta(ctx.db, {
      totalIntegrations: -1,
    });

    return { success: true };
  },
});

export const listSupportedProviders = query({
  args: {},
  handler: async () => {
    return [...integrationProviderList];
  },
});

export const listMyIntegrationDailyDataForDay = query({
  args: { dayKey: v.string() },
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

export const upsertMyIntegrationDailyData = mutation({
  args: {
    provider: v.string(),
    dayKey: v.string(),
    metrics: v.optional(
      v.object({
        steps: v.optional(v.number()),
        sleepMinutes: v.optional(v.number()),
        screenTimeMinutes: v.optional(v.number()),
        spendingTotal: v.optional(v.number()),
      }),
    ),
    summary: v.optional(v.string()),
    signals: v.optional(v.array(v.string())),
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
    });
  },
});

export const syncAppleHealthDailyData = mutation({
  args: {
    dayKey: v.string(),
    metrics: v.object({
      steps: v.optional(v.number()),
      sleepMinutes: v.optional(v.number()),
      screenTimeMinutes: v.optional(v.number()),
      spendingTotal: v.optional(v.number()),
    }),
    summary: v.optional(v.string()),
    signals: v.optional(v.array(v.string())),
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

export const upsertIntegrationDailyDataInternal = internalMutation({
  args: {
    userId: v.id("user"),
    provider: v.string(),
    dayKey: v.string(),
    metrics: v.optional(
      v.object({
        steps: v.optional(v.number()),
        sleepMinutes: v.optional(v.number()),
        screenTimeMinutes: v.optional(v.number()),
        spendingTotal: v.optional(v.number()),
      }),
    ),
    summary: v.optional(v.string()),
    signals: v.optional(v.array(v.string())),
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
    });
  },
});

export const syncMyIntegrationForDay = action({
  args: {
    provider: v.string(),
    dayKey: v.string(),
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
  },
) {
  validateDayKey(args.dayKey);
  const provider = assertIntegrationProvider(args.provider);

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
    if (!integration.tokenRef) {
      throw new Error(
        `Provider "${provider}" is missing tokenRef. Reconnect integration before syncing.`,
      );
    }

    let currentTokenRef = integration.tokenRef;
    let accessToken = integration.tokenRef;
    let refreshToken: string | undefined;
    let accessTokenExpiresAt: number | undefined;

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
        isLegacyPlaintext?: boolean;
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

      if (secret.isLegacyPlaintext || secret.needsKeyRotation) {
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

    if (oauthRefreshProvider && isAccessTokenNearExpiry(accessTokenExpiresAt)) {
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

    try {
      normalized = await syncProviderForDay(
        provider,
        accessToken,
        args.dayKey,
        syncStartedAt,
      );
    } catch (error) {
      const shouldRetryAfterRefresh =
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
        syncStartedAt,
      );
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

export const adminMigrateLegacyIntegrationSecretsPage = mutation({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const page = await ctx.db
      .query("integrationSecrets")
      .paginate(args.paginationOpts);
    const pageCounts = await migrateLegacySecretPage(
      ctx.db,
      page.page as IntegrationSecretRecord[],
    );

    return {
      ...pageCounts,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
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

        if (hasLegacyPlaintextSecret(secret)) {
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

export const adminMigrateLegacyIntegrationSecretsAll = mutation({
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

    let migratedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    while (pagesScanned < maxPages) {
      const page = await ctx.db.query("integrationSecrets").paginate({
        numItems: pageSize,
        cursor,
      });

      pagesScanned += 1;

      const pageCounts = await migrateLegacySecretPage(
        ctx.db,
        page.page as IntegrationSecretRecord[],
      );

      migratedCount += pageCounts.migratedCount;
      skippedCount += pageCounts.skippedCount;
      failedCount += pageCounts.failedCount;

      if (page.isDone) {
        return {
          migratedCount,
          skippedCount,
          failedCount,
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
      migratedCount,
      skippedCount,
      failedCount,
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

      try {
        await ctx.runAction(api.integrations.syncMyIntegrationForDay, {
          provider,
          dayKey: args.dayKey,
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
