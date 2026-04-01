import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ActionCtx } from "./_generated/server";
import { syncMyIntegrationForDayImpl } from "./integrations";

type BeginResult = {
  shouldSync: boolean;
  reason?: "already_running" | "already_synced";
};

type IntegrationRecord = {
  _id: string;
  userId: string;
  provider: "spotify";
  status: "connected" | "error";
  tokenRef: string;
  permissions?: unknown;
  scopesMeta?: unknown;
  createdAt: number;
  updatedAt: number;
  lastSyncAt?: number;
};

type SecretRecord = {
  _id: string;
  userId: string;
  provider: "spotify";
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
};

type SyncState = {
  integration: IntegrationRecord | null;
  beginQueue: BeginResult[];
  secrets: Map<string, SecretRecord>;
  upsertCalls: number;
  recordSyncCalls: number;
  completeRuns: Array<{ status: "success" | "error"; lastError?: string }>;
  markErrors: string[];
  dailyData: Map<string, unknown>;
  tokenSequence: number;
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return "";
}

function createSyncContext(state: SyncState): ActionCtx {
  const runQuery = vi.fn(
    async (_ref: unknown, args: Record<string, unknown>) => {
      if (
        Object.prototype.hasOwnProperty.call(args, "provider") &&
        !Object.prototype.hasOwnProperty.call(args, "tokenRef")
      ) {
        const provider = args.provider;
        if (
          provider === "spotify" &&
          state.integration?.provider === "spotify"
        ) {
          return { ...state.integration };
        }
        return null;
      }

      if (Object.prototype.hasOwnProperty.call(args, "tokenRef")) {
        const tokenRef = args.tokenRef;
        if (typeof tokenRef !== "string") return null;
        const secret = state.secrets.get(tokenRef);
        return secret ? { ...secret } : null;
      }

      throw new Error(`Unexpected runQuery args: ${JSON.stringify(args)}`);
    },
  );

  const runMutation = vi.fn(
    async (_ref: unknown, args: Record<string, unknown>) => {
      if (
        Object.prototype.hasOwnProperty.call(args, "provider") &&
        Object.prototype.hasOwnProperty.call(args, "userId") &&
        Object.prototype.hasOwnProperty.call(args, "dayKey") &&
        !Object.prototype.hasOwnProperty.call(args, "status") &&
        !Object.prototype.hasOwnProperty.call(args, "metrics") &&
        !Object.prototype.hasOwnProperty.call(args, "accessToken")
      ) {
        return (
          state.beginQueue.shift() ?? {
            shouldSync: false,
            reason: "already_synced",
          }
        );
      }

      if (Object.prototype.hasOwnProperty.call(args, "accessToken")) {
        const existingTokenRef = args.existingTokenRef;
        const tokenRef =
          typeof existingTokenRef === "string"
            ? existingTokenRef
            : `opaque_test_ref_${String(++state.tokenSequence).padStart(3, "0")}`;

        state.secrets.set(tokenRef, {
          _id: tokenRef,
          userId: String(args.userId),
          provider: "spotify",
          accessToken: String(args.accessToken),
          refreshToken:
            typeof args.refreshToken === "string"
              ? String(args.refreshToken)
              : undefined,
          accessTokenExpiresAt:
            typeof args.accessTokenExpiresAt === "number"
              ? args.accessTokenExpiresAt
              : undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return tokenRef;
      }

      if (
        Object.prototype.hasOwnProperty.call(args, "integrationId") &&
        Object.prototype.hasOwnProperty.call(args, "tokenRef") &&
        !Object.prototype.hasOwnProperty.call(args, "status")
      ) {
        if (state.integration) {
          state.integration.tokenRef = String(args.tokenRef);
          state.integration.updatedAt = Date.now();
        }
        return { success: true };
      }

      if (Object.prototype.hasOwnProperty.call(args, "metrics")) {
        state.upsertCalls += 1;
        const key = `${String(args.userId)}:${String(args.provider)}:${String(args.dayKey)}`;
        state.dailyData.set(key, {
          metrics: args.metrics,
          summary: args.summary,
          signals: args.signals,
        });
        return { success: true };
      }

      if (
        Object.prototype.hasOwnProperty.call(args, "integrationId") &&
        !Object.prototype.hasOwnProperty.call(args, "reason") &&
        !Object.prototype.hasOwnProperty.call(args, "tokenRef")
      ) {
        state.recordSyncCalls += 1;
        if (state.integration) {
          state.integration.lastSyncAt = Date.now();
          state.integration.updatedAt = Date.now();
        }
        return { success: true };
      }

      if (Object.prototype.hasOwnProperty.call(args, "status")) {
        state.completeRuns.push({
          status: args.status as "success" | "error",
          lastError:
            typeof args.lastError === "string"
              ? String(args.lastError)
              : undefined,
        });
        return { success: true };
      }

      if (Object.prototype.hasOwnProperty.call(args, "reason")) {
        state.markErrors.push(String(args.reason));
        if (state.integration) {
          state.integration.status = "error";
          state.integration.updatedAt = Date.now();
        }
        return { success: true };
      }

      throw new Error(`Unexpected runMutation args: ${JSON.stringify(args)}`);
    },
  );

  return {
    runQuery,
    runMutation,
  } as unknown as ActionCtx;
}

function createBaseState(overrides?: Partial<SyncState>): SyncState {
  return {
    integration: {
      _id: "integration_001",
      userId: "user_001",
      provider: "spotify",
      status: "connected",
      tokenRef: "tokref_test_ref_001",
      createdAt: 1,
      updatedAt: 1,
    },
    beginQueue: [{ shouldSync: true }],
    secrets: new Map<string, SecretRecord>([
      [
        "tokref_test_ref_001",
        {
          _id: "tokref_test_ref_001",
          userId: "user_001",
          provider: "spotify",
          accessToken: "access_valid",
          refreshToken: "refresh_valid",
          accessTokenExpiresAt: Date.now() + 3_600_000,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    ]),
    upsertCalls: 0,
    recordSyncCalls: 0,
    completeRuns: [],
    markErrors: [],
    dailyData: new Map<string, unknown>(),
    tokenSequence: 1,
    ...overrides,
  };
}

beforeAll(() => {
  process.env.SPOTIFY_CLIENT_ID ??= "spotify_client_test";
  process.env.SPOTIFY_CLIENT_SECRET ??= "spotify_secret_test";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("integration sync behavior", () => {
  it("rejects invalid dayKey before issuing sync calls", async () => {
    const state = createBaseState();
    const ctx = createSyncContext(state);

    await expect(
      syncMyIntegrationForDayImpl(ctx, {
        provider: "spotify",
        dayKey: "2026-3-30",
      }),
    ).rejects.toThrow(
      'Invalid dayKey "2026-3-30": must be in YYYY-MM-DD format',
    );

    expect(state.upsertCalls).toBe(0);
    expect(state.recordSyncCalls).toBe(0);
  });

  it("is idempotent for repeated day sync requests", async () => {
    const state = createBaseState({
      beginQueue: [
        { shouldSync: true },
        { shouldSync: false, reason: "already_synced" },
      ],
    });
    const ctx = createSyncContext(state);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            { track: { id: "track-1" }, played_at: "2026-03-30T08:00:00.000Z" },
            { track: { id: "track-2" }, played_at: "2026-03-30T09:00:00.000Z" },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await syncMyIntegrationForDayImpl(ctx, {
      provider: "spotify",
      dayKey: "2026-03-30",
    });
    const second = await syncMyIntegrationForDayImpl(ctx, {
      provider: "spotify",
      dayKey: "2026-03-30",
    });

    expect(first.success).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(second.skippedReason).toBe("already_synced");
    expect(state.upsertCalls).toBe(1);
    expect(state.recordSyncCalls).toBe(1);
    expect(
      state.completeRuns.filter((run) => run.status === "success"),
    ).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries sync once after 401 by refreshing token and completes successfully", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const state = createBaseState();
    const ctx = createSyncContext(state);

    let playerCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);

      if (url.includes("api.spotify.com/v1/me/player/recently-played")) {
        playerCallCount += 1;
        if (playerCallCount === 1) {
          return new Response("unauthorized", {
            status: 401,
            statusText: "Unauthorized",
          });
        }

        return new Response(
          JSON.stringify({
            items: [
              {
                track: { id: "track-42" },
                played_at: "2026-03-30T10:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.includes("accounts.spotify.com/api/token")) {
        return new Response(
          JSON.stringify({
            access_token: "retry_access",
            refresh_token: "retry_refresh",
            expires_in: 3600,
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await syncMyIntegrationForDayImpl(ctx, {
      provider: "spotify",
      dayKey: "2026-03-30",
    });

    expect(result.success).toBe(true);
    expect(playerCallCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(state.upsertCalls).toBe(1);
    expect(state.completeRuns).toContainEqual(
      expect.objectContaining({ status: "success" }),
    );

    const refreshed = state.secrets.get("tokref_test_ref_001");
    expect(refreshed?.accessToken).toBe("retry_access");
    expect(refreshed?.refreshToken).toBe("retry_refresh");
  });

  it("refreshes expired token before syncing and persists the refreshed secret", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const state = createBaseState({
      secrets: new Map<string, SecretRecord>([
        [
          "tokref_test_ref_001",
          {
            _id: "tokref_test_ref_001",
            userId: "user_001",
            provider: "spotify",
            accessToken: "expired_access",
            refreshToken: "refresh_valid",
            accessTokenExpiresAt: 1_699_999_900_000,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      ]),
    });
    const ctx = createSyncContext(state);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("accounts.spotify.com/api/token")) {
        return new Response(
          JSON.stringify({
            access_token: "refreshed_access",
            refresh_token: "refreshed_refresh",
            expires_in: 3600,
          }),
          { status: 200 },
        );
      }

      if (url.includes("api.spotify.com/v1/me/player/recently-played")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                track: { id: "track-10" },
                played_at: "2026-03-30T12:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncMyIntegrationForDayImpl(ctx, {
      provider: "spotify",
      dayKey: "2026-03-30",
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const refreshed = state.secrets.get("tokref_test_ref_001");
    expect(refreshed?.accessToken).toBe("refreshed_access");
    expect(refreshed?.refreshToken).toBe("refreshed_refresh");
    expect(state.upsertCalls).toBe(1);
  });

  it("marks integration error and does not write day data when token refresh fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const state = createBaseState({
      secrets: new Map<string, SecretRecord>([
        [
          "tokref_test_ref_001",
          {
            _id: "tokref_test_ref_001",
            userId: "user_001",
            provider: "spotify",
            accessToken: "expired_access",
            refreshToken: "invalid_refresh",
            accessTokenExpiresAt: 1_699_999_900_000,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      ]),
    });
    const ctx = createSyncContext(state);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("accounts.spotify.com/api/token")) {
        return new Response("invalid refresh token", {
          status: 400,
          statusText: "Bad Request",
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncMyIntegrationForDayImpl(ctx, {
        provider: "spotify",
        dayKey: "2026-03-30",
      }),
    ).rejects.toThrow("Token refresh failed (400)");

    expect(state.upsertCalls).toBe(0);
    expect(state.markErrors).toHaveLength(1);
    expect(state.markErrors[0]).toContain("Token refresh failed (400)");
    expect(state.completeRuns).toContainEqual(
      expect.objectContaining({ status: "error" }),
    );
  });
});
