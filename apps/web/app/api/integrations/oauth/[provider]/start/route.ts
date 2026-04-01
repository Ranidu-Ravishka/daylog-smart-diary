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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const params = await context.params;
  const provider = params.provider;
  if (!isOAuthProvider(provider)) {
    return NextResponse.json(
      { error: "Unsupported OAuth provider" },
      { status: 400 },
    );
  }

  const config = getOAuthProviderConfig(provider);
  if (!config.clientId || !config.clientSecret) {
    return NextResponse.redirect(
      new URL(
        `/dashboard/settings?integrationProvider=${provider}&integrationStatus=error&integrationMessage=${encodeURIComponent("OAuth is not configured for this provider.")}`,
        request.url,
      ),
    );
  }

  const appBaseUrl = getAppBaseUrl(request.nextUrl.origin);
  const returnPath = safeReturnPath(
    request.nextUrl.searchParams.get("returnTo"),
  );
  const callbackUrl = `${appBaseUrl}/api/integrations/oauth/${provider}/callback`;
  const state = randomUUID();

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
