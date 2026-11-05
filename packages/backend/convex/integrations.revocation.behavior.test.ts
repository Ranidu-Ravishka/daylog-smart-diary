import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import {
  disconnectIntegration,
  processIntegrationRevocationInternal,
  retryIntegrationRevocationInternal,
} from "./integrations";

function handler<TArgs, TResult>(reference: unknown) {
  return (
    reference as {
      _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
    }
  )._handler;
}

function functionName(reference: unknown): string {
  return getFunctionName(reference as never);
}

const USER_ID = "user_001";
const OTHER_USER_ID = "user_002";
const INTEGRATION_ID = "integration_001";
const JOB_ID = "integrationRevocationJobs_00001";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("integration revocation behavior", () => {
  it("disconnects locally immediately, retains the secret for Google revocation, and checks ownership", async () => {
    const db = createInMemoryDb({
      user: [
        {
          _id: USER_ID,
          _creationTime: 1,
          clerkUserId: "clerk_user_001",
          email: "one@example.test",
          role: "member",
        },
        {
          _id: OTHER_USER_ID,
          _creationTime: 2,
          clerkUserId: "clerk_user_002",
          email: "two@example.test",
          role: "member",
        },
      ],
      integrations: [
        {
          _id: INTEGRATION_ID,
          _creationTime: 3,
          userId: USER_ID,
          provider: "google_calendar",
          status: "connected",
          tokenRef: "tokref_secret_001",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      integrationSecrets: [
        {
          _id: "secret_001",
          _creationTime: 4,
          userId: USER_ID,
          provider: "google_calendar",
          tokenRef: "tokref_secret_001",
          accessTokenCiphertext: "ciphertext",
          accessTokenIv: "iv",
          accessTokenTag: "tag",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const schedulerRunAfter = vi.fn(async () => undefined);
    const disconnect = handler<
      { integrationId: string },
      unknown
    >(disconnectIntegration);

    await expect(
      disconnect(
        {
          ...createAuthCtx(db, "clerk_user_002"),
          scheduler: { runAfter: schedulerRunAfter },
        },
        { integrationId: INTEGRATION_ID },
      ),
    ).rejects.toThrow();

    await disconnect(
      {
        ...createAuthCtx(db, "clerk_user_001"),
        scheduler: { runAfter: schedulerRunAfter },
      },
      { integrationId: INTEGRATION_ID },
    );

    expect(db.getTable("integrations")[0]).toMatchObject({
      status: "disconnected",
      tokenRef: undefined,
      remoteRevocationStatus: "pending",
    });
    expect(db.getTable("integrationSecrets")).toHaveLength(1);
    expect(db.getTable("integrationRevocationJobs")).toHaveLength(1);
    expect(schedulerRunAfter).toHaveBeenCalledTimes(1);
  });

  it("records provider confirmation and clears the retained secret after successful revocation", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const runQuery = vi.fn(
      async (_reference: unknown, args: Record<string, unknown>) => {
        if (args.jobId === JOB_ID) {
          return {
            _id: JOB_ID,
            status: "pending",
            provider: "google_calendar",
            attempts: 0,
          };
        }
        return {
          accessToken: "access-secret",
          refreshToken: "refresh-secret",
        };
      },
    );
    const runMutation = vi.fn(
      async (reference: unknown, _args: Record<string, unknown>) => {
        const name = functionName(reference);
        if (name.endsWith("beginIntegrationRevocationAttemptInternal")) {
          return {
            userId: USER_ID,
            provider: "google_calendar",
            tokenRef: "tokref_secret_001",
            attempts: 1,
          };
        }
        return { success: true };
      },
    );
    const process = handler<
      { jobId: string },
      { processed: boolean; status?: string }
    >(processIntegrationRevocationInternal);

    await expect(
      process(
        { runQuery, runMutation },
        { jobId: JOB_ID },
      ),
    ).resolves.toMatchObject({ processed: true, status: "revoked" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/revoke",
      expect.objectContaining({
        method: "POST",
        body: expect.any(URLSearchParams),
      }),
    );
    expect(
      functionName(runMutation.mock.calls[1]?.[0]).endsWith(
        "finishIntegrationRevocationInternal",
      ),
    ).toBe(true);
  });

  it("records retryable provider outages without treating them as successful revocation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const runQuery = vi.fn(
      async (_reference: unknown, args: Record<string, unknown>) => {
        if (args.jobId === JOB_ID) {
          return {
            _id: JOB_ID,
            status: "pending",
            provider: "google_calendar",
            attempts: 0,
          };
        }
        return { accessToken: "access-secret", refreshToken: "refresh-secret" };
      },
    );
    const runMutation = vi.fn(
      async (reference: unknown, _args: Record<string, unknown>) => {
        const name = functionName(reference);
        if (name.endsWith("beginIntegrationRevocationAttemptInternal")) {
          return {
            userId: USER_ID,
            provider: "google_calendar",
            tokenRef: "tokref_secret_001",
            attempts: 1,
          };
        }
        if (name.endsWith("retryIntegrationRevocationInternal")) {
          return { scheduled: true, terminal: false, nextAttemptAt: Date.now() };
        }
        throw new Error(`Unexpected mutation ${name}`);
      },
    );
    const process = handler<
      { jobId: string },
      { processed: boolean; status?: string }
    >(processIntegrationRevocationInternal);

    await expect(process({ runQuery, runMutation }, { jobId: JOB_ID })).resolves
      .toMatchObject({ processed: true, status: "pending" });
    expect(
      runMutation.mock.calls.some((call) =>
        functionName(call[0]).endsWith("retryIntegrationRevocationInternal"),
      ),
    ).toBe(true);
  });

  it("disconnects Spotify locally and records that remote revocation is unsupported", async () => {
    const db = createInMemoryDb({
      user: [
        {
          _id: USER_ID,
          _creationTime: 1,
          clerkUserId: "clerk_user_001",
          email: "one@example.test",
          role: "member",
        },
      ],
      integrations: [
        {
          _id: INTEGRATION_ID,
          _creationTime: 2,
          userId: USER_ID,
          provider: "spotify",
          status: "connected",
          tokenRef: "tokref_spotify_001",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      integrationSecrets: [
        {
          _id: "secret_spotify_001",
          _creationTime: 3,
          userId: USER_ID,
          provider: "spotify",
          tokenRef: "tokref_spotify_001",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const disconnect = handler<
      { integrationId: string },
      unknown
    >(disconnectIntegration);

    await disconnect(
      {
        ...createAuthCtx(db, "clerk_user_001"),
        scheduler: { runAfter: vi.fn(async () => undefined) },
      },
      { integrationId: INTEGRATION_ID },
    );

    expect(db.getTable("integrations")[0]).toMatchObject({
      status: "disconnected",
      tokenRef: undefined,
      remoteRevocationStatus: "unsupported",
    });
    expect(db.getTable("integrationSecrets")).toHaveLength(0);
    expect(db.getTable("integrationRevocationJobs")[0]?.status).toBe(
      "unsupported",
    );
  });

  it("records terminal failure after the retry limit and removes retained credentials", async () => {
    const db = createInMemoryDb({
      integrations: [
        {
          _id: INTEGRATION_ID,
          _creationTime: 1,
          userId: USER_ID,
          provider: "google_calendar",
          status: "disconnected",
          remoteRevocationStatus: "pending",
          remoteRevocationAttempts: 5,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      integrationRevocationJobs: [
        {
          _id: JOB_ID,
          _creationTime: 2,
          userId: USER_ID,
          integrationId: INTEGRATION_ID,
          provider: "google_calendar",
          tokenRef: "tokref_secret_001",
          status: "processing",
          attempts: 5,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      integrationSecrets: [
        {
          _id: "secret_001",
          _creationTime: 3,
          userId: USER_ID,
          provider: "google_calendar",
          tokenRef: "tokref_secret_001",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const retry = handler<
      { jobId: string; errorCode: string },
      { scheduled: boolean; terminal: boolean }
    >(retryIntegrationRevocationInternal);

    const result = await retry(
      {
        db,
        scheduler: { runAfter: vi.fn(async () => undefined) },
      },
      { jobId: JOB_ID, errorCode: "provider_network_error" },
    );

    expect(result).toEqual({ scheduled: false, terminal: true });
    expect(db.getTable("integrationRevocationJobs")[0]).toMatchObject({
      status: "failed",
      tokenRef: undefined,
      lastErrorCode: "provider_unavailable_after_retries",
    });
    expect(db.getTable("integrations")[0]).toMatchObject({
      remoteRevocationStatus: "failed",
      remoteRevocationErrorCode: "provider_unavailable_after_retries",
    });
    expect(db.getTable("integrationSecrets")).toHaveLength(0);
  });
});
