import { describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as memoriesModule from "./memories";

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

    const media = await addMemoryMedia(ctx, {
      memoryId,
      storageId: "storage_img_001",
      type: "image",
      width: 1200,
      height: 800,
    });
    const mediaId = media?._id as Id<"memoryMedia">;

    const listedMedia = await listMemoryMedia(ctx, { memoryId });
    expect(listedMedia[0]?.url).toBe("https://cdn.example.com/storage_img_001");

    const thumbnails = await listMemoryMediaThumbnailsForMemories(ctx, {
      memoryIds: [memoryId, memoryId],
    });
    expect(thumbnails).toEqual([
      {
        memoryId: String(memoryId),
        thumbnailUrl: "https://cdn.example.com/storage_img_001",
      },
    ]);

    const deletedMedia = await deleteMemoryMedia(ctx, { mediaId });
    expect(deletedMedia.success).toBe(true);
    expect(ctx.storage.delete).toHaveBeenCalledWith("storage_img_001");

    const deleted = await deleteMemory(ctx, { memoryId });
    expect(deleted.success).toBe(true);
    expect(db.getTable("memories")).toHaveLength(0);
  });
});
