import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser, requireOwnership } from "./authz";
import { validateDayKey, clampLimit } from "./validators";
import type { Id } from "./_generated/dataModel";
import { applyDashboardMetricsDelta } from "./dashboardMetrics";
import { getPlanLimitsForTier, normalizeUserPlanTier } from "./planLimits";

const IMAGE_CONTENT_TYPE_PREFIX = "image/";
const VIDEO_CONTENT_TYPE_PREFIX = "video/";

function bytesToMbLabel(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

function assertMemoryTextLimits(args: {
  title: string;
  description: string | undefined;
  planTier: string | undefined;
}) {
  const planTier = normalizeUserPlanTier(args.planTier);
  const limits = getPlanLimitsForTier(planTier).memory;

  if (args.title.length > limits.maxTitleLength) {
    throw new Error(
      `Plan limit reached: title supports up to ${limits.maxTitleLength} characters on ${planTier} plan.`,
    );
  }

  const descriptionLength = args.description?.length ?? 0;
  if (descriptionLength > limits.maxDescriptionLength) {
    throw new Error(
      `Plan limit reached: description supports up to ${limits.maxDescriptionLength} characters on ${planTier} plan.`,
    );
  }
}

// ── Generate an upload URL for memory media ─────────────────
export const generateMemoryMediaUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

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
    assertMemoryTextLimits({
      title: args.title,
      description: args.description,
      planTier: user.planTier,
    });

    const id = await ctx.db.insert("memories", {
      userId: user._id,
      title: args.title,
      description: args.description,
      mood: args.mood,
      happenedAt: args.happenedAt,
      dayKey: args.dayKey,
    });

    await applyDashboardMetricsDelta(ctx.db, {
      totalMemories: 1,
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
  args: {
    dayKey: v.string(),
    refreshToken: v.optional(v.number()),
  },
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
    refreshToken: v.optional(v.number()),
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

// ── Read current user's memory plan limits ─────────────────
export const getMyMemoryPlanLimits = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const planTier = normalizeUserPlanTier(user.planTier);
    const limits = getPlanLimitsForTier(planTier).memory;

    return {
      planTier,
      maxTitleLength: limits.maxTitleLength,
      maxDescriptionLength: limits.maxDescriptionLength,
      maxMediaPerMemory: limits.maxMediaPerMemory,
      maxMediaBytesPerFile: limits.maxMediaBytesPerFile,
    };
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

    assertMemoryTextLimits({
      title: args.title ?? memory.title,
      description: args.description ?? memory.description,
      planTier: user.planTier,
    });

    const updates: Record<string, unknown> = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.mood !== undefined) updates.mood = args.mood;
    if (args.happenedAt !== undefined) updates.happenedAt = args.happenedAt;
    if (args.dayKey !== undefined) {
      validateDayKey(args.dayKey);
      updates.dayKey = args.dayKey;
    }

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

    await applyDashboardMetricsDelta(ctx.db, {
      totalMemories: -1,
    });

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

    const planTier = normalizeUserPlanTier(user.planTier);
    const limits = getPlanLimitsForTier(planTier).memory;

    const existingMediaCount = (
      await ctx.db
        .query("memoryMedia")
        .withIndex("by_memory", (q) => q.eq("memoryId", args.memoryId))
        .take(limits.maxMediaPerMemory + 1)
    ).length;

    if (existingMediaCount >= limits.maxMediaPerMemory) {
      throw new Error(
        `Plan limit reached: up to ${limits.maxMediaPerMemory} media item(s) per memory on ${planTier} plan.`,
      );
    }

    const metadata = await ctx.storage.getMetadata(args.storageId as any);
    if (!metadata) {
      throw new Error(
        "Uploaded media file was not found. Please upload again.",
      );
    }

    if (metadata.size > limits.maxMediaBytesPerFile) {
      try {
        await ctx.storage.delete(args.storageId as any);
      } catch {
        // Ignore cleanup failures for oversized uploads.
      }

      throw new Error(
        `Plan limit reached: max file size is ${bytesToMbLabel(limits.maxMediaBytesPerFile)} on ${planTier} plan.`,
      );
    }

    const contentType = metadata.contentType?.toLowerCase();
    if (
      args.type === "image" &&
      contentType &&
      !contentType.startsWith(IMAGE_CONTENT_TYPE_PREFIX)
    ) {
      throw new Error("Invalid media type: expected an image upload.");
    }

    if (
      args.type === "video" &&
      contentType &&
      !contentType.startsWith(VIDEO_CONTENT_TYPE_PREFIX)
    ) {
      throw new Error("Invalid media type: expected a video upload.");
    }

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

    const media = await ctx.db
      .query("memoryMedia")
      .withIndex("by_memory", (q) => q.eq("memoryId", args.memoryId))
      .collect();

    return await Promise.all(
      media.map(async (item) => ({
        ...item,
        url: await ctx.storage.getUrl(item.storageId as any),
      })),
    );
  },
});

// ── List first image thumbnail URL for multiple memories ───
export const listMemoryMediaThumbnailsForMemories = query({
  args: {
    memoryIds: v.array(v.id("memories")),
    refreshToken: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const uniqueIds = Array.from(
      new Set(args.memoryIds.map((id) => String(id))),
    )
      .map((id) => id as Id<"memories">)
      .slice(0, 100);

    if (uniqueIds.length === 0) {
      return [];
    }

    const firstImageStorageIdByMemoryId = new Map<string, string | null>(
      await Promise.all(
        uniqueIds.map(async (memoryId): Promise<[string, string | null]> => {
          const firstImage = await ctx.db
            .query("memoryMedia")
            .withIndex("by_user_memory_type", (q) =>
              q
                .eq("userId", user._id)
                .eq("memoryId", memoryId)
                .eq("type", "image"),
            )
            .take(1);

          return [String(memoryId), firstImage[0]?.storageId ?? null];
        }),
      ),
    );

    const uniqueStorageIds = Array.from(
      new Set(
        Array.from(firstImageStorageIdByMemoryId.values()).filter(
          (storageId): storageId is string => typeof storageId === "string",
        ),
      ),
    );

    const storageIdToUrlEntries = await Promise.all(
      uniqueStorageIds.map(
        async (storageId): Promise<[string, string | null]> => [
          storageId,
          await ctx.storage.getUrl(storageId as any),
        ],
      ),
    );

    const storageIdToUrl = new Map<string, string | null>(
      storageIdToUrlEntries,
    );

    return uniqueIds.map((memoryId) => {
      const id = String(memoryId);
      const storageId = firstImageStorageIdByMemoryId.get(id);

      return {
        memoryId: id,
        thumbnailUrl: storageId
          ? (storageIdToUrl.get(storageId) ?? null)
          : null,
      };
    });
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
