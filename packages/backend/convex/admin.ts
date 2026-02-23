import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./authz";

// ────────────────────────────────────────────────────────────
// All functions in this file require admin privileges.
// ────────────────────────────────────────────────────────────

// ── Dashboard overview metrics ──────────────────────────────
export const getDashboardMetrics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const users = await ctx.db.query("user").collect();
    const memories = await ctx.db.query("memories").collect();
    const days = await ctx.db.query("days").collect();
    const summaries = await ctx.db.query("daySummaries").collect();

    return {
      totalUsers: users.length,
      totalMemories: memories.length,
      totalDays: days.length,
      totalSummaries: summaries.length,
    };
  },
});

// ── List all users (admin) ──────────────────────────────────
export const listAllUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("user").collect();
  },
});

// ── Get a specific user's details (admin) ───────────────────
export const getUserDetails = query({
  args: { userId: v.id("user") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Include preference + integration counts for context
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", user.clerkUserId))
      .unique();

    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_user_provider", (q) => q.eq("userId", user._id))
      .collect();

    return {
      ...user,
      hasPreferences: !!prefs,
      integrationCount: integrations.length,
    };
  },
});

// ── List audit logs (admin) ─────────────────────────────────
export const listAuditLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = args.limit ?? 50;

    return await ctx.db.query("auditLogs").order("desc").take(limit);
  },
});

// ── Write an audit log entry (admin) ────────────────────────
export const writeAuditLog = mutation({
  args: {
    action: v.string(),
    target: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const id = await ctx.db.insert("auditLogs", {
      actorUserId: admin._id,
      action: args.action,
      target: args.target,
      at: Date.now(),
    });

    return await ctx.db.get(id);
  },
});
