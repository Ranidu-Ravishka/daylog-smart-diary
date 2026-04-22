import { api } from "@repo/backend/convex";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { adminServerEnv } from "./src/server/env";
import {
  evaluateAdminRateLimit,
  resolveRateLimitIdentity,
} from "./src/server/rateLimit";

const ADMIN_CACHE_COOKIE = "daylog_admin_cache";
const ADMIN_CACHE_TTL_SECONDS = 60;
const ADMIN_CACHE_REFRESH_WINDOW_SECONDS = 15;

type CachedAdminStatus = {
  adminAuthVersion: number;
  expiresAt: number;
};

type AdminCacheState = {
  isAdmin: boolean;
  adminAuthVersion: number;
};

const adminCacheStateQuery =
  "users:getCurrentUserAdminCacheState" as unknown as Parameters<
    ConvexHttpClient["query"]
  >[0];

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/unauthorized",
]);

const isPostAuthRoute = createRouteMatcher(["/auth/callback"]);

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const keyData = new TextEncoder().encode(secret);
  const data = new TextEncoder().encode(payload);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, data);
  return toHex(signature);
}

async function readCachedAdminStatus(
  req: NextRequest,
  userId: string,
  secret: string,
): Promise<CachedAdminStatus | null> {
  const raw = req.cookies.get(ADMIN_CACHE_COOKIE)?.value;
  if (!raw) return null;

  const [cachedUserId, cachedVersionRaw, expiresAtRaw, signature] =
    raw.split(".");
  if (!cachedUserId || !cachedVersionRaw || !expiresAtRaw || !signature) {
    return null;
  }
  if (cachedUserId !== userId) return null;

  const cachedVersion = Number.parseInt(cachedVersionRaw, 10);
  if (!Number.isFinite(cachedVersion) || cachedVersion < 0) return null;

  const expiresAt = Number.parseInt(expiresAtRaw, 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  const payload = `${cachedUserId}.${cachedVersionRaw}.${expiresAtRaw}`;
  const expectedSignature = await signPayload(payload, secret);
  if (signature !== expectedSignature) return null;

  return {
    adminAuthVersion: cachedVersion,
    expiresAt,
  };
}

async function withAdminCacheCookie(
  response: NextResponse,
  userId: string,
  adminAuthVersion: number,
  secret: string,
): Promise<NextResponse> {
  const normalizedVersion = Number.isFinite(adminAuthVersion)
    ? Math.max(0, Math.floor(adminAuthVersion))
    : 0;
  const expiresAt = Date.now() + ADMIN_CACHE_TTL_SECONDS * 1000;
  const payload = `${userId}.${normalizedVersion}.${expiresAt}`;
  const signature = await signPayload(payload, secret);

  response.cookies.set(ADMIN_CACHE_COOKIE, `${payload}.${signature}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: ADMIN_CACHE_TTL_SECONDS,
    path: "/",
  });

  return response;
}

function withClearedAdminCacheCookie(response: NextResponse): NextResponse {
  response.cookies.delete(ADMIN_CACHE_COOKIE);
  return response;
}

function unauthorizedResponse(req: NextRequest): NextResponse {
  return withClearedAdminCacheCookie(
    NextResponse.redirect(new URL("/unauthorized", req.url)),
  );
}

function parseAdminCacheState(value: unknown): AdminCacheState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    isAdmin?: unknown;
    adminAuthVersion?: unknown;
  };

  if (typeof candidate.isAdmin !== "boolean") {
    return null;
  }

  const rawVersion = candidate.adminAuthVersion;
  const adminAuthVersion =
    typeof rawVersion === "number" && Number.isFinite(rawVersion)
      ? Math.max(0, Math.floor(rawVersion))
      : 0;

  return {
    isAdmin: candidate.isAdmin,
    adminAuthVersion,
  };
}

async function fetchAdminCacheState(
  client: ConvexHttpClient,
): Promise<AdminCacheState> {
  try {
    const rawState = await client.query(adminCacheStateQuery, {});
    const parsed = parseAdminCacheState(rawState);
    if (parsed) {
      return parsed;
    }
  } catch {
    // Fall through to legacy boolean query for zero-downtime rollout.
  }

  const legacyIsAdmin = await client.query(api.users.isCurrentUserAdmin, {});
  return {
    isAdmin: legacyIsAdmin === true,
    adminAuthVersion: 0,
  };
}

const handler = clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();
  const rateLimitIdentity = resolveRateLimitIdentity(req, userId ?? undefined);
  const rateLimitDecision = evaluateAdminRateLimit(rateLimitIdentity);
  if (!rateLimitDecision.allowed) {
    return new NextResponse("Too many requests", {
      status: 429,
      headers: {
        "Retry-After": String(rateLimitDecision.retryAfterSeconds),
      },
    });
  }

  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  const { getToken } = await auth();

  if (!userId) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  if (isPostAuthRoute(req)) {
    return withClearedAdminCacheCookie(NextResponse.next());
  }

  const token = await getToken({ template: "convex" });
  if (!token) {
    return unauthorizedResponse(req);
  }

  const cacheSecret = adminServerEnv.adminCacheSecret;
  const cachedAdminStatus = await readCachedAdminStatus(
    req,
    userId,
    cacheSecret,
  );

  const convexUrl = adminServerEnv.convexUrl;

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  let adminState: AdminCacheState;
  try {
    // Strict server verification prevents stale admin access after role changes.
    adminState = await fetchAdminCacheState(client);
  } catch {
    return unauthorizedResponse(req);
  }

  if (!adminState.isAdmin) {
    return unauthorizedResponse(req);
  }

  const shouldRefreshCookie =
    !cachedAdminStatus ||
    cachedAdminStatus.adminAuthVersion !== adminState.adminAuthVersion ||
    cachedAdminStatus.expiresAt - Date.now() <=
      ADMIN_CACHE_REFRESH_WINDOW_SECONDS * 1000;

  if (shouldRefreshCookie) {
    const response = NextResponse.next();
    return await withAdminCacheCookie(
      response,
      userId,
      adminState.adminAuthVersion,
      cacheSecret,
    );
  }

  return NextResponse.next();
});

export async function proxy(req: NextRequest, event: NextFetchEvent) {
  return handler(req, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|map)$).*)",
  ],
};
