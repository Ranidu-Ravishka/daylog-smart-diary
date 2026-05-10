import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx, MutationCtx } from "./_generated/server";
import { findLatestUserDeletionJobByUserId } from "./userDeletionJobQueries";

// ────────────────────────────────────────────────────────────
// Shared auth context type (QueryCtx is a subset of MutationCtx,
// so anything accepting QueryCtx also works inside mutations).
// ────────────────────────────────────────────────────────────
type AuthCtx = QueryCtx | MutationCtx;

// ────────────────────────────────────────────────────────────
// 1. getCurrentUser — returns user row or null (never throws)
// ────────────────────────────────────────────────────────────
export async function getCurrentUser(
  ctx: AuthCtx,
): Promise<Doc<"user"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  return await ctx.db
    .query("user")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject))
    .unique();
}

// ────────────────────────────────────────────────────────────
// 2. requireUser — returns user row or throws Unauthorized
// ────────────────────────────────────────────────────────────
export async function requireUser(ctx: AuthCtx): Promise<Doc<"user">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized: not signed in");
  }

  const user = await ctx.db
    .query("user")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject))
    .unique();

  if (!user) {
    throw new Error(
      "Unauthorized: user record not found — sign in once to create it",
    );
  }

  if (typeof user.accountBackendPurgedAt === "number") {
    throw new Error(
      "Unauthorized: account backend data was removed — finalize sign-out in Settings",
    );
  }

  if (user.accountStatus === "deletion_requested") {
    throw new Error("Unauthorized: account deletion in progress");
  }

  const latestDeletionJob = await findLatestUserDeletionJobByUserId(
    ctx,
    user._id,
  );
  if (
    latestDeletionJob?.status === "requested" ||
    latestDeletionJob?.status === "processing"
  ) {
    throw new Error("Unauthorized: account deletion in progress");
  }

  return user;
}

// ────────────────────────────────────────────────────────────
// 3. requireAdmin — returns admin user row or throws Forbidden
// ────────────────────────────────────────────────────────────
export async function requireAdmin(ctx: AuthCtx): Promise<Doc<"user">> {
  const user = await requireUser(ctx);

  if (!user.isAdmin) {
    throw new Error("Forbidden: admin access required");
  }

  return user;
}

// ────────────────────────────────────────────────────────────
// 4. requireOwnership — throws Forbidden if the resource
//    does not belong to the authenticated user.
//    Pass the `userId` field from the resource row.
// ────────────────────────────────────────────────────────────
export function requireOwnership(
  user: Doc<"user">,
  resourceOwnerId: Id<"user">,
): void {
  if (user._id !== resourceOwnerId) {
    throw new Error("Forbidden: you do not own this resource");
  }
}

// ────────────────────────────────────────────────────────────
// 5. requireIdentityMatch — lightweight check that the
//    caller's Clerk subject matches a given clerkUserId,
//    useful for mutations that accept clerkUserId as an arg
//    (e.g., syncUserFromClerk called from the webhook path).
// ────────────────────────────────────────────────────────────
export async function requireIdentityMatch(
  ctx: AuthCtx,
  clerkUserId: string,
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized: not signed in");
  }
  if (identity.subject !== clerkUserId) {
    throw new Error("Forbidden: identity mismatch");
  }
}
