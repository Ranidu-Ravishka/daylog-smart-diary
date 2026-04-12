import { describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as memoriesModule from "./memories";
import { getPlanLimitsForTier } from "./planLimits";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const USER_ID = "user_member_001" as Id<"user">;
const OTHER_USER_ID = "user_other_001" as Id<"user">;

function seededDb() {
  return createInMemoryDb({
    user: [
      {
        _id: USER_ID,
        _creationTime: 1,
        clerkUserId: "clerk_member_001",
        email: "member@example.com",
        isAdmin: false,
      },
      {
        _id: OTHER_USER_ID,
        _creationTime: 2,
        clerkUserId: "clerk_other_001",
        email: "other@example.com",
        isAdmin: false,
      },
    ],
  });
}

function createMemoryCtx(
  db: ReturnType<typeof createInMemoryDb>,
  subject: string | null,
) {
  const storage = {
    generateUploadUrl: vi.fn(async () => "https://upload.example.com"),
    delete: vi.fn(async () => undefined),
    getUrl: vi.fn(
      async (storageId: string) => `https://cdn.example.com/${storageId}`,
    ),
    getMetadata: vi.fn(async (storageId: string) => ({
      storageId,
      sha256: "abc123",
      size: 500_000,
      contentType: "image/jpeg",
    })),
  };

  return {
    ...createAuthCtx(db, subject),
    storage,
  };
}

describe("memories behavior", () => {
  it("generates media upload URLs for authenticated users", async () => {
    const db = seededDb();

    const generateMemoryMediaUploadUrl = handler<
      Record<string, never>,
      { uploadUrl: string }
    >(memoriesModule.generateMemoryMediaUploadUrl);

    await expect(
      generateMemoryMediaUploadUrl(createAuthCtx(db, null), {}),
    ).rejects.toThrow("Unauthorized");

    const ctx = createMemoryCtx(db, "clerk_member_001");
    const result = await generateMemoryMediaUploadUrl(ctx, {});
    expect(result.uploadUrl).toBe("https://upload.example.com");
    expect(ctx.storage.generateUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("supports memory and media lifecycle with ownership checks", async () => {
    const db = seededDb();

    const createMemory = handler<
      {
        title: string;
        description?: string;
        mood?: string;
        happenedAt: number;
        dayKey: string;
      },
      { _id: Id<"memories">; title: string } | null
    >(memoriesModule.createMemory);
    const getMemory = handler<{ memoryId: Id<"memories"> }, { title: string }>(
      memoriesModule.getMemory,
    );
    const listMemoriesByDay = handler<
      { dayKey: string },
      Array<{ _id: Id<"memories"> }>
    >(memoriesModule.listMemoriesByDay);
    const listRecentMemories = handler<
      { limit?: number },
      Array<{ _id: Id<"memories"> }>
    >(memoriesModule.listRecentMemories);
    const updateMemory = handler<
      {
        memoryId: Id<"memories">;
        title?: string;
        description?: string;
        mood?: string;
        happenedAt?: number;
        dayKey?: string;
      },
      { title: string; mood?: string } | null
    >(memoriesModule.updateMemory);
    const deleteMemory = handler<
      { memoryId: Id<"memories"> },
      { success: boolean }
    >(memoriesModule.deleteMemory);

    const addMemoryMedia = handler<
      {
        memoryId: Id<"memories">;
        storageId: string;
        type: "image" | "video";
        width?: number;
        height?: number;
      },
      { _id: Id<"memoryMedia">; type: string } | null
    >(memoriesModule.addMemoryMedia);
    const listMemoryMedia = handler<
      { memoryId: Id<"memories"> },
      Array<{ storageId: string; url: string | null }>
    >(memoriesModule.listMemoryMedia);
    const listMemoryMediaThumbnailsForMemories = handler<
      { memoryIds: Id<"memories">[] },
      Array<{ memoryId: string; thumbnailUrl: string | null }>
    >(memoriesModule.listMemoryMediaThumbnailsForMemories);
    const deleteMemoryMedia = handler<
      { mediaId: Id<"memoryMedia"> },
      { success: boolean }
    >(memoriesModule.deleteMemoryMedia);

    const ctx = createMemoryCtx(db, "clerk_member_001");

    const created = await createMemory(ctx, {
      title: "A good day",
      description: "Details",
      mood: "happy",
      happenedAt: 100,
      dayKey: "2026-04-02",
    });

    const memoryId = created?._id as Id<"memories">;
    expect(created?.title).toBe("A good day");

    const fetched = await getMemory(ctx, { memoryId });
    expect(fetched.title).toBe("A good day");

    await expect(
      getMemory(createMemoryCtx(db, "clerk_other_001"), { memoryId }),
    ).rejects.toThrow("Forbidden");

    const byDay = await listMemoriesByDay(ctx, { dayKey: "2026-04-02" });
    expect(byDay).toHaveLength(1);

    const recent = await listRecentMemories(ctx, { limit: 10 });
    expect(recent[0]?._id).toBe(memoryId);

    const updated = await updateMemory(ctx, {
      memoryId,
      title: "A better day",
      mood: "calm",
      happenedAt: 200,
    });
    expect(updated?.title).toBe("A better day");
    expect(updated?.mood).toBe("calm");

    await db.insert("memoryMedia", {
      memoryId,
      userId: USER_ID,
      storageId: "storage_vid_001",
      type: "video",
      width: 1920,
      height: 1080,
    });

    const media = await addMemoryMedia(ctx, {
      memoryId,
      storageId: "storage_img_001",
      type: "image",
      width: 1200,
      height: 800,
    });
    const mediaId = media?._id as Id<"memoryMedia">;

    const listedMedia = await listMemoryMedia(ctx, { memoryId });
    expect(
      listedMedia.some(
        (item) => item.url === "https://cdn.example.com/storage_img_001",
      ),
    ).toBe(true);

    const otherCtx = createMemoryCtx(db, "clerk_other_001");
    const otherMemory = await createMemory(otherCtx, {
      title: "Other memory",
      happenedAt: 110,
      dayKey: "2026-04-02",
    });
    const otherMemoryId = otherMemory?._id as Id<"memories">;

    await addMemoryMedia(otherCtx, {
      memoryId: otherMemoryId,
      storageId: "storage_img_other_001",
      type: "image",
      width: 1000,
      height: 600,
    });

    ctx.storage.getUrl.mockClear();

    const thumbnails = await listMemoryMediaThumbnailsForMemories(ctx, {
      memoryIds: [memoryId, memoryId, otherMemoryId],
    });
    expect(thumbnails).toEqual([
      {
        memoryId: String(memoryId),
        thumbnailUrl: "https://cdn.example.com/storage_img_001",
      },
      {
        memoryId: String(otherMemoryId),
        thumbnailUrl: null,
      },
    ]);
    expect(ctx.storage.getUrl).toHaveBeenCalledTimes(1);
    expect(ctx.storage.getUrl).toHaveBeenCalledWith("storage_img_001");

    const deletedMedia = await deleteMemoryMedia(ctx, { mediaId });
    expect(deletedMedia.success).toBe(true);
    expect(ctx.storage.delete).toHaveBeenCalledWith("storage_img_001");

    const deleted = await deleteMemory(ctx, { memoryId });
    expect(deleted.success).toBe(true);
    expect(db.getTable("memories").map((row) => row._id)).toEqual([
      otherMemoryId,
    ]);
  });

  it("rejects invalid optional dayKey on memory update", async () => {
    const db = seededDb();

    const createMemory = handler<
      {
        title: string;
        description?: string;
        mood?: string;
        happenedAt: number;
        dayKey: string;
      },
      { _id: Id<"memories">; title: string } | null
    >(memoriesModule.createMemory);

    const updateMemory = handler<
      {
        memoryId: Id<"memories">;
        dayKey?: string;
      },
      { title: string; mood?: string } | null
    >(memoriesModule.updateMemory);

    const ctx = createMemoryCtx(db, "clerk_member_001");
    const created = await createMemory(ctx, {
      title: "Validation target",
      happenedAt: 100,
      dayKey: "2026-04-02",
    });

    await expect(
      updateMemory(ctx, {
        memoryId: created?._id as Id<"memories">,
        dayKey: "2026-13-40",
      }),
    ).rejects.toThrow("Invalid dayKey");
  });

  it("enforces memory text limits by plan tier", async () => {
    const db = createInMemoryDb({
      user: [
        {
          _id: USER_ID,
          _creationTime: 1,
          clerkUserId: "clerk_member_001",
          email: "member@example.com",
          isAdmin: false,
          planTier: "free",
        },
      ],
    });

    const createMemory = handler<
      {
        title: string;
        description?: string;
        mood?: string;
        happenedAt: number;
        dayKey: string;
      },
      { _id: Id<"memories">; title: string } | null
    >(memoriesModule.createMemory);

    const freeLimits = getPlanLimitsForTier("free").memory;
    const overlongTitle = "x".repeat(freeLimits.maxTitleLength + 1);

    await expect(
      createMemory(createMemoryCtx(db, "clerk_member_001"), {
        title: overlongTitle,
        happenedAt: 100,
        dayKey: "2026-04-02",
      }),
    ).rejects.toThrow("Plan limit reached: title supports up to");
  });

  it("enforces media count and file-size limits by plan tier", async () => {
    const db = createInMemoryDb({
      user: [
        {
          _id: USER_ID,
          _creationTime: 1,
          clerkUserId: "clerk_member_001",
          email: "member@example.com",
          isAdmin: false,
          planTier: "free",
        },
      ],
    });

    const createMemory = handler<
      {
        title: string;
        description?: string;
        mood?: string;
        happenedAt: number;
        dayKey: string;
      },
      { _id: Id<"memories">; title: string } | null
    >(memoriesModule.createMemory);

    const addMemoryMedia = handler<
      {
        memoryId: Id<"memories">;
        storageId: string;
        type: "image" | "video";
        width?: number;
        height?: number;
      },
      { _id: Id<"memoryMedia">; type: string } | null
    >(memoriesModule.addMemoryMedia);

    const ctx = createMemoryCtx(db, "clerk_member_001");
    const created = await createMemory(ctx, {
      title: "Media limit test",
      happenedAt: 100,
      dayKey: "2026-04-02",
    });
    const memoryId = created?._id as Id<"memories">;

    const freeLimits = getPlanLimitsForTier("free").memory;

    for (let index = 0; index < freeLimits.maxMediaPerMemory; index += 1) {
      await addMemoryMedia(ctx, {
        memoryId,
        storageId: `storage_img_${index}`,
        type: "image",
      });
    }

    await expect(
      addMemoryMedia(ctx, {
        memoryId,
        storageId: "storage_img_over_limit",
        type: "image",
      }),
    ).rejects.toThrow("Plan limit reached: up to");

    const dbForSize = createInMemoryDb({
      user: [
        {
          _id: USER_ID,
          _creationTime: 1,
          clerkUserId: "clerk_member_001",
          email: "member@example.com",
          isAdmin: false,
          planTier: "free",
        },
      ],
    });

    const sizeCtx = createMemoryCtx(dbForSize, "clerk_member_001");
    sizeCtx.storage.getMetadata = vi.fn(async (storageId: string) => ({
      storageId,
      sha256: "abc123",
      size: freeLimits.maxMediaBytesPerFile + 1,
      contentType: "image/jpeg",
    }));

    const createdForSize = await createMemory(sizeCtx, {
      title: "Oversize media",
      happenedAt: 100,
      dayKey: "2026-04-02",
    });

    await expect(
      addMemoryMedia(sizeCtx, {
        memoryId: createdForSize?._id as Id<"memories">,
        storageId: "storage_img_large",
        type: "image",
      }),
    ).rejects.toThrow("Plan limit reached: max file size is");

    expect(sizeCtx.storage.delete).toHaveBeenCalledWith("storage_img_large");
  });
});
