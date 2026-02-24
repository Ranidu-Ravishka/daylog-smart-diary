import { api } from "@repo/backend/convex";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/unauthorized",
]);

const isPostAuthRoute = createRouteMatcher(["/auth/callback"]);

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

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.redirect(new URL("/unauthorized", req.url));
  }

  const token = await getToken({ template: "convex" });
  if (!token) {
    return NextResponse.redirect(new URL("/unauthorized", req.url));
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  const isAdmin = await client.query(api.users.isCurrentUserAdmin, {});
  if (isAdmin) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/unauthorized", req.url));
});

export async function middleware(req: NextRequest, event: NextFetchEvent) {
  return handler(req, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|map)$).*)",
  ],
};
