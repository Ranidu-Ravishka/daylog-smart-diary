import type { Id } from "./_generated/dataModel";
import {
  assertIntegrationProvider,
  type IntegrationProvider,
  type OAuthRefreshProvider,
} from "./integrationProviders";
import {
  getOAuthCredentialEnvNames,
  getRequiredIntegrationPlugin,
} from "./integrationPlugins";
import {
  encryptIntegrationSecret,
  type EncryptedSecretEnvelope,
} from "./integrationSecretsCrypto";

const OPAQUE_TOKEN_REF_PREFIX = "tokref_";
const ACCESS_TOKEN_REFRESH_LEEWAY_MS = 60_000;
const TOKEN_REFRESH_MAX_ATTEMPTS = 3;
const TOKEN_REFRESH_BASE_BACKOFF_MS = 300;
const TOKEN_REFRESH_CIRCUIT_THRESHOLD = 5;
const TOKEN_REFRESH_CIRCUIT_COOLDOWN_MS = 60_000;
const refreshCircuitState = new Map<
  OAuthRefreshProvider,
  { failures: number; openedUntil: number }
>();

export type IntegrationSecretRecord = {
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

type ProviderOAuthCredentials = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
};

export type RefreshedTokenPayload = {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
};

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

function createOpaqueTokenRef(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  return `${OPAQUE_TOKEN_REF_PREFIX}${uuid}`;
}

function isRetryableTokenRefreshStatus(status: number): boolean {
  return status === 429 || status >= 500;
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

function tokenRefreshBackoff(attempt: number): number {
  const base = TOKEN_REFRESH_BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 180);
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureRefreshCircuitAllows(provider: OAuthRefreshProvider): void {
  const state = refreshCircuitState.get(provider);
  if (!state) return;
  if (state.openedUntil > Date.now()) {
    throw new Error(
      `Token refresh circuit open for provider "${provider}". Retry later.`,
    );
  }
}

function registerRefreshSuccess(provider: OAuthRefreshProvider): void {
  refreshCircuitState.set(provider, {
    failures: 0,
    openedUntil: 0,
  });
}

function registerRefreshFailure(provider: OAuthRefreshProvider): void {
  const current = refreshCircuitState.get(provider) ?? {
    failures: 0,
    openedUntil: 0,
  };
  const failures = current.failures + 1;
  const openedUntil =
    failures >= TOKEN_REFRESH_CIRCUIT_THRESHOLD
      ? Date.now() + TOKEN_REFRESH_CIRCUIT_COOLDOWN_MS
      : current.openedUntil;
  refreshCircuitState.set(provider, { failures, openedUntil });
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

export function isOpaqueTokenRef(value: string): boolean {
  return value.startsWith(OPAQUE_TOKEN_REF_PREFIX);
}

export function normalizeTokenRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
}

export function assertOpaqueTokenRef(value: unknown, context: string): string {
  const tokenRef = normalizeTokenRef(value);

  if (!tokenRef || !isOpaqueTokenRef(tokenRef)) {
    throw new Error(
      `${context} must be an opaque token reference prefixed with "${OPAQUE_TOKEN_REF_PREFIX}". Raw or legacy token formats are not allowed.`,
    );
  }

  return tokenRef;
}

export function isLegacyNonOpaqueTokenRef(value: unknown): value is string {
  const tokenRef = normalizeTokenRef(value);
  return tokenRef !== null && !isOpaqueTokenRef(tokenRef);
}

export function hasLegacyPlaintextSecretFields(
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

export function assertEncryptedOnlySecretRecord(
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

export function isAccessTokenNearExpiry(
  expiresAt: number | undefined,
): boolean {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    return false;
  }

  return expiresAt - Date.now() <= ACCESS_TOKEN_REFRESH_LEEWAY_MS;
}

export async function refreshOAuthAccessTokenWithRetry(
  provider: OAuthRefreshProvider,
  refreshToken: string,
): Promise<RefreshedTokenPayload> {
  ensureRefreshCircuitAllows(provider);
  let lastError: unknown;

  for (let attempt = 1; attempt <= TOKEN_REFRESH_MAX_ATTEMPTS; attempt++) {
    try {
      const refreshed = await refreshOAuthAccessToken(provider, refreshToken);
      registerRefreshSuccess(provider);
      return refreshed;
    } catch (error) {
      lastError = error;
      registerRefreshFailure(provider);

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

export async function upsertIntegrationSecret(
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

export async function deleteIntegrationSecretByRef(
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
