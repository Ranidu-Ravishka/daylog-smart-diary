import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./authz";

const DEFAULT_CONTENT_PAGE_LIMIT = 50;
const MAX_CONTENT_PAGE_LIMIT = 200;

function clampContentPageLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CONTENT_PAGE_LIMIT;
  }

  const normalized = Math.floor(value);
  if (normalized < 1) return 1;
  if (normalized > MAX_CONTENT_PAGE_LIMIT) return MAX_CONTENT_PAGE_LIMIT;
  return normalized;
}

export const writeContent = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db
      .query("content")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (existing) {
      throw new Error(
        `A content item with slug "${args.slug}" already exists.`,
      );
    }

    const id = await ctx.db.insert("content", {
      slug: args.slug,
      title: args.title,
      body: args.body,
    });

    return await ctx.db.get(id);
  },
});

export const getContent = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("content")
      .order("desc")
      .paginate({
        numItems: clampContentPageLimit(args.limit),
        cursor: args.cursor ?? null,
      });

    return {
      items: page.page,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const getContentBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const content = await ctx.db
      .query("content")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!content) {
      throw new Error(`No content item found with slug "${args.slug}".`);
    }

    return content;
  },
});

export const updateContent = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db
      .query("content")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!existing) {
      throw new Error(`No content item found with slug "${args.slug}".`);
    }

    await ctx.db.patch(existing._id, {
      title: args.title,
      body: args.body,
    });

    return await ctx.db.get(existing._id);
  },
});

export const deleteContent = mutation({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db
      .query("content")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!existing) {
      throw new Error(`No content item found with slug "${args.slug}".`);
    }

    await ctx.db.delete(existing._id);
    return { success: true };
  },
});
