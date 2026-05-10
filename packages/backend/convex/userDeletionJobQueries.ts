import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type UserDeletionJobReadCtx = Pick<QueryCtx | MutationCtx, "db">;

export async function findLatestUserDeletionJobByUserId(
  ctx: UserDeletionJobReadCtx,
  userId: Id<"user">,
): Promise<Doc<"userDeletionJobs"> | null> {
  const processing = await ctx.db
    .query("userDeletionJobs")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "processing"),
    )
    .order("desc")
    .take(1);
  if (processing[0]) return processing[0];

  const requested = await ctx.db
    .query("userDeletionJobs")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "requested"),
    )
    .order("desc")
    .take(1);
  if (requested[0]) return requested[0];

  const completed = await ctx.db
    .query("userDeletionJobs")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "completed"),
    )
    .order("desc")
    .take(1);

  const failed = await ctx.db
    .query("userDeletionJobs")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "failed"),
    )
    .order("desc")
    .take(1);

  const latestCompleted = completed[0] ?? null;
  const latestFailed = failed[0] ?? null;

  if (!latestCompleted) {
    return latestFailed;
  }

  if (!latestFailed) {
    return latestCompleted;
  }

  return latestCompleted.updatedAt >= latestFailed.updatedAt
    ? latestCompleted
    : latestFailed;
}

export async function findLatestUserDeletionJobByClerkUserId(
  ctx: UserDeletionJobReadCtx,
  clerkUserId: string,
): Promise<Doc<"userDeletionJobs"> | null> {
  const [processing, requested, completed, failed] = await Promise.all([
    ctx.db
      .query("userDeletionJobs")
      .withIndex("by_clerk_status", (q) =>
        q.eq("clerkUserId", clerkUserId).eq("status", "processing"),
      )
      .order("desc")
      .take(1),
    ctx.db
      .query("userDeletionJobs")
      .withIndex("by_clerk_status", (q) =>
        q.eq("clerkUserId", clerkUserId).eq("status", "requested"),
      )
      .order("desc")
      .take(1),
    ctx.db
      .query("userDeletionJobs")
      .withIndex("by_clerk_status", (q) =>
        q.eq("clerkUserId", clerkUserId).eq("status", "completed"),
      )
      .order("desc")
      .take(1),
    ctx.db
      .query("userDeletionJobs")
      .withIndex("by_clerk_status", (q) =>
        q.eq("clerkUserId", clerkUserId).eq("status", "failed"),
      )
      .order("desc")
      .take(1),
  ]);

  if (processing[0]) {
    return processing[0];
  }

  if (requested[0]) {
    return requested[0];
  }

  const latestCompleted = completed[0] ?? null;
  const latestFailed = failed[0] ?? null;

  if (!latestCompleted) {
    return latestFailed;
  }

  if (!latestFailed) {
    return latestCompleted;
  }

  return latestCompleted.updatedAt >= latestFailed.updatedAt
    ? latestCompleted
    : latestFailed;
}
