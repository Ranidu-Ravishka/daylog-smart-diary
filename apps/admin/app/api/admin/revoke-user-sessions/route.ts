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

type SessionListEntry = {
  id?: string;
};

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

async function revokeActiveSessionsForUser(clerkUserId: string) {
  const client = await clerkClient();
  const sessionIds: string[] = [];

  const pageSize = 100;
  let offset = 0;

  while (true) {
    const page = await client.sessions.getSessionList({
      userId: clerkUserId,
      status: "active",
      limit: pageSize,
      offset,
    });

    const pageData = page.data ?? [];
    for (const entry of pageData as SessionListEntry[]) {
      if (typeof entry.id === "string" && entry.id.length > 0) {
        sessionIds.push(entry.id);
      }
    }

    offset += pageData.length;
    if (offset >= page.totalCount || pageData.length === 0) {
      break;
    }
  }

  const revokeResults = await Promise.allSettled(
    sessionIds.map(async (sessionId) => {
      await client.sessions.revokeSession(sessionId);
    }),
  );

  const revokedSessionCount = revokeResults.filter(
    (result) => result.status === "fulfilled",
  ).length;

  return {
    attemptedSessionCount: sessionIds.length,
    revokedSessionCount,
    failedSessionCount: sessionIds.length - revokedSessionCount,
  };
}

export async function POST(request: Request) {
  const { userId, getToken } = await auth();
  if (!userId) {
    logWarn("admin_revoke_user_sessions_unauthorized", {
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

  const requestBody = (await request.json().catch(() => null)) as {
    clerkUserId?: unknown;
  } | null;

  const targetClerkUserId = parseClerkUserId(requestBody?.clerkUserId);
  if (!targetClerkUserId) {
    logWarn("admin_revoke_user_sessions_invalid_request", {
      status: "invalid_request",
      actorUserId: userId,
    });
    return errorResponse("A valid clerkUserId is required", 400);
  }

  const isSelfTarget = targetClerkUserId === userId;

  if (!isSelfTarget) {
    const token = await getToken({ template: "convex" });
    if (!token) {
      logWarn("admin_revoke_user_sessions_missing_convex_token", {
        status: "unauthorized",
        actorUserId: userId,
        targetClerkUserId,
      });
      return errorResponse("Unauthorized", 401);
    }

    const convexUrl = readConvexUrlFromEnv();
    if (!convexUrl) {
      logWarn("admin_revoke_user_sessions_missing_convex_url", {
        status: "failed",
        actorUserId: userId,
        targetClerkUserId,
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
      logWarn("admin_revoke_user_sessions_forbidden", {
        status: "forbidden",
        actorUserId: userId,
        targetClerkUserId,
      });
      return errorResponse("Forbidden", 403);
    }
  }

  try {
    const result = await revokeActiveSessionsForUser(targetClerkUserId);

    if (result.failedSessionCount > 0) {
      logWarn("admin_revoke_user_sessions_partial_failure", {
        status: "failed",
        actorUserId: userId,
        targetClerkUserId,
        isSelfTarget,
        attemptedSessionCount: result.attemptedSessionCount,
        revokedSessionCount: result.revokedSessionCount,
        failedSessionCount: result.failedSessionCount,
      });
      return errorResponse(
        `Failed to revoke ${result.failedSessionCount} session(s)`,
        502,
      );
    }

    logInfo("admin_revoke_user_sessions_succeeded", {
      status: "succeeded",
      actorUserId: userId,
      targetClerkUserId,
      isSelfTarget,
      attemptedSessionCount: result.attemptedSessionCount,
      revokedSessionCount: result.revokedSessionCount,
      failedSessionCount: result.failedSessionCount,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    captureException("admin_revoke_user_sessions_failed", error, {
      status: "failed",
      actorUserId: userId,
      targetClerkUserId,
      isSelfTarget,
    });
    const message =
      error instanceof Error ? error.message : "Session revocation failed";
    return errorResponse(message, 502);
  }
}
