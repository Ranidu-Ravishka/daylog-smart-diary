import { randomUUID } from "crypto";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  getAppBaseUrl,
  getOAuthProviderConfig,
  isOAuthProvider,
  safeReturnPath,
} from "@/lib/integrations-oauth";
import { logInfo, logWarn } from "@/lib/observability";
import {
  getIntegrationProviderDefinition,
  isIntegrationProviderComingSoon,
} from "@repo/user-settings/lib/integration-provider-catalog";

const OAUTH_COOKIE_PREFIX = "daylog_oauth_state_";

type OAuthStateCookiePayload = {
  state: string;
  // `userId` is the *web* Clerk userId that started the flow. It is null
  // when the flow was initiated by the mobile app (which authenticates via
  // a server-brokered handoff code instead of a web Clerk session).
  userId: string | null;
  provider: string;
  returnPath: string;
  // Opaque one-time code minted by the mobile app's authenticated Convex
  // session. When present, the callback uses it to identify the Convex user
  // on integration persist instead of relying on the web Clerk session.
  mobileHandoff?: string;
};

// Basic shape check for the opaque 32-byte hex code minted by Convex.
function isValidMobileHandoffFormat(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export const runtime = "nodejs";

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
  const rawMobileHandoff = request.nextUrl.searchParams
    .get("mobileHandoff")
    ?.trim();
  const mobileHandoff =
    rawMobileHandoff && isValidMobileHandoffFormat(rawMobileHandoff)
      ? rawMobileHandoff
      : undefined;

  // When a valid mobile handoff is provided, the flow is authenticated by
  // the Convex-issued handoff code rather than a web Clerk session. This is
  // critical for Expo's `WebBrowser.openAuthSessionAsync`, whose in-app
  // browser has an isolated cookie jar that cannot carry the mobile user's
  // Clerk identity. Without this path the web callback would persist the
  // integration onto whatever (stale/different) Clerk session happens to
  // exist in the browser, not the mobile user.
  let webClerkUserId: string | null = null;
  if (mobileHandoff) {
    logInfo("oauth_start_mobile_handoff_accepted", {
      area: "oauth_start",
      provider,
      returnPath,
      codePrefix: mobileHandoff.slice(0, 8),
    });
  } else {
    const { userId } = await auth();
    if (!userId) {
      logWarn("oauth_start_unauthenticated_redirect", {
        area: "oauth_start",
        provider,
        returnPath,
      });
      return NextResponse.redirect(new URL("/sign-in", request.url));
    }
    webClerkUserId = userId;
  }

  // Alias kept so the existing log and error-path statements below continue
  // to report a stable correlation id even when `webClerkUserId` is null.
  const userId = webClerkUserId ?? "mobile_handoff";

  if (isIntegrationProviderComingSoon(provider)) {
    const definition = getIntegrationProviderDefinition(provider);
    const redirectUrl = buildResultRedirect(
      request,
      provider,
      "error",
      definition?.helperText ?? "This integration is coming soon.",
      returnPath,
    );

    logInfo("oauth_start_coming_soon_provider", {
      area: "oauth_start",
      provider,
      returnPath,
      userId,
      redirectTo: `${redirectUrl.pathname}${redirectUrl.search}`,
    });

    return NextResponse.redirect(redirectUrl);
  }

  if (!isOAuthProvider(provider)) {
    const redirectUrl = buildResultRedirect(
      request,
      provider,
      "error",
      "Unsupported OAuth provider.",
      returnPath,
    );

    logWarn("oauth_start_unsupported_provider", {
      area: "oauth_start",
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

    logWarn("oauth_start_missing_provider_credentials", {
      area: "oauth_start",
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

  logInfo("oauth_start_request_received", {
    area: "oauth_start",
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
  authUrl.searchParams.set("state", state);

  if (config.scopes.length > 0) {
    authUrl.searchParams.set("scope", config.scopes.join(" "));
  }

  for (const [key, value] of Object.entries(config.authQueryParams ?? {})) {
    authUrl.searchParams.set(key, value);
  }

  const response = NextResponse.redirect(authUrl.toString());
  const payload: OAuthStateCookiePayload = {
    state,
    userId: webClerkUserId,
    provider,
    returnPath,
    mobileHandoff,
  };

  logInfo("oauth_start_provider_redirect_issued", {
    area: "oauth_start",
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
