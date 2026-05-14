import { api } from "@repo/backend/convex";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { captureException, logInfo, logWarn } from "@/lib/observability";
import {
  evaluateAdminRateLimit,
  resolveRateLimitIdentity,
} from "@/server/rateLimit";

export const runtime = "nodejs";

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

function parseClerkUserId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readConvexUrlFromEnv(): string | null {
  const rawValue = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!rawValue) {
    return null;
  }

  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const { userId, getToken } = await auth();
  if (!userId) {
    logWarn("admin_delete_clerk_user_unauthorized", {
      status: "unauthorized",
    });
    return errorResponse("Unauthorized", 401);
  }

  const rateLimitDecision = evaluateAdminRateLimit(
    resolveRateLimitIdentity(request, userId),
  );
  if (!rateLimitDecision.allowed) {
    return errorResponse("Too many requests", 429);
  }

  const body = await request.json().catch(() => null);
  const targetClerkUserId = parseClerkUserId(
    body && typeof body === "object"
      ? (body as { clerkUserId?: unknown }).clerkUserId
      : null,
  );

  if (!targetClerkUserId) {
    logWarn("admin_delete_clerk_user_invalid_request", {
      status: "invalid_request",
      actorUserId: userId,
    });
    return errorResponse("A valid clerkUserId is required", 400);
  }

  if (targetClerkUserId === userId) {
    logWarn("admin_delete_clerk_user_self_target_denied", {
      status: "forbidden",
      actorUserId: userId,
    });
    return errorResponse(
      "You cannot delete your own Clerk account from here",
      403,
    );
  }

  const token = await getToken({ template: "convex" });
  if (!token) {
    logWarn("admin_delete_clerk_user_missing_convex_token", {
      status: "unauthorized",
      actorUserId: userId,
    });
    return errorResponse("Unauthorized", 401);
  }

  const convexUrl = readConvexUrlFromEnv();
  if (!convexUrl) {
    logWarn("admin_delete_clerk_user_missing_convex_url", {
      status: "failed",
      actorUserId: userId,
    });
    return errorResponse(
      "Server configuration is missing NEXT_PUBLIC_CONVEX_URL",
      500,
    );
  }

  const convexClient = new ConvexHttpClient(convexUrl);
  convexClient.setAuth(token);

  const adminState = await convexClient.query(
    api.users.getCurrentUserAdminCacheState,
    {},
  );

  if (!adminState.isAdmin) {
    logWarn("admin_delete_clerk_user_forbidden", {
      status: "forbidden",
      actorUserId: userId,
      targetClerkUserId,
    });
    return errorResponse("Forbidden", 403);
  }

  try {
    const client = await clerkClient();
    try {
      await client.users.deleteUser(targetClerkUserId);
    } catch (error: unknown) {
      const clerkErr = error as {
        status?: number;
        errors?: { code?: string }[];
      };
      const isNotFound =
        clerkErr.status === 404 ||
        clerkErr.errors?.some((entry) => entry.code === "resource_not_found");

      if (!isNotFound) {
        throw error;
      }

      logInfo("admin_delete_clerk_user_already_absent", {
        status: "succeeded",
        actorUserId: userId,
        targetClerkUserId,
      });

      return NextResponse.json({
        success: true,
        deleted: false,
        clerkUserAlreadyRemoved: true,
      });
    }

    logInfo("admin_delete_clerk_user_succeeded", {
      status: "succeeded",
      actorUserId: userId,
      targetClerkUserId,
    });

    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    captureException("admin_delete_clerk_user_failed", error, {
      status: "failed",
      actorUserId: userId,
      targetClerkUserId,
    });
    const message =
      error instanceof Error ? error.message : "Failed to delete Clerk user";
    return errorResponse(message, 502);
  }
}
