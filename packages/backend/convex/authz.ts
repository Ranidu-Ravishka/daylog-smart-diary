import { GenericQueryCtx } from "convex/server";

export async function requireAdmin(ctx: GenericQueryCtx<any>): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }

  const user = await ctx.db
    .query("user")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject))
    .unique();

  if (!user?.isAdmin) {
    throw new Error("Forbidden");
  }
}
