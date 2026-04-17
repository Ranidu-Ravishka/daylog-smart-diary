import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@repo/backend/convex";
import {
  type OAuthProvider,
  getAppBaseUrl,
  getOAuthProviderConfig,
  isOAuthProvider,
  safeReturnPath,
} from "@/lib/integrations-oauth";
import { captureException, logInfo, logWarn } from "@/lib/observability";

const OAUTH_COOKIE_PREFIX = "daylog_oauth_state_";

type OAuthStateCookiePayload = {
  state: string;
  userId: string;
  provider: string;
  returnPath: string;
};

export const runtime = "nodejs";

function logOAuthCallback(
  level: "info" | "warn",
  event: string,
  context: Record<string, unknown>,
) {
  const payload = {
    area: "oauth_callback",
    ...context,
  };

  if (level === "warn") {
    logWarn(event, payload);
    return;
  }

  logInfo(event, payload);
}

function rejectOAuthCallback(
  request: NextRequest,
  provider: string,
  oauthCookieName: string,
  returnPath: string | undefined,
  code:
    | "validation_failed"
    | "user_mismatch"
    | "provider_failure"
    | "system_failure",
  message = "OAuth callback rejected.",
) {
  const redirectUrl = buildSettingsRedirect(
    request,
    provider,
    "error",
    message,
    returnPath,
  );
  const response = NextResponse.redirect(redirectUrl);

  logOAuthCallback("warn", "oauth_callback_rejected", {
    provider,
    code,
    message,
    returnPath: returnPath ?? "/dashboard/settings",
    redirectTo: `${redirectUrl.pathname}${redirectUrl.search}`,
  });

  response.cookies.delete(oauthCookieName);
  return response;
}

function buildSettingsRedirect(
  request: NextRequest,
  provider: string,
  status: "success" | "error",
  message: string,
  returnPath?: string,
) {
  const mobileReturnUrl = resolveMobileReturnUrl(returnPath);
  if (mobileReturnUrl) {
    mobileReturnUrl.searchParams.set("integrationProvider", provider);
    mobileReturnUrl.searchParams.set("integrationStatus", status);
    mobileReturnUrl.searchParams.set("integrationMessage", message);
    return mobileReturnUrl;
  }

  const appBaseUrl = getAppBaseUrl(request.nextUrl.origin);
  const safePath = safeReturnPath(returnPath ?? "/dashboard/settings");
  const destination = new URL(`${appBaseUrl}${safePath}`);
  destination.searchParams.set("integrationProvider", provider);
  destination.searchParams.set("integrationStatus", status);
  destination.searchParams.set("integrationMessage", message);
  return destination;
}

function isAllowedMobileReturnProtocol(protocol: string): boolean {
  if (protocol === "mobile:" || protocol === "exp:") {
    return true;
  }

  return protocol.startsWith("exp+") && protocol.endsWith(":");
}

function resolveMobileReturnUrl(returnPath: string | undefined): URL | null {
  if (!returnPath) return null;

  try {
    const internalUrl = new URL(
      `https://daylog.internal${safeReturnPath(returnPath)}`,
    );
    if (internalUrl.pathname !== "/integrations/oauth/complete") {
      return null;
    }

    if (internalUrl.searchParams.get("mode") !== "mobile") {
      return null;
    }

    const returnUrl = internalUrl.searchParams.get("returnUrl");
    if (!returnUrl) {
      return null;
    }

    const parsedReturnUrl = new URL(returnUrl);
    if (
      !isAllowedMobileReturnProtocol(parsedReturnUrl.protocol.toLowerCase())
    ) {
      return null;
    }

    return parsedReturnUrl;
  } catch {
    return null;
  }
}

function formatCallbackFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "OAuth callback failed.";
  }

  const rawMessage = error.message.trim();

  if (rawMessage.includes("OAuth token exchange failed with status 400")) {
    return "OAuth token exchange failed (400). Check provider redirect URI and client credentials.";
  }

  if (rawMessage.includes("OAuth token exchange failed with status 401")) {
    return "OAuth token exchange failed (401). Check provider client ID and client secret.";
  }

  if (rawMessage.includes("Missing Convex auth token for OAuth callback")) {
    return "OAuth session expired. Sign in again and retry.";
  }

  if (rawMessage.includes("Missing NEXT_PUBLIC_CONVEX_URL")) {
    return "OAuth server configuration is incomplete (missing NEXT_PUBLIC_CONVEX_URL).";
  }

  // Keep production responses generic, but expose actionable details in development.
  if (process.env.NODE_ENV === "production") {
    return "OAuth callback failed.";
  }

  return `OAuth callback failed: ${rawMessage}`;
}

function resolveProviderDeniedMessage(
  provider: string,
  providerError: string,
): string {
  if (providerError !== "access_denied") {
    return "OAuth authorization was denied.";
  }

  if (
    provider === "google_calendar" ||
    provider === "google_fit" ||
    provider === "gmail_summary"
  ) {
    return "Google OAuth access is blocked. Add this Google account as a Test user in Google Cloud OAuth consent screen, or publish the app.";
  }

  return "OAuth authorization was denied.";
}

async function exchangeCodeForAccessToken(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<{
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  grantedScope: string[];
}> {
  const config = getOAuthProviderConfig(provider);

  let response: Response;

  if (config.tokenExchangeMode === "basic_json") {
    const basicAuth = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString("base64");

    response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
  } else {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", code);
    body.set("redirect_uri", redirectUri);
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);

    response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  }

  if (!response.ok) {
    throw new Error(
      `OAuth token exchange failed with status ${response.status}`,
    );
  }

  const tokenPayload = (await response.json()) as Record<string, unknown>;

  const splitScopes = (raw: string | undefined): string[] => {
    if (!raw) return [];
    return raw
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  };

  if (provider === "slack") {
    if (tokenPayload.ok === false) {
      const providerError =
        typeof tokenPayload.error === "string"
          ? tokenPayload.error
          : "unknown_error";
      throw new Error(
        `OAuth token exchange returned Slack error: ${providerError}`,
      );
    }

    const authedUser =
      typeof tokenPayload.authed_user === "object" &&
      tokenPayload.authed_user !== null
        ? (tokenPayload.authed_user as Record<string, unknown>)
        : null;

    const userToken =
      typeof authedUser?.access_token === "string"
        ? authedUser.access_token.trim()
        : "";
    const botToken =
      typeof tokenPayload.access_token === "string"
        ? tokenPayload.access_token.trim()
        : "";
    const accessToken = userToken || botToken;

    if (!accessToken) {
      throw new Error("OAuth token exchange returned no access token");
    }

    const scopeFromUser =
      typeof authedUser?.scope === "string" ? authedUser.scope : undefined;
    const scopeFromPayload =
      typeof tokenPayload.scope === "string" ? tokenPayload.scope : undefined;
    const grantedScope = splitScopes(scopeFromUser ?? scopeFromPayload);

    return {
      accessToken,
      refreshToken: undefined,
      accessTokenExpiresAt: undefined,
      grantedScope: grantedScope.length > 0 ? grantedScope : config.scopes,
    };
  }

  const accessToken =
    typeof tokenPayload.access_token === "string"
      ? tokenPayload.access_token.trim()
      : "";

  if (!accessToken) {
    throw new Error("OAuth token exchange returned no access token");
  }

  const refreshToken =
    typeof tokenPayload.refresh_token === "string" &&
    tokenPayload.refresh_token.trim().length > 0
      ? tokenPayload.refresh_token.trim()
      : undefined;

  const expiresInSeconds =
    typeof tokenPayload.expires_in === "number" &&
    Number.isFinite(tokenPayload.expires_in) &&
    tokenPayload.expires_in > 0
      ? tokenPayload.expires_in
      : undefined;

  const expiresAtRaw =
    typeof tokenPayload.expires_at === "number" &&
    Number.isFinite(tokenPayload.expires_at) &&
    tokenPayload.expires_at > 0
      ? tokenPayload.expires_at
      : undefined;

  const accessTokenExpiresAt = expiresAtRaw
    ? expiresAtRaw > 1_000_000_000_000
      ? Math.floor(expiresAtRaw)
      : Math.floor(expiresAtRaw * 1000)
    : expiresInSeconds
      ? Date.now() + expiresInSeconds * 1000
      : undefined;

  const grantedScopeRaw =
    typeof tokenPayload.scope === "string" ? tokenPayload.scope : undefined;
  const grantedScope = splitScopes(grantedScopeRaw);

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
    grantedScope: grantedScope.length > 0 ? grantedScope : config.scopes,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const params = await context.params;
  const provider = params.provider;
  const stateFromQuery = request.nextUrl.searchParams.get("state");
  const hasCode = Boolean(request.nextUrl.searchParams.get("code"));
  const providerError = request.nextUrl.searchParams.get("error");
  const providerErrorDescription =
    request.nextUrl.searchParams.get("error_description");

  logOAuthCallback("info", "oauth_callback_request_received", {
    provider,
    stateProvided: Boolean(stateFromQuery),
    statePrefix: stateFromQuery?.slice(0, 8) ?? null,
    hasCode,
    providerError: providerError ?? null,
    providerErrorDescription: providerErrorDescription ?? null,
  });

  if (!isOAuthProvider(provider)) {
    logOAuthCallback("warn", "oauth_callback_unsupported_provider", {
      provider,
    });
    return NextResponse.redirect(
      buildSettingsRedirect(
        request,
        provider,
        "error",
        "Unsupported OAuth provider.",
        "/dashboard/settings",
      ),
    );
  }

  const oauthCookieName = `${OAUTH_COOKIE_PREFIX}${provider}`;
  const encodedStateCookie = request.cookies.get(oauthCookieName)?.value;
  let statePayload: OAuthStateCookiePayload | null = null;

  if (encodedStateCookie) {
    try {
      statePayload = JSON.parse(
        Buffer.from(encodedStateCookie, "base64url").toString("utf8"),
      ) as OAuthStateCookiePayload;
    } catch {
      statePayload = null;
    }
  }

  const nextState = stateFromQuery;
  const code = request.nextUrl.searchParams.get("code");

  if (providerError) {
    return rejectOAuthCallback(
      request,
      provider,
      oauthCookieName,
      statePayload?.returnPath,
      "provider_failure",
      resolveProviderDeniedMessage(provider, providerError),
    );
  }

  if (
    !statePayload ||
    !nextState ||
    statePayload.state !== nextState ||
    !code
  ) {
    logOAuthCallback("warn", "oauth_callback_state_validation_failed", {
      provider,
      statePrefix: nextState?.slice(0, 8) ?? null,
      hasStateCookie: Boolean(statePayload),
      stateMatched: Boolean(
        statePayload && nextState && statePayload.state === nextState,
      ),
      hasCode: Boolean(code),
    });

    return rejectOAuthCallback(
      request,
      provider,
      oauthCookieName,
      statePayload?.returnPath,
      "validation_failed",
    );
  }

  logOAuthCallback("info", "oauth_callback_state_validated", {
    provider,
    statePrefix: nextState.slice(0, 8),
    returnPath: statePayload.returnPath,
  });

  const { userId, getToken } = await auth();
  if (!userId || userId !== statePayload.userId) {
    return rejectOAuthCallback(
      request,
      provider,
      oauthCookieName,
      statePayload.returnPath,
      "user_mismatch",
    );
  }

  const config = getOAuthProviderConfig(provider);
  if (!config.clientId || !config.clientSecret) {
    logOAuthCallback("warn", "oauth_callback_missing_provider_credentials", {
      provider,
      userId,
      returnPath: statePayload.returnPath,
      hasClientId: Boolean(config.clientId),
      hasClientSecret: Boolean(config.clientSecret),
    });
    return NextResponse.redirect(
      buildSettingsRedirect(
        request,
        provider,
        "error",
        "OAuth credentials are not configured on the server.",
        statePayload.returnPath,
      ),
    );
  }

  try {
    const appBaseUrl = getAppBaseUrl(request.nextUrl.origin);
    const callbackUrl = `${appBaseUrl}/api/integrations/oauth/${provider}/callback`;
    logOAuthCallback("info", "oauth_callback_token_exchange_started", {
      provider,
      userId,
      callbackUrl,
      returnPath: statePayload.returnPath,
    });

    const { accessToken, refreshToken, accessTokenExpiresAt, grantedScope } =
      await exchangeCodeForAccessToken(provider, code, callbackUrl);

    const convexToken = await getToken({ template: "convex" });
    if (!convexToken) {
      throw new Error("Missing Convex auth token for OAuth callback");
    }

    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
    }

    const convex = new ConvexHttpClient(convexUrl);
    convex.setAuth(convexToken);

    await convex.mutation(api.integrations.connectIntegration, {
      provider,
      scopes: grantedScope,
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
    });

    logOAuthCallback("info", "oauth_callback_connect_mutation_succeeded", {
      provider,
      userId,
      returnPath: statePayload.returnPath,
      grantedScopeCount: grantedScope.length,
      hasRefreshToken: Boolean(refreshToken),
    });

    const successRedirect = buildSettingsRedirect(
      request,
      provider,
      "success",
      "Integration connected successfully.",
      statePayload.returnPath,
    );

    const response = NextResponse.redirect(successRedirect);
    response.cookies.delete(oauthCookieName);

    logOAuthCallback("info", "oauth_callback_succeeded", {
      provider,
      userId,
      redirectTo: successRedirect.pathname,
      statePrefix: nextState.slice(0, 8),
    });

    return response;
  } catch (error) {
    const failureMessage = formatCallbackFailureMessage(error);

    captureException("oauth_callback_failed", error, {
      area: "oauth_callback",
      provider,
      returnPath: statePayload.returnPath,
      errorMessage: error instanceof Error ? error.message : "unknown",
      surfacedMessage: failureMessage,
    });

    return rejectOAuthCallback(
      request,
      provider,
      oauthCookieName,
      statePayload.returnPath,
      "system_failure",
      failureMessage,
    );
  }
}
