import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireUser, requireOwnership } from "./authz";
import { validateDayKey, clampLimit } from "./validators";
import type { Doc, Id } from "./_generated/dataModel";
import { applyDashboardMetricsDelta } from "./dashboardMetrics";
import { getPlanLimitsForTier, normalizeUserPlanTier } from "./planLimits";
import { captureException, logInfo } from "./observability";

const IMAGE_CONTENT_TYPE_PREFIX = "image/";
const VIDEO_CONTENT_TYPE_PREFIX = "video/";
const MAX_MEMORY_THUMBNAIL_BATCH_SIZE = 100;
const DEFAULT_SUMMARY_GENERATION_MEMORY_LIMIT = 50;
const MAX_SUMMARY_GENERATION_MEMORY_LIMIT = 200;

function clampSummaryGenerationMemoryLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SUMMARY_GENERATION_MEMORY_LIMIT;
  }

  const normalized = Math.floor(value);

  if (normalized < 1) {
    return 1;
  }

  if (normalized > MAX_SUMMARY_GENERATION_MEMORY_LIMIT) {
    return MAX_SUMMARY_GENERATION_MEMORY_LIMIT;
  }

  return normalized;
}

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

type AddMemoryMediaArgs = {
  memoryId: Id<"memories">;
  storageId: string;
  type: "image" | "video";
  width: number | undefined;
  height: number | undefined;
  clientMediaId?: string;
};

function normalizeClientMediaId(
  clientMediaId: string | undefined,
): string | undefined {
  const trimmed = clientMediaId?.trim();
  return trimmed ? trimmed : undefined;
}

function getDedupedMemoryIds(
  memoryIds: Id<"memories">[],
): Array<Id<"memories">> {
  return Array.from(new Set(memoryIds.map((id) => String(id))))
    .map((id) => id as Id<"memories">)
    .slice(0, MAX_MEMORY_THUMBNAIL_BATCH_SIZE);
}

async function resolveStorageUrls(
  ctx: { storage: Pick<MutationCtx["storage"], "getUrl"> },
  storageIds: string[],
): Promise<Map<string, string | null>> {
  if (storageIds.length === 0) {
    return new Map();
  }

  const entries = await Promise.all(
    storageIds.map(
      async (storageId): Promise<[string, string | null]> => [
        storageId,
        await ctx.storage.getUrl(storageId as any),
      ],
    ),
  );

  return new Map(entries);
}

async function resolveThumbnailStorageIdsForMemories(
  ctx: { db: Pick<MutationCtx["db"], "get"> },
  userId: Id<"user">,
  memoryIds: Array<Id<"memories">>,
): Promise<Map<string, string | null>> {
  const memoryRows = await Promise.all(
    memoryIds.map(async (memoryId) => await ctx.db.get(memoryId)),
  );

  const storageIdByMemoryId = new Map<string, string | null>();

  memoryIds.forEach((memoryId, index) => {
    const memory = memoryRows[index];
    if (!memory || memory.userId !== userId) {
      storageIdByMemoryId.set(String(memoryId), null);
      return;
    }

    storageIdByMemoryId.set(
      String(memoryId),
      memory.thumbnailStorageId ?? null,
    );
  });

  return storageIdByMemoryId;
}

async function addMemoryMediaForOwnedMemory(
  ctx: MutationCtx,
  user: Doc<"user">,
  memory: Doc<"memories">,
  args: AddMemoryMediaArgs,
) {
  const clientMediaId = normalizeClientMediaId(args.clientMediaId);

  if (clientMediaId) {
    const existing = await ctx.db
      .query("memoryMedia")
      .withIndex("by_memory_clientMediaId", (q) =>
        q.eq("memoryId", args.memoryId).eq("clientMediaId", clientMediaId),
      )
      .unique();

    if (existing) {
      if (existing.type !== args.type) {
        throw new Error(
          "Conflict: clientMediaId already used for a different media payload.",
        );
      }

      if (existing.type === "image" && !memory.thumbnailStorageId) {
        await ctx.db.patch(memory._id, {
          thumbnailStorageId: existing.storageId,
        });
      }

      return existing;
    }
  }

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
    throw new Error("Uploaded media file was not found. Please upload again.");
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
    clientMediaId,
    storageId: args.storageId,
    type: args.type,
    width: args.width,
    height: args.height,
  });

  if (args.type === "image" && !memory.thumbnailStorageId) {
    await ctx.db.patch(memory._id, {
      thumbnailStorageId: args.storageId,
    });
  }

  return await ctx.db.get(id);
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
    clientRequestId: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    mood: v.optional(v.string()),
    happenedAt: v.number(),
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const startedAt = Date.now();

    logInfo("memory_creation.started", {
      status: "started",
      userId: user._id,
      dayKey: args.dayKey,
      hasClientRequestId: Boolean(args.clientRequestId),
    });

    try {
      validateDayKey(args.dayKey);
      assertMemoryTextLimits({
        title: args.title,
        description: args.description,
        planTier: user.planTier,
      });

      if (args.clientRequestId) {
        const existing = await ctx.db
          .query("memories")
          .withIndex("by_user_clientRequestId", (q) =>
            q
              .eq("userId", user._id)
              .eq("clientRequestId", args.clientRequestId),
          )
          .unique();

        if (existing) {
          const samePayload =
            existing.title === args.title &&
            (existing.description ?? undefined) ===
              (args.description ?? undefined) &&
            (existing.mood ?? undefined) === (args.mood ?? undefined) &&
            existing.happenedAt === args.happenedAt &&
            existing.dayKey === args.dayKey;

          if (!samePayload) {
            throw new Error(
              "Conflict: clientRequestId already used for a different memory payload.",
            );
          }

          logInfo("memory_creation.succeeded", {
            status: "succeeded",
            userId: user._id,
            dayKey: args.dayKey,
            memoryId: existing._id,
            mode: "idempotent",
            durationMs: Date.now() - startedAt,
          });

          return existing;
        }
      }

      const id = await ctx.db.insert("memories", {
        userId: user._id,
        clientRequestId: args.clientRequestId,
        title: args.title,
        description: args.description,
        mood: args.mood,
        happenedAt: args.happenedAt,
        dayKey: args.dayKey,
      });

      await applyDashboardMetricsDelta(ctx.db, {
        totalMemories: 1,
      });

      logInfo("memory_creation.succeeded", {
        status: "succeeded",
        userId: user._id,
        dayKey: args.dayKey,
        memoryId: id,
        mode: "create",
        durationMs: Date.now() - startedAt,
      });

      return await ctx.db.get(id);
    } catch (error) {
      captureException("memory_creation.failed", error, {
        status: "failed",
        userId: user._id,
        dayKey: args.dayKey,
        hasClientRequestId: Boolean(args.clientRequestId),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
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

// ── List day memories for summary generation (capped, ordered) ────────────
export const listMemoriesByDayForSummaryGeneration = query({
  args: {
    dayKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const limit = clampSummaryGenerationMemoryLimit(args.limit);

    const paginated = await ctx.db
      .query("memories")
      .withIndex("by_user_day_happenedAt", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .order("desc")
      .paginate({
        numItems: limit,
        cursor: null,
      });

    return paginated.page
      .slice()
      .sort(
        (left, right) =>
          right.happenedAt - left.happenedAt ||
          right._creationTime - left._creationTime,
      );
  },
});

// ── List day memories with cursor pagination + thumbnails ──
export const listMemoriesByDayPaginated = query({
  args: {
    dayKey: v.string(),
    paginationOpts: paginationOptsValidator,
    refreshToken: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    void args.refreshToken;

    const user = await requireUser(ctx);
    const paginated = await ctx.db
      .query("memories")
      .withIndex("by_user_day_happenedAt", (q) =>
        q.eq("userId", user._id).eq("dayKey", args.dayKey),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    const uniqueStorageIds = Array.from(
      new Set(
        paginated.page
          .map((memory) => memory.thumbnailStorageId)
          .filter(
            (storageId): storageId is string => typeof storageId === "string",
          ),
      ),
    );

    const storageIdToUrl = await resolveStorageUrls(ctx, uniqueStorageIds);

    return {
      ...paginated,
      page: paginated.page.map((memory) => ({
        ...memory,
        thumbnailUrl: memory.thumbnailStorageId
          ? (storageIdToUrl.get(memory.thumbnailStorageId) ?? null)
          : null,
      })),
    };
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
    const startedAt = Date.now();

    logInfo("deletion.memory.started", {
      status: "started",
      userId: user._id,
      memoryId: args.memoryId,
    });

    try {
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

      logInfo("deletion.memory.succeeded", {
        status: "succeeded",
        userId: user._id,
        memoryId: args.memoryId,
        deletedMediaCount: media.length,
        durationMs: Date.now() - startedAt,
      });

      return { success: true };
    } catch (error) {
      captureException("deletion.memory.failed", error, {
        status: "failed",
        userId: user._id,
        memoryId: args.memoryId,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  },
});

// ── Add media to a memory ───────────────────────────────────
export const addMemoryMedia = mutation({
  args: {
    memoryId: v.id("memories"),
    clientMediaId: v.optional(v.string()),
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

    return await addMemoryMediaForOwnedMemory(ctx, user, memory, {
      memoryId: args.memoryId,
      clientMediaId: args.clientMediaId,
      storageId: args.storageId,
      type: args.type,
      width: args.width,
      height: args.height,
    });
  },
});

// ── Add media to a memory by clientRequestId ──────────────
export const addMemoryMediaByClientRequestId = mutation({
  args: {
    memoryClientRequestId: v.string(),
    clientMediaId: v.string(),
    storageId: v.string(),
    type: v.union(v.literal("image"), v.literal("video")),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const memoryClientRequestId = args.memoryClientRequestId.trim();

    const memory = await ctx.db
      .query("memories")
      .withIndex("by_user_clientRequestId", (q) =>
        q.eq("userId", user._id).eq("clientRequestId", memoryClientRequestId),
      )
      .unique();

    if (!memory) {
      throw new Error("Memory not found for clientRequestId.");
    }

    return await addMemoryMediaForOwnedMemory(ctx, user, memory, {
      memoryId: memory._id,
      clientMediaId: args.clientMediaId,
      storageId: args.storageId,
      type: args.type,
      width: args.width,
      height: args.height,
    });
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
    void args.refreshToken;

    const uniqueIds = getDedupedMemoryIds(args.memoryIds);

    if (uniqueIds.length === 0) {
      return [];
    }

    const thumbnailStorageIdByMemoryId =
      await resolveThumbnailStorageIdsForMemories(ctx, user._id, uniqueIds);

    const uniqueStorageIds = Array.from(
      new Set(
        Array.from(thumbnailStorageIdByMemoryId.values()).filter(
          (storageId): storageId is string => typeof storageId === "string",
        ),
      ),
    );

    const storageIdToUrl = await resolveStorageUrls(ctx, uniqueStorageIds);

    return uniqueIds.map((memoryId) => {
      const id = String(memoryId);
      const storageId = thumbnailStorageIdByMemoryId.get(id);

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
    const startedAt = Date.now();

    logInfo("deletion.memory_media.started", {
      status: "started",
      userId: user._id,
      mediaId: args.mediaId,
    });

    try {
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

      if (media.type === "image") {
        const memory = await ctx.db.get(media.memoryId);
        if (
          memory &&
          memory.userId === user._id &&
          memory.thumbnailStorageId === media.storageId
        ) {
          const nextImage = await ctx.db
            .query("memoryMedia")
            .withIndex("by_user_memory_type", (q) =>
              q
                .eq("userId", user._id)
                .eq("memoryId", media.memoryId)
                .eq("type", "image"),
            )
            .take(1);

          await ctx.db.patch(memory._id, {
            thumbnailStorageId: nextImage[0]?.storageId,
          });
        }
      }

      logInfo("deletion.memory_media.succeeded", {
        status: "succeeded",
        userId: user._id,
        mediaId: args.mediaId,
        memoryId: media.memoryId,
        durationMs: Date.now() - startedAt,
      });

      return { success: true };
    } catch (error) {
      captureException("deletion.memory_media.failed", error, {
        status: "failed",
        userId: user._id,
        mediaId: args.mediaId,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  },
});
