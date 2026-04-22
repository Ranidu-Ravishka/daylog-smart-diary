import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

import { oauthConnect } from "./oauthConnect";

type HttpHandler = (ctx: unknown, request: Request) => Promise<Response>;

function getHandler(): HttpHandler {
  return (oauthConnect as unknown as { _handler: HttpHandler })._handler;
}

type Identity = {
  subject: string;
  email?: string;
  name?: string;
  pictureUrl?: string;
} | null;

type CtxOptions = {
  identity?: Identity;
  runQuery?: (ref: unknown, args: Record<string, unknown>) => unknown;
  runMutation?: (ref: unknown, args: Record<string, unknown>) => unknown;
};

function buildCtx(opts: CtxOptions = {}) {
  return {
    auth: {
      async getUserIdentity() {
        return opts.identity ?? null;
      },
    },
    runQuery: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      if (opts.runQuery) return opts.runQuery(ref, args);
      return null;
    }),
    runMutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      if (opts.runMutation) return opts.runMutation(ref, args);
      return undefined;
    }),
  } as const;
}

function postBody(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://example.com/oauth-connect", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function matchName(ref: unknown, suffix: string): boolean {
  try {
    return getFunctionName(ref as never).endsWith(suffix);
  } catch {
    return false;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("oauthConnect httpAction", () => {
  describe("payload validation", () => {
    it("returns 400 when body is not JSON-parseable", async () => {
      const ctx = buildCtx();
      const res = await getHandler()(ctx, postBody("{not json"));
      expect(res.status).toBe(400);
      const json = (await res.json()) as { code: string };
      expect(json.code).toBe("invalid_payload");
    });

    it("returns 400 when provider is missing", async () => {
      const ctx = buildCtx({ identity: { subject: "clerk_user_001" } });
      const res = await getHandler()(ctx, postBody({ accessToken: "tok" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when accessToken is missing", async () => {
      const ctx = buildCtx({ identity: { subject: "clerk_user_001" } });
      const res = await getHandler()(
        ctx,
        postBody({ provider: "google_calendar" }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 when scopes is not an array", async () => {
      const ctx = buildCtx({ identity: { subject: "clerk_user_001" } });
      const res = await getHandler()(
        ctx,
        postBody({
          provider: "google_calendar",
          accessToken: "tok",
          scopes: "not-array",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 when scopes contains non-strings", async () => {
      const ctx = buildCtx({ identity: { subject: "clerk_user_001" } });
      const res = await getHandler()(
        ctx,
        postBody({
          provider: "google_calendar",
          accessToken: "tok",
          scopes: ["a", 123],
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 when refreshToken is wrong type", async () => {
      const ctx = buildCtx({ identity: { subject: "clerk_user_001" } });
      const res = await getHandler()(
        ctx,
        postBody({
          provider: "google_calendar",
          accessToken: "tok",
          refreshToken: 42,
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 when accessTokenExpiresAt is not finite", async () => {
      const ctx = buildCtx({ identity: { subject: "clerk_user_001" } });
      const res = await getHandler()(
        ctx,
        postBody({
          provider: "google_calendar",
          accessToken: "tok",
          accessTokenExpiresAt: "soon",
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("clerk identity path", () => {
    it("returns 401 when no identity and no handoff", async () => {
      const ctx = buildCtx({ identity: null });
      const res = await getHandler()(
        ctx,
        postBody({ provider: "google_calendar", accessToken: "tok" }),
      );
      expect(res.status).toBe(401);
    });

    it("persists the integration when identity resolves to existing user", async () => {
      const persist = vi.fn(
        async (_args: Record<string, unknown>) => undefined,
      );
      const ctx = buildCtx({
        identity: { subject: "clerk_user_001" },
        runQuery: async (ref) => {
          if (matchName(ref, ":getUserIdByClerkIdInternal")) {
            return "user_001";
          }
          return null;
        },
        runMutation: async (ref, args) => {
          if (matchName(ref, ":connectIntegrationWithOAuthTokensInternal")) {
            return persist(args);
          }
          return undefined;
        },
      });

      const res = await getHandler()(
        ctx,
        postBody({
          provider: "google_calendar",
          accessToken: "tok",
          refreshToken: "rt",
          scopes: ["s1"],
          accessTokenExpiresAt: 1234,
        }),
      );

      expect(res.status).toBe(204);
      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_001",
          provider: "google_calendar",
          accessToken: "tok",
          refreshToken: "rt",
          scopes: ["s1"],
          accessTokenExpiresAt: 1234,
        }),
      );
    });

    it("provisions a user from JWT claims when Convex user is missing", async () => {
      const persist = vi.fn(
        async (_args: Record<string, unknown>) => undefined,
      );
      const sync = vi.fn(async (_args: Record<string, unknown>) => ({
        _id: "user_new_002",
      }));

      const ctx = buildCtx({
        identity: {
          subject: "clerk_user_002",
          email: "  new@example.com  ",
          name: "Ada Lovelace",
          pictureUrl: "https://img.example.com/a.png",
        },
        runQuery: async (ref) => {
          if (matchName(ref, ":getUserIdByClerkIdInternal")) return null;
          return null;
        },
        runMutation: async (ref, args) => {
          if (matchName(ref, ":syncUserFromClerkWebhook")) {
            return sync(args);
          }
          if (matchName(ref, ":connectIntegrationWithOAuthTokensInternal")) {
            return persist(args);
          }
          return undefined;
        },
      });

      const res = await getHandler()(
        ctx,
        postBody({ provider: "google_calendar", accessToken: "tok" }),
      );

      expect(res.status).toBe(204);
      expect(sync).toHaveBeenCalledWith(
        expect.objectContaining({
          clerkUserId: "clerk_user_002",
          email: "new@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
          imageUrl: "https://img.example.com/a.png",
        }),
      );
      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user_new_002" }),
      );
    });

    it("falls back to the `picture` claim when `pictureUrl` is absent", async () => {
      const sync = vi.fn(async (_args: Record<string, unknown>) => ({
        _id: "user_new_003",
      }));
      const persist = vi.fn(
        async (_args: Record<string, unknown>) => undefined,
      );

      const ctx = buildCtx({
        identity: {
          subject: "clerk_user_003",
          email: "x@example.com",
          name: "Solo",
          // `picture` rather than `pictureUrl`
          picture: "https://img.example.com/b.png",
        } as unknown as Identity,
        runQuery: async (ref) =>
          matchName(ref, ":getUserIdByClerkIdInternal") ? null : null,
        runMutation: async (ref, args) => {
          if (matchName(ref, ":syncUserFromClerkWebhook")) return sync(args);
          if (matchName(ref, ":connectIntegrationWithOAuthTokensInternal"))
            return persist(args);
          return undefined;
        },
      });

      const res = await getHandler()(
        ctx,
        postBody({ provider: "google_calendar", accessToken: "tok" }),
      );
      expect(res.status).toBe(204);
      expect(sync).toHaveBeenCalledWith(
        expect.objectContaining({
          imageUrl: "https://img.example.com/b.png",
          firstName: "Solo",
          lastName: undefined,
        }),
      );
    });

    it("returns 422 when Convex user is missing and no email claim is present", async () => {
      const ctx = buildCtx({
        identity: { subject: "clerk_user_004" }, // no email
        runQuery: async (ref) =>
          matchName(ref, ":getUserIdByClerkIdInternal") ? null : null,
      });

      const res = await getHandler()(
        ctx,
        postBody({ provider: "google_calendar", accessToken: "tok" }),
      );
      expect(res.status).toBe(422);
      const json = (await res.json()) as { code: string };
      expect(json.code).toBe("convex_user_missing_no_email");
    });

    it("returns 409 when user provisioning throws", async () => {
      const ctx = buildCtx({
        identity: {
          subject: "clerk_user_005",
          email: "boom@example.com",
        },
        runQuery: async (ref) =>
          matchName(ref, ":getUserIdByClerkIdInternal") ? null : null,
        runMutation: async (ref) => {
          if (matchName(ref, ":syncUserFromClerkWebhook")) {
            throw new Error("clerk sync unavailable");
          }
          return undefined;
        },
      });

      const res = await getHandler()(
        ctx,
        postBody({ provider: "google_calendar", accessToken: "tok" }),
      );
      expect(res.status).toBe(409);
      const json = (await res.json()) as { code: string; message: string };
      expect(json.code).toBe("convex_user_sync_failed");
      expect(json.message).toContain("clerk sync unavailable");
    });

    it("returns 422 when sync returns no user row", async () => {
      const ctx = buildCtx({
        identity: {
          subject: "clerk_user_006",
          email: "zero@example.com",
        },
        runQuery: async (ref) =>
          matchName(ref, ":getUserIdByClerkIdInternal") ? null : null,
        runMutation: async (ref) => {
          if (matchName(ref, ":syncUserFromClerkWebhook")) return null;
          return undefined;
        },
      });

      const res = await getHandler()(
        ctx,
        postBody({ provider: "google_calendar", accessToken: "tok" }),
      );
      expect(res.status).toBe(422);
      const json = (await res.json()) as { code: string };
      expect(json.code).toBe("convex_user_unresolved");
    });
  });

  describe("mobile handoff path", () => {
    it("resolves identity via X-Mobile-Handoff header and persists", async () => {
      const persist = vi.fn(
        async (_args: Record<string, unknown>) => undefined,
      );

      const ctx = buildCtx({
        identity: null, // no Clerk session
        runMutation: async (ref, args) => {
          if (matchName(ref, ":consumeOAuthMobileHandoffInternal")) {
            return {
              userId: "user_mobile_001",
              provider: "google_calendar",
            };
          }
          if (matchName(ref, ":connectIntegrationWithOAuthTokensInternal")) {
            return persist(args);
          }
          return undefined;
        },
      });

      const res = await getHandler()(
        ctx,
        postBody(
          { provider: "google_calendar", accessToken: "tok" },
          { "x-mobile-handoff": "abcd1234handoffcode" },
        ),
      );

      expect(res.status).toBe(204);
      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_mobile_001",
          provider: "google_calendar",
        }),
      );
    });

    it("returns 401 when handoff is invalid (consume returns null)", async () => {
      const ctx = buildCtx({
        identity: null,
        runMutation: async (ref) => {
          if (matchName(ref, ":consumeOAuthMobileHandoffInternal")) {
            return null;
          }
          return undefined;
        },
      });

      const res = await getHandler()(
        ctx,
        postBody(
          { provider: "google_calendar", accessToken: "tok" },
          { "x-mobile-handoff": "expiredcode" },
        ),
      );
      expect(res.status).toBe(401);
      const json = (await res.json()) as { code: string };
      expect(json.code).toBe("mobile_handoff_invalid");
    });

    it("returns 409 when handoff was issued for a different provider", async () => {
      const ctx = buildCtx({
        identity: null,
        runMutation: async (ref) => {
          if (matchName(ref, ":consumeOAuthMobileHandoffInternal")) {
            return { userId: "user_mobile_002", provider: "spotify" };
          }
          return undefined;
        },
      });

      const res = await getHandler()(
        ctx,
        postBody(
          { provider: "google_calendar", accessToken: "tok" },
          { "x-mobile-handoff": "mismatchcode" },
        ),
      );
      expect(res.status).toBe(409);
      const json = (await res.json()) as { code: string; message: string };
      expect(json.code).toBe("mobile_handoff_provider_mismatch");
      expect(json.message).toContain("spotify");
      expect(json.message).toContain("google_calendar");
    });

    it("trims whitespace-only handoff headers and falls back to Clerk", async () => {
      const persist = vi.fn(
        async (_args: Record<string, unknown>) => undefined,
      );
      const ctx = buildCtx({
        identity: { subject: "clerk_user_007" },
        runQuery: async (ref) =>
          matchName(ref, ":getUserIdByClerkIdInternal") ? "user_007" : null,
        runMutation: async (ref, args) => {
          if (matchName(ref, ":connectIntegrationWithOAuthTokensInternal")) {
            return persist(args);
          }
          return undefined;
        },
      });

      const res = await getHandler()(
        ctx,
        postBody(
          { provider: "google_calendar", accessToken: "tok" },
          { "x-mobile-handoff": "   " },
        ),
      );
      expect(res.status).toBe(204);
      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user_007" }),
      );
    });
  });

  describe("persist failure handling", () => {
    it("returns 500 when the persist mutation throws", async () => {
      const ctx = buildCtx({
        identity: { subject: "clerk_user_008" },
        runQuery: async (ref) =>
          matchName(ref, ":getUserIdByClerkIdInternal") ? "user_008" : null,
        runMutation: async (ref) => {
          if (matchName(ref, ":connectIntegrationWithOAuthTokensInternal")) {
            throw new Error("storage down");
          }
          return undefined;
        },
      });

      const res = await getHandler()(
        ctx,
        postBody({ provider: "google_calendar", accessToken: "tok" }),
      );
      expect(res.status).toBe(500);
      const json = (await res.json()) as { code: string; message: string };
      expect(json.code).toBe("persist_failed");
      expect(json.message).toContain("storage down");
    });
  });
});
