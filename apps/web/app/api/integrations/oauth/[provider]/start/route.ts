import { randomUUID } from "crypto";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  getAppBaseUrl,
  getOAuthProviderConfig,
  isOAuthProvider,
  safeReturnPath,
} from "@/lib/integrations-oauth";

const OAUTH_COOKIE_PREFIX = "daylog_oauth_state_";

type OAuthStateCookiePayload = {
  state: string;
  userId: string;
  provider: string;
  returnPath: string;
};

export const runtime = "nodejs";

function logOAuthStart(
  level: "info" | "warn",
  event: string,
  context: Record<string, unknown>,
) {
  const payload = {
    area: "oauth_start",
    event,
    ...context,
  };

  if (level === "warn") {
    console.warn(payload);
    return;
  }

  console.info(payload);
}

function buildResultRedirect(
  request: NextRequest,
  provider: string,
  status: "success" | "error",
  message: string,
  returnPath: string,
) {
  const appBaseUrl = getAppBaseUrl(request.nextUrl.origin);
  const destination = new URL(`${appBaseUrl}${safeReturnPath(returnPath)}`);
  destination.searchParams.set("integrationProvider", provider);
  destination.searchParams.set("integrationStatus", status);
  destination.searchParams.set("integrationMessage", message);
  return destination;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const params = await context.params;
  const provider = params.provider;
  const returnPath = safeReturnPath(
    request.nextUrl.searchParams.get("returnTo"),
  );

  const { userId } = await auth();
  if (!userId) {
    logOAuthStart("warn", "unauthenticated_redirect", {
      provider,
      returnPath,
    });
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  if (!isOAuthProvider(provider)) {
    const redirectUrl = buildResultRedirect(
      request,
      provider,
      "error",
      "Unsupported OAuth provider.",
      returnPath,
    );

    logOAuthStart("warn", "unsupported_provider", {
      provider,
      returnPath,
      userId,
      redirectTo: `${redirectUrl.pathname}${redirectUrl.search}`,
    });
    return NextResponse.redirect(redirectUrl);
  }

  const config = getOAuthProviderConfig(provider);
  if (!config.clientId || !config.clientSecret) {
    const redirectUrl = buildResultRedirect(
      request,
      provider,
      "error",
      "OAuth is not configured for this provider.",
      returnPath,
    );

    logOAuthStart("warn", "missing_provider_credentials", {
      provider,
      returnPath,
      userId,
      hasClientId: Boolean(config.clientId),
      hasClientSecret: Boolean(config.clientSecret),
      redirectTo: `${redirectUrl.pathname}${redirectUrl.search}`,
    });
    return NextResponse.redirect(redirectUrl);
  }

  const appBaseUrl = getAppBaseUrl(request.nextUrl.origin);
  const callbackUrl = `${appBaseUrl}/api/integrations/oauth/${provider}/callback`;
  const state = randomUUID();

  logOAuthStart("info", "request_received", {
    provider,
    userId,
    returnPath,
    callbackUrl,
    appBaseUrl,
    statePrefix: state.slice(0, 8),
  });

  const authUrl = new URL(config.authorizationUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("scope", config.scopes.join(" "));
  authUrl.searchParams.set("state", state);

  if (provider === "spotify") {
    authUrl.searchParams.set("show_dialog", "true");
  }

  if (provider === "google_calendar" || provider === "google_fit") {
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("prompt", "consent");
  }

  const response = NextResponse.redirect(authUrl.toString());
  const payload: OAuthStateCookiePayload = {
    state,
    userId,
    provider,
    returnPath,
  };

  logOAuthStart("info", "provider_redirect_issued", {
    provider,
    userId,
    returnPath,
    providerHost: authUrl.hostname,
    callbackUrl,
    statePrefix: state.slice(0, 8),
  });

  response.cookies.set({
    name: `${OAUTH_COOKIE_PREFIX}${provider}`,
    value: Buffer.from(JSON.stringify(payload)).toString("base64url"),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });

  return response;
}
