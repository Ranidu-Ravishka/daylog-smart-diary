import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser, requireOwnership } from "./authz";
import { validateDayKey, clampLimit } from "./validators";

// ── Create a new memory ─────────────────────────────────────
export const createMemory = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    mood: v.optional(v.string()),
    happenedAt: v.number(),
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    validateDayKey(args.dayKey);

    const id = await ctx.db.insert("memories", {
      userId: user._id,
      title: args.title,
      description: args.description,
      mood: args.mood,
      happenedAt: args.happenedAt,
      dayKey: args.dayKey,
    });

    return await ctx.db.get(id);
  },
});

// ── Get a single memory by ID ───────────────────────────────
export const getMemory = query({
  args: { memoryId: v.id("memories") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const memory = await ctx.db.get(args.memoryId);

    if (!memory) {
      throw new Error("Memory not found");
    }

    requireOwnership(user, memory.userId);
    return memory;
  },
});

// ── List memories for a specific day ────────────────────────
export const listMemoriesByDay = query({
  args: { dayKey: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    return await ctx.db
      .query("memories")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .collect();
  },
});

// ── List recent memories (paginated) ────────────────────────
export const listRecentMemories = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const limit = clampLimit(args.limit ?? 20);

    return await ctx.db
      .query("memories")
      .withIndex("by_user_happenedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
  },
});

// ── Update a memory ─────────────────────────────────────────
export const updateMemory = mutation({
  args: {
    memoryId: v.id("memories"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    mood: v.optional(v.string()),
    happenedAt: v.optional(v.number()),
    dayKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const memory = await ctx.db.get(args.memoryId);

    if (!memory) {
      throw new Error("Memory not found");
    }

    requireOwnership(user, memory.userId);

    const updates: Record<string, unknown> = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.mood !== undefined) updates.mood = args.mood;
    if (args.happenedAt !== undefined) updates.happenedAt = args.happenedAt;
    if (args.dayKey !== undefined) updates.dayKey = args.dayKey;

    await ctx.db.patch(args.memoryId, updates);
    return await ctx.db.get(args.memoryId);
  },
});

// ── Delete a memory (and its media) ─────────────────────────
export const deleteMemory = mutation({
  args: { memoryId: v.id("memories") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const memory = await ctx.db.get(args.memoryId);

    if (!memory) {
      throw new Error("Memory not found");
    }

    requireOwnership(user, memory.userId);

    // Delete associated media rows and storage blobs
    const media = await ctx.db
      .query("memoryMedia")
      .withIndex("by_memory", (q) => q.eq("memoryId", args.memoryId))
      .collect();

    for (const m of media) {
      try {
        await ctx.storage.delete(m.storageId as any);
      } catch {
        // Storage blob may already be gone — continue cleanup
      }
      await ctx.db.delete(m._id);
    }

    await ctx.db.delete(args.memoryId);
    return { success: true };
  },
});

// ── Add media to a memory ───────────────────────────────────
export const addMemoryMedia = mutation({
  args: {
    memoryId: v.id("memories"),
    storageId: v.string(),
    type: v.union(v.literal("image"), v.literal("video")),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const memory = await ctx.db.get(args.memoryId);

    if (!memory) {
      throw new Error("Memory not found");
    }

    requireOwnership(user, memory.userId);

    const id = await ctx.db.insert("memoryMedia", {
      memoryId: args.memoryId,
      userId: user._id,
      storageId: args.storageId,
      type: args.type,
      width: args.width,
      height: args.height,
    });

    return await ctx.db.get(id);
  },
});

// ── List media for a memory ─────────────────────────────────
export const listMemoryMedia = query({
  args: { memoryId: v.id("memories") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const memory = await ctx.db.get(args.memoryId);

    if (!memory) {
      throw new Error("Memory not found");
    }

    requireOwnership(user, memory.userId);

    return await ctx.db
      .query("memoryMedia")
      .withIndex("by_memory", (q) => q.eq("memoryId", args.memoryId))
      .collect();
  },
});

// ── Delete a media attachment ───────────────────────────────
export const deleteMemoryMedia = mutation({
  args: { mediaId: v.id("memoryMedia") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const media = await ctx.db.get(args.mediaId);

    if (!media) {
      throw new Error("Media not found");
    }

    requireOwnership(user, media.userId);

    // Delete the storage blob as well
    try {
      await ctx.storage.delete(media.storageId as any);
    } catch {
      // Storage blob may already be gone — continue cleanup
    }

    await ctx.db.delete(args.mediaId);
    return { success: true };
  },
});
