import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertIntegrationProvider } from "./integrationProviders";
import { captureException, logInfo, logWarn } from "./observability";
import type { Id } from "./_generated/dataModel";

function splitOptionalName(name: string | undefined): {
  firstName?: string;
  lastName?: string;
} {
  if (!name || typeof name !== "string") {
    return {};
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return {};
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0] };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

type OAuthConnectRequest = {
  provider: string;
  scopes?: string[];
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
};

function parseOAuthConnectRequest(body: unknown): OAuthConnectRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid OAuth connect request payload.");
  }

  const payload = body as Record<string, unknown>;
  const provider = payload.provider;
  const accessToken = payload.accessToken;
  const scopes = payload.scopes;
  const refreshToken = payload.refreshToken;
  const accessTokenExpiresAt = payload.accessTokenExpiresAt;

  if (typeof provider !== "string" || provider.trim().length === 0) {
    throw new Error("OAuth provider is required.");
  }

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throw new Error("OAuth access token is required.");
  }

  if (scopes !== undefined && !Array.isArray(scopes)) {
    throw new Error("OAuth scopes must be an array of strings.");
  }

  if (
    Array.isArray(scopes) &&
    scopes.some((scope) => typeof scope !== "string")
  ) {
    throw new Error("OAuth scopes must only contain strings.");
  }

  if (refreshToken !== undefined && typeof refreshToken !== "string") {
    throw new Error("OAuth refresh token must be a string.");
  }

  if (
    accessTokenExpiresAt !== undefined &&
    (typeof accessTokenExpiresAt !== "number" ||
      !Number.isFinite(accessTokenExpiresAt))
  ) {
    throw new Error("OAuth token expiration must be a finite number.");
  }

  return {
    provider,
    scopes: scopes as string[] | undefined,
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
  };
}

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const oauthConnect = httpAction(async (ctx, request) => {
  // The mobile handoff header carries a one-time code minted by an
  // authenticated mobile user. It takes priority over the ambient Clerk
  // session on the web because the in-app browser used for OAuth on mobile
  // does not share cookies with the mobile Clerk SecureStore — so resolving
  // identity from `ctx.auth` would pick a *different* (or missing) account.
  const mobileHandoffCode = request.headers.get("x-mobile-handoff")?.trim();

  let body: OAuthConnectRequest;
  try {
    body = parseOAuthConnectRequest(await request.json());
  } catch (parseError) {
    const message =
      parseError instanceof Error ? parseError.message : "parse_failed";
    logWarn("oauth_connect.invalid_payload", {
      area: "oauth_connect",
      authMode: mobileHandoffCode ? "mobile_handoff" : "clerk",
      errorMessage: message,
    });
    return jsonError("invalid_payload", message, 400);
  }

  const provider = assertIntegrationProvider(body.provider);
  let userId: Id<"user"> | null = null;
  let authMode: "mobile_handoff" | "clerk" = "clerk";

  if (mobileHandoffCode) {
    authMode = "mobile_handoff";
    const handoff = await ctx.runMutation(
      internal.integrations.consumeOAuthMobileHandoffInternal,
      { code: mobileHandoffCode },
    );
    if (!handoff) {
      logWarn("oauth_connect.handoff_invalid", {
        area: "oauth_connect",
        codePrefix: mobileHandoffCode.slice(0, 8),
        provider,
      });
      return jsonError(
        "mobile_handoff_invalid",
        "Mobile OAuth handoff is invalid, expired, or already used. Restart the connection from the mobile app.",
        401,
      );
    }
    if (handoff.provider !== provider) {
      logWarn("oauth_connect.handoff_provider_mismatch", {
        area: "oauth_connect",
        codePrefix: mobileHandoffCode.slice(0, 8),
        handoffProvider: handoff.provider,
        requestedProvider: provider,
      });
      return jsonError(
        "mobile_handoff_provider_mismatch",
        `Mobile OAuth handoff was issued for "${handoff.provider}" but the callback is for "${provider}".`,
        409,
      );
    }
    userId = handoff.userId;
    logInfo("oauth_connect.received_via_handoff", {
      area: "oauth_connect",
      userId,
      provider,
      hasAccessToken: Boolean(body.accessToken),
      hasRefreshToken: Boolean(body.refreshToken),
      scopesCount: body.scopes?.length ?? 0,
    });
  } else {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      logWarn("oauth_connect.unauthorized", {
        area: "oauth_connect",
        reason: "no_identity_no_handoff",
      });
      return new Response("Unauthorized", { status: 401 });
    }

    logInfo("oauth_connect.received_via_clerk", {
      area: "oauth_connect",
      clerkUserId: identity.subject,
      provider,
      hasAccessToken: Boolean(body.accessToken),
      hasRefreshToken: Boolean(body.refreshToken),
      scopesCount: body.scopes?.length ?? 0,
    });

    userId = await ctx.runQuery(internal.users.getUserIdByClerkIdInternal, {
      clerkUserId: identity.subject,
    });

    // OAuth often completes before the Clerk→Convex webhook creates `user`.
    // Provision from JWT claims (same payload as webhook sync) instead of 404.
    if (!userId) {
      const id = identity as {
        email?: string;
        name?: string;
        pictureUrl?: string;
        picture?: string;
      };
      const email =
        typeof id.email === "string" && id.email.trim().length > 0
          ? id.email.trim()
          : null;

      if (!email) {
        return jsonError(
          "convex_user_missing_no_email",
          "No Convex user row yet and the auth token has no email claim. Ensure the Clerk JWT template for Convex includes email, or open the app once after sign-in.",
          422,
        );
      }

      const { firstName, lastName } = splitOptionalName(id.name);
      const imageUrl =
        typeof id.pictureUrl === "string" && id.pictureUrl.trim().length > 0
          ? id.pictureUrl.trim()
          : typeof id.picture === "string" && id.picture.trim().length > 0
            ? id.picture.trim()
            : undefined;

      try {
        const user = await ctx.runMutation(
          internal.users.syncUserFromClerkWebhook,
          {
            clerkUserId: identity.subject,
            email,
            firstName,
            lastName,
            imageUrl,
          },
        );
        userId = user?._id ?? null;
      } catch (syncError) {
        const message =
          syncError instanceof Error ? syncError.message : "user_sync_failed";
        return jsonError("convex_user_sync_failed", message, 409);
      }
    }
  }

  if (!userId) {
    return jsonError(
      "convex_user_unresolved",
      "Could not resolve Convex user after sync.",
      422,
    );
  }

  try {
    await ctx.runMutation(
      internal.integrations.connectIntegrationWithOAuthTokensInternal,
      {
        userId,
        provider,
        scopes: body.scopes,
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        accessTokenExpiresAt: body.accessTokenExpiresAt,
      },
    );
  } catch (persistError) {
    const message =
      persistError instanceof Error ? persistError.message : "persist_failed";
    captureException("oauth_connect.persist_failed", persistError, {
      area: "oauth_connect",
      authMode,
      userId,
      provider,
    });
    return jsonError("persist_failed", message, 500);
  }

  logInfo("oauth_connect.persisted", {
    area: "oauth_connect",
    authMode,
    userId,
    provider,
  });

  return new Response(null, { status: 204 });
});
