import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import {
  getCurrentUser,
  requireUser,
  requireAdmin,
  requireIdentityMatch,
} from "./authz";
import { convexServerEnv } from "./env";
import { deleteUserCascadeData } from "./cascadeCleanup";
import { applyDashboardMetricsDelta } from "./dashboardMetrics";

// ── Sync a user row from Clerk (called by the client after sign-in).
//    Identity must match the clerkUserId arg.
export const syncUserFromClerk = mutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireIdentityMatch(ctx, args.clerkUserId);

    return await syncUserRecord(ctx, args);
  },
});

// ── Internal mutation for the Clerk webhook path.
//    Only callable from server actions (httpAction), never from clients.
export const syncUserFromClerkWebhook = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await syncUserRecord(ctx, args);
  },
});

// ── Shared logic for syncing a user record from Clerk data.
async function syncUserRecord(
  ctx: Pick<MutationCtx, "db">,
  args: {
    clerkUserId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    imageUrl?: string;
  },
) {
  const existing = await ctx.db
    .query("user")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      imageUrl: args.imageUrl,
    });

    return await ctx.db.get(existing._id);
  }

  const id = await ctx.db.insert("user", {
    clerkUserId: args.clerkUserId,
    email: args.email,
    firstName: args.firstName,
    lastName: args.lastName,
    imageUrl: args.imageUrl,
    planTier: "free",
    isAdmin: false,
  });

  await applyDashboardMetricsDelta(ctx.db, {
    totalUsers: 1,
  });

  return await ctx.db.get(id);
}

// ── Check whether the currently signed-in user is an admin
export const isCurrentUserAdmin = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user?.isAdmin === true;
  },
});

// ── Get a user by Clerk ID (admin-only)
export const getUserByClerkId = query({
  args: {
    clerkUserId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    return await ctx.db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();
  },
});

// ── List all users (admin-only)
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("user").collect();
  },
});

// ── Bootstrap: first-time admin setup via env-allowed Clerk IDs
function getBootstrapAdminIds(): string[] {
  return convexServerEnv.adminBootstrapClerkUserIds;
}

export const bootstrapMakeMeAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    // requireUser validates identity + user row existence
    const user = await requireUser(ctx);

    const bootstrapIds = getBootstrapAdminIds();
    if (bootstrapIds.length === 0 || !bootstrapIds.includes(user.clerkUserId)) {
      throw new Error("Forbidden: not in bootstrap admin list");
    }

    await ctx.db.patch(user._id, { isAdmin: true });
    return { success: true };
  },
});

// ── Set admin status for any user (admin-only)
export const setUserAdminStatus = mutation({
  args: {
    clerkUserId: v.string(),
    isAdmin: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const targetUser = await ctx.db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    if (!targetUser) {
      throw new Error("User not found");
    }

    await ctx.db.patch(targetUser._id, { isAdmin: args.isAdmin });
    return { success: true };
  },
});

// ── Internal mutation for account deletion from Clerk webhook.
//    Idempotent: succeeds even if user already removed.
export const deleteUserAndRelatedDataByClerkId = internalMutation({
  args: {
    clerkUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    if (!user) {
      return { success: true, deleted: false };
    }

    const deleted = await deleteUserCascadeData(ctx, {
      userId: user._id,
      clerkUserId: user.clerkUserId,
    });

    await ctx.db.delete(user._id);

    await applyDashboardMetricsDelta(ctx.db, {
      totalUsers: -1,
      totalMemories: -deleted.deletedMemories,
      totalDays: -deleted.deletedDays,
      totalSummaries: -deleted.deletedSummaries,
      totalIntegrations: -deleted.deletedIntegrations,
      totalPreferences: -deleted.deletedPreferences,
      totalAuditLogs: -deleted.deletedAuditLogs,
    });

    return { success: true, deleted: true };
  },
});
