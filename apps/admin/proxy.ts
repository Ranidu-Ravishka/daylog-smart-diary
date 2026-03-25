import { api } from "@repo/backend/convex";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { adminServerEnv } from "./src/server/env";

const ADMIN_CACHE_COOKIE = "daylog_admin_cache";
const ADMIN_CACHE_TTL_SECONDS = 60 * 5;

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
): Promise<boolean> {
  const raw = req.cookies.get(ADMIN_CACHE_COOKIE)?.value;
  if (!raw) return false;

  const [cachedUserId, expiresAtRaw, signature] = raw.split(".");
  if (!cachedUserId || !expiresAtRaw || !signature) return false;
  if (cachedUserId !== userId) return false;

  const expiresAt = Number.parseInt(expiresAtRaw, 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  const payload = `${cachedUserId}.${expiresAtRaw}`;
  const expectedSignature = await signPayload(payload, secret);
  return signature === expectedSignature;
}

async function withAdminCacheCookie(
  response: NextResponse,
  userId: string,
  secret: string,
): Promise<NextResponse> {
  const expiresAt = Date.now() + ADMIN_CACHE_TTL_SECONDS * 1000;
  const payload = `${userId}.${expiresAt}`;
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

const handler = clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  const { userId, getToken } = await auth();

  if (!userId) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  if (isPostAuthRoute(req)) {
    return NextResponse.next();
  }

  const cacheSecret = adminServerEnv.adminCacheSecret;
  const hasCachedAdminStatus = await readCachedAdminStatus(
    req,
    userId,
    cacheSecret,
  );
  if (hasCachedAdminStatus) {
    return NextResponse.next();
  }

  const convexUrl = adminServerEnv.convexUrl;

  const token = await getToken({ template: "convex" });
  if (!token) {
    return NextResponse.redirect(new URL("/unauthorized", req.url));
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  const isAdmin = await client.query(api.users.isCurrentUserAdmin, {});
  if (isAdmin) {
    const response = NextResponse.next();
    return await withAdminCacheCookie(response, userId, cacheSecret);
  }

  const denied = NextResponse.redirect(new URL("/unauthorized", req.url));
  denied.cookies.delete(ADMIN_CACHE_COOKIE);

  return denied;
});

export async function proxy(req: NextRequest, event: NextFetchEvent) {
  return handler(req, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|map)$).*)",
  ],
};
