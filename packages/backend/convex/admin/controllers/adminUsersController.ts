import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { applyDashboardMetricsDelta } from "../../dashboardMetrics";
import { buildAdminRoleStatePatch } from "../utilities/adminUserPatch";
import { logAdminAction } from "../services/adminAuditService";

export async function adminCreateUserController(
  ctx: MutationCtx,
  args: {
    clerkUserId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    isAdmin?: boolean;
  },
  adminId: Id<"user">,
) {
  const now = Date.now();
  const id = await ctx.db.insert("user", {
    clerkUserId: args.clerkUserId,
    email: args.email,
    firstName: args.firstName,
    lastName: args.lastName,
    isAdmin: args.isAdmin,
    adminAuthVersion: 0,
    adminRoleUpdatedAt: now,
  });

  await applyDashboardMetricsDelta(ctx.db, {
    totalUsers: 1,
  });

  await logAdminAction(ctx, adminId, "create_user", args.email);
  return await ctx.db.get(id);
}

export async function listAllUsersController(ctx: QueryCtx) {
  return await ctx.db.query("user").withIndex("by_email").take(200);
}

export async function listUsersByIdsController(
  ctx: QueryCtx,
  userIds: Id<"user">[],
) {
  const uniqueUserIds = Array.from(
    new Set(userIds.map((userId) => String(userId))),
  )
    .slice(0, 200)
    .map((userId) => userId as Id<"user">);

  const users = await Promise.all(
    uniqueUserIds.map(async (userId) => await ctx.db.get(userId)),
  );

  return users.filter(
    (user): user is NonNullable<typeof user> => user !== null,
  );
}

export async function listUsersPaginatedController(
  ctx: QueryCtx,
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  },
) {
  return await ctx.db
    .query("user")
    .withIndex("by_email")
    .paginate(paginationOpts);
}

export async function adminGetUserController(
  ctx: QueryCtx,
  userId: Id<"user">,
) {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User not found");
  return user;
}

export async function adminUpdateUserController(
  ctx: MutationCtx,
  args: {
    userId: Id<"user">;
    email?: string;
    firstName?: string;
    lastName?: string;
    isAdmin?: boolean;
  },
  adminId: Id<"user">,
) {
  const user = await ctx.db.get(args.userId);
  if (!user) throw new Error("User not found");

  const updates: Record<string, unknown> = {};
  if (args.email !== undefined) updates.email = args.email;
  if (args.firstName !== undefined) updates.firstName = args.firstName;
  if (args.lastName !== undefined) updates.lastName = args.lastName;
  if (args.isAdmin !== undefined) {
    const adminRolePatch = buildAdminRoleStatePatch(user, args.isAdmin);
    updates.isAdmin = adminRolePatch.isAdmin;
    updates.adminAuthVersion = adminRolePatch.adminAuthVersion;
    updates.adminRoleUpdatedAt = adminRolePatch.adminRoleUpdatedAt;
  }

  await ctx.db.patch(args.userId, updates);
  await logAdminAction(ctx, adminId, "update_user", args.userId);
  return await ctx.db.get(args.userId);
}
