import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./authz";

declare const process: {
  env: Record<string, string | undefined>;
};

export const syncUserFromClerk = mutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.subject !== args.clerkUserId) {
      throw new Error("Unauthorized");
    }

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
      isAdmin: false,
    });

    return await ctx.db.get(id);
  },
});

export const isCurrentUserAdmin = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;

    const user = await ctx.db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject))
      .unique();

    return user?.isAdmin === true;
  },
});

export const getUserByClerkId = query({
  args: {
    clerkUserId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("user").collect();
  },
});

function getBootstrapAdminIds(): string[] {
  return (process.env.ADMIN_BOOTSTRAP_CLERK_USER_IDS ?? "")
    .split(",")
    .map((value: string) => value.trim())
    .filter(Boolean);
}

export const bootstrapMakeMeAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const bootstrapIds = getBootstrapAdminIds();
    if (bootstrapIds.length === 0 || !bootstrapIds.includes(identity.subject)) {
      throw new Error("Forbidden");
    }

    const user = await ctx.db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject))
      .unique();

    if (!user) {
      throw new Error("User not found. Sign in once to create it.");
    }

    await ctx.db.patch(user._id, { isAdmin: true });
    return { success: true };
  },
});

export const setUserAdminStatus = mutation({
  args: {
    clerkUserId: v.string(),
    isAdmin: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const user = await ctx.db
      .query("user")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(user._id, { isAdmin: args.isAdmin });
    return { success: true };
  },
});
