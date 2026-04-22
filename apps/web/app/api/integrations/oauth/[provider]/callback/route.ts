import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  type OAuthProvider,
  getAppBaseUrl,
  getOAuthProviderConfig,
  isOAuthProvider,
  safeReturnPath,
} from "@/lib/integrations-oauth";
import { captureException, logInfo, logWarn } from "@/lib/observability";
import {
  getIntegrationProviderDefinition,
  isIntegrationProviderComingSoon,
} from "@repo/user-settings/lib/integration-provider-catalog";
import { resolveConvexHttpSiteOrigin } from "@/lib/convex-http-site";

const OAUTH_COOKIE_PREFIX = "daylog_oauth_state_";

type OAuthStateCookiePayload = {
  state: string;
  // `userId` is the *web* Clerk userId that started the flow, or null when
  // the flow was initiated via a mobile handoff (see `/start` route).
  userId: string | null;
  provider: string;
  returnPath: string;
  // One-time opaque code minted by the mobile app's authenticated Convex
  // session. When present, the callback uses it to identify the Convex user
  // for integration persistence instead of the web Clerk session.
  mobileHandoff?: string;
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

  if (isIntegrationProviderComingSoon(provider)) {
    const definition = getIntegrationProviderDefinition(provider);
    logOAuthCallback("warn", "oauth_callback_coming_soon_provider", {
      provider,
      message: definition?.helperText ?? "This integration is coming soon.",
    });
    return NextResponse.redirect(
      buildSettingsRedirect(
        request,
        provider,
        "error",
        definition?.helperText ?? "This integration is coming soon.",
        "/dashboard/settings",
      ),
    );
  }

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

  const { userId: webUserId, getToken } = await auth();

  // Two valid authentication modes converge here:
  //  1. Web-initiated flow: statePayload.userId was the web Clerk userId
  //     captured in /start, and the current session must still match.
  //  2. Mobile-initiated flow: statePayload.userId is null and the state
  //     cookie carries a Convex-minted mobileHandoff. The web Clerk session
  //     is irrelevant here — in fact, it is *expected* to be absent or
  //     different. Identity resolution is deferred to Convex, which trades
  //     the handoff for the mobile Convex userId.
  const isMobileHandoffFlow = Boolean(statePayload.mobileHandoff);

  if (!isMobileHandoffFlow) {
    if (!webUserId || webUserId !== statePayload.userId) {
      return rejectOAuthCallback(
        request,
        provider,
        oauthCookieName,
        statePayload.returnPath,
        "user_mismatch",
      );
    }
  }

  // Retained for downstream logs only; the real correlation id for a mobile
  // handoff flow lives on the Convex `oauthMobileHandoffs` row.
  const userId = webUserId ?? "mobile_handoff";

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

    const convexHttpOrigin = resolveConvexHttpSiteOrigin();
    const connectHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (isMobileHandoffFlow && statePayload.mobileHandoff) {
      // Mobile flow: authenticate to Convex via the one-time handoff. The
      // Convex HTTP action will trade it for the mobile user's Convex row.
      connectHeaders["X-Mobile-Handoff"] = statePayload.mobileHandoff;
      logOAuthCallback("info", "oauth_callback_convex_call_mobile_handoff", {
        provider,
        returnPath: statePayload.returnPath,
      });
    } else {
      // Web flow: authenticate to Convex using the web user's Clerk token.
      const convexToken = await getToken({ template: "convex" });
      if (!convexToken) {
        throw new Error("Missing Convex auth token for OAuth callback");
      }
      connectHeaders.Authorization = `Bearer ${convexToken}`;
    }

    const connectResponse = await fetch(
      `${convexHttpOrigin}/integrations/oauth/connect`,
      {
        method: "POST",
        headers: connectHeaders,
        body: JSON.stringify({
          provider,
          scopes: grantedScope,
          accessToken,
          refreshToken,
          accessTokenExpiresAt,
        }),
      },
    );

    if (!connectResponse.ok) {
      let detail = "";
      try {
        const text = await connectResponse.text();
        if (text) {
          try {
            const parsed = JSON.parse(text) as {
              message?: string;
              code?: string;
            };
            detail =
              typeof parsed.message === "string" && parsed.message.trim()
                ? parsed.message.trim()
                : text.slice(0, 280);
          } catch {
            detail = text.slice(0, 280);
          }
        }
      } catch {
        // ignore
      }
      throw new Error(
        `Convex OAuth connect failed (${connectResponse.status})${detail ? `: ${detail}` : ""}`,
      );
    }

    logOAuthCallback("info", "oauth_callback_connect_http_succeeded", {
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
