import { describe, expect, it } from "vitest";

import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as contentModule from "./content";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

function seededDb() {
  return createInMemoryDb({
    user: [
      {
        _id: "user_admin_001",
        _creationTime: 1,
        clerkUserId: "clerk_admin_001",
        email: "admin@example.com",
        isAdmin: true,
      },
      {
        _id: "user_member_001",
        _creationTime: 2,
        clerkUserId: "clerk_member_001",
        email: "member@example.com",
        isAdmin: false,
      },
    ],
  });
}

describe("content behavior", () => {
  it("supports write, update, read, and delete lifecycle", async () => {
    const db = seededDb();

    const writeContent = handler<
      { slug: string; title: string; body: string },
      { slug: string; title: string; body: string } | null
    >(contentModule.writeContent);
    const updateContent = handler<
      { slug: string; title: string; body: string },
      { slug: string; title: string; body: string } | null
    >(contentModule.updateContent);
    const getContentBySlug = handler<{ slug: string }, { title: string }>(
      contentModule.getContentBySlug,
    );
    const deleteContent = handler<{ slug: string }, { success: boolean }>(
      contentModule.deleteContent,
    );

    const adminCtx = createAuthCtx(db, "clerk_admin_001");

    const created = await writeContent(adminCtx, {
      slug: "privacy",
      title: "Privacy",
      body: "Initial body",
    });
    expect(created?.slug).toBe("privacy");

    await expect(
      writeContent(adminCtx, {
        slug: "privacy",
        title: "Duplicate",
        body: "Duplicate body",
      }),
    ).rejects.toThrow('A content item with slug "privacy" already exists.');

    const updated = await updateContent(adminCtx, {
      slug: "privacy",
      title: "Privacy v2",
      body: "Updated body",
    });
    expect(updated?.title).toBe("Privacy v2");

    const bySlug = await getContentBySlug(
      createAuthCtx(db, "clerk_member_001"),
      {
        slug: "privacy",
      },
    );
    expect(bySlug.title).toBe("Privacy v2");

    const deleted = await deleteContent(adminCtx, { slug: "privacy" });
    expect(deleted.success).toBe(true);

    await expect(
      getContentBySlug(createAuthCtx(db, "clerk_member_001"), {
        slug: "privacy",
      }),
    ).rejects.toThrow('No content item found with slug "privacy".');
  });

  it("enforces admin-only writes", async () => {
    const db = seededDb();

    const writeContent = handler<
      { slug: string; title: string; body: string },
      unknown
    >(contentModule.writeContent);

    await expect(
      writeContent(createAuthCtx(db, "clerk_member_001"), {
        slug: "terms",
        title: "Terms",
        body: "Body",
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("returns content sorted by newest first", async () => {
    const db = createInMemoryDb({
      content: [
        {
          _id: "content_001",
          _creationTime: 1,
          slug: "older",
          title: "Older",
          body: "Older body",
        },
        {
          _id: "content_002",
          _creationTime: 2,
          slug: "newer",
          title: "Newer",
          body: "Newer body",
        },
      ],
    });

    const getContent = handler<
      { limit?: number; cursor?: string },
      { items: Array<{ slug: string }>; nextCursor: string | null }
    >(contentModule.getContent);

    const firstPage = await getContent(createAuthCtx(db, null), { limit: 1 });
    expect(firstPage.items.map((item) => item.slug)).toEqual(["newer"]);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await getContent(createAuthCtx(db, null), {
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(secondPage.items.map((item) => item.slug)).toEqual(["older"]);
    expect(secondPage.nextCursor).toBeNull();
  });
});
