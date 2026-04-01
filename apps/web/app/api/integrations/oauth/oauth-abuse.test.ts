import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const convexSetAuthMock = vi.fn();
const convexMutationMock = vi.fn();
const convexClientCtorMock = vi
  .fn()
  .mockImplementation(function MockConvexHttpClient() {
    return {
      setAuth: convexSetAuthMock,
      mutation: convexMutationMock,
    };
  });

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: convexClientCtorMock,
}));

function makeRequest(url: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) {
    headers.set("cookie", cookie);
  }

  return new NextRequest(url, { headers });
}

function createStateCookie(
  provider: string,
  payload: {
    state: string;
    userId: string;
    returnPath: string;
  },
): string {
  const cookieName = `daylog_oauth_state_${provider}`;
  const encodedPayload = Buffer.from(
    JSON.stringify({
      ...payload,
      provider,
    }),
  ).toString("base64url");

  return `${cookieName}=${encodedPayload}`;
}

function readStateFromCookie(cookiePair: string): string {
  const separatorIndex = cookiePair.indexOf("=");
  const encodedValue = cookiePair.slice(separatorIndex + 1);
  const payload = JSON.parse(
    Buffer.from(encodedValue, "base64url").toString("utf8"),
  ) as {
    state: string;
  };

  return payload.state;
}

async function loadRoutes() {
  const startModule = await import("./[provider]/start/route");
  const callbackModule = await import("./[provider]/callback/route");

  return {
    startGet: startModule.GET,
    callbackGet: callbackModule.GET,
  };
}

describe("oauth abuse protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.daylog.test";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://convex.daylog.test";
    process.env.SPOTIFY_CLIENT_ID = "spotify_client_id";
    process.env.SPOTIFY_CLIENT_SECRET = "spotify_client_secret";
    process.env.GOOGLE_CLIENT_ID = "google_client_id";
    process.env.GOOGLE_CLIENT_SECRET = "google_client_secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects tampered state with 4xx and zero side effects", async () => {
    const { callbackGet } = await loadRoutes();

    authMock.mockResolvedValue({
      userId: "user_1",
      getToken: vi.fn(),
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const cookie = createStateCookie("spotify", {
      state: "state_expected",
      userId: "user_1",
      returnPath: "/dashboard/settings",
    });

    const request = makeRequest(
      "https://app.daylog.test/api/integrations/oauth/spotify/callback?state=state_tampered&code=valid_code",
      cookie,
    );

    const response = await callbackGet(request, {
      params: Promise.resolve({ provider: "spotify" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "OAuth callback rejected.",
    });

    expect(authMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(convexClientCtorMock).not.toHaveBeenCalled();
    expect(convexSetAuthMock).not.toHaveBeenCalled();
    expect(convexMutationMock).not.toHaveBeenCalled();
  });

  it("hard rejects user mismatch with no token persistence", async () => {
    const { callbackGet } = await loadRoutes();

    const getTokenMock = vi.fn();
    authMock.mockResolvedValue({
      userId: "attacker_user",
      getToken: getTokenMock,
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const cookie = createStateCookie("spotify", {
      state: "state_valid",
      userId: "victim_user",
      returnPath: "/dashboard/settings",
    });

    const request = makeRequest(
      "https://app.daylog.test/api/integrations/oauth/spotify/callback?state=state_valid&code=auth_code",
      cookie,
    );

    const response = await callbackGet(request, {
      params: Promise.resolve({ provider: "spotify" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "OAuth callback rejected.",
    });

    expect(authMock).toHaveBeenCalledTimes(1);
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(convexClientCtorMock).not.toHaveBeenCalled();
    expect(convexMutationMock).not.toHaveBeenCalled();
  });

  it("rejects replayed callback payload and prevents duplicate side effects", async () => {
    const { startGet, callbackGet } = await loadRoutes();

    const getTokenMock = vi.fn().mockResolvedValue("convex_jwt_token");
    authMock.mockResolvedValue({
      userId: "user_1",
      getToken: getTokenMock,
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "oauth_access_token",
          refresh_token: "oauth_refresh_token",
          expires_in: 3600,
          scope: "user-read-recently-played user-top-read",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    convexMutationMock.mockResolvedValue({ success: true });

    const startRequest = makeRequest(
      "https://app.daylog.test/api/integrations/oauth/spotify/start?returnTo=/dashboard/settings",
    );

    const startResponse = await startGet(startRequest, {
      params: Promise.resolve({ provider: "spotify" }),
    });

    expect(startResponse.status).toBe(307);
    const setCookieHeader = startResponse.headers.get("set-cookie");
    expect(setCookieHeader).toBeTruthy();

    const cookiePair = setCookieHeader!.split(";")[0]!;
    const state = readStateFromCookie(cookiePair);

    const validCallbackRequest = makeRequest(
      `https://app.daylog.test/api/integrations/oauth/spotify/callback?state=${encodeURIComponent(state)}&code=valid_authorization_code`,
      cookiePair,
    );

    const firstCallbackResponse = await callbackGet(validCallbackRequest, {
      params: Promise.resolve({ provider: "spotify" }),
    });

    expect(firstCallbackResponse.status).toBe(307);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(convexClientCtorMock).toHaveBeenCalledTimes(1);
    expect(convexSetAuthMock).toHaveBeenCalledTimes(1);
    expect(convexMutationMock).toHaveBeenCalledTimes(1);
    expect(getTokenMock).toHaveBeenCalledTimes(1);

    const replayRequest = makeRequest(
      `https://app.daylog.test/api/integrations/oauth/spotify/callback?state=${encodeURIComponent(state)}&code=valid_authorization_code`,
    );

    const replayResponse = await callbackGet(replayRequest, {
      params: Promise.resolve({ provider: "spotify" }),
    });

    expect(replayResponse.status).toBe(400);
    await expect(replayResponse.json()).resolves.toEqual({
      error: "OAuth callback rejected.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(convexClientCtorMock).toHaveBeenCalledTimes(1);
    expect(convexSetAuthMock).toHaveBeenCalledTimes(1);
    expect(convexMutationMock).toHaveBeenCalledTimes(1);
    expect(getTokenMock).toHaveBeenCalledTimes(1);
  });

  it("fails safely for malformed callback payloads with no writes", async () => {
    const { callbackGet } = await loadRoutes();

    const getTokenMock = vi.fn();
    authMock.mockResolvedValue({
      userId: "user_1",
      getToken: getTokenMock,
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const malformedCookieRequest = makeRequest(
      "https://app.daylog.test/api/integrations/oauth/spotify/callback?state=s1&code=c1",
      "daylog_oauth_state_spotify=not_base64_cookie",
    );

    const missingCodeRequest = makeRequest(
      "https://app.daylog.test/api/integrations/oauth/spotify/callback?state=s1",
      createStateCookie("spotify", {
        state: "s1",
        userId: "user_1",
        returnPath: "/dashboard/settings",
      }),
    );

    const missingStateRequest = makeRequest(
      "https://app.daylog.test/api/integrations/oauth/spotify/callback?code=c1",
      createStateCookie("spotify", {
        state: "s1",
        userId: "user_1",
        returnPath: "/dashboard/settings",
      }),
    );

    const malformedResponse = await callbackGet(malformedCookieRequest, {
      params: Promise.resolve({ provider: "spotify" }),
    });
    const missingCodeResponse = await callbackGet(missingCodeRequest, {
      params: Promise.resolve({ provider: "spotify" }),
    });
    const missingStateResponse = await callbackGet(missingStateRequest, {
      params: Promise.resolve({ provider: "spotify" }),
    });

    expect(malformedResponse.status).toBe(400);
    expect(missingCodeResponse.status).toBe(400);
    expect(missingStateResponse.status).toBe(400);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(convexClientCtorMock).not.toHaveBeenCalled();
    expect(convexSetAuthMock).not.toHaveBeenCalled();
    expect(convexMutationMock).not.toHaveBeenCalled();
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported providers at both OAuth entry points", async () => {
    const { startGet, callbackGet } = await loadRoutes();

    authMock.mockResolvedValue({ userId: "user_1", getToken: vi.fn() });

    const startRequest = makeRequest(
      "https://app.daylog.test/api/integrations/oauth/evil_provider/start",
    );
    const callbackRequest = makeRequest(
      "https://app.daylog.test/api/integrations/oauth/evil_provider/callback?state=s1&code=c1",
    );

    const startResponse = await startGet(startRequest, {
      params: Promise.resolve({ provider: "evil_provider" }),
    });
    const callbackResponse = await callbackGet(callbackRequest, {
      params: Promise.resolve({ provider: "evil_provider" }),
    });

    expect(startResponse.status).toBe(400);
    expect(callbackResponse.status).toBe(400);

    await expect(startResponse.json()).resolves.toEqual({
      error: "Unsupported OAuth provider",
    });
    await expect(callbackResponse.json()).resolves.toEqual({
      error: "Unsupported OAuth provider",
    });

    expect(convexClientCtorMock).not.toHaveBeenCalled();
    expect(convexMutationMock).not.toHaveBeenCalled();
  });
});
