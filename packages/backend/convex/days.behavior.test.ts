import { describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as daysModule from "./days";

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

describe("days behavior", () => {
  it("upserts and reads day records", async () => {
    const db = seededDb();

    const upsertDay = handler<
      {
        dayKey: string;
        rating?: number;
        manualNotes?: string[];
        peopleTags?: string[];
      },
      { _id: Id<"days">; rating?: number; manualNotes?: string[] } | null
    >(daysModule.upsertDay);
    const getDay = handler<{ dayKey: string }, { dayKey: string } | null>(
      daysModule.getDay,
    );

    const ctx = createAuthCtx(db, "clerk_member_001");

    const created = await upsertDay(ctx, {
      dayKey: "2026-04-02",
      rating: 4,
      manualNotes: ["first"],
      peopleTags: ["Alex"],
    });
    expect(created?.rating).toBe(4);

    const updated = await upsertDay(ctx, {
      dayKey: "2026-04-02",
      rating: 5,
      manualNotes: ["updated"],
    });
    expect(updated?.rating).toBe(5);
    expect(updated?.manualNotes).toEqual(["updated"]);

    const fetched = await getDay(ctx, { dayKey: "2026-04-02" });
    expect(fetched?.dayKey).toBe("2026-04-02");
  });

  it("lists and updates ratings for recent days", async () => {
    const db = seededDb();

    await db.insert("days", {
      userId: USER_ID,
      dayKey: "2026-04-01",
      rating: 2,
    });
    await db.insert("days", {
      userId: USER_ID,
      dayKey: "2026-04-03",
      rating: 3,
    });

    const listRecentDays = handler<
      { limit?: number },
      Array<{ dayKey: string; rating?: number }>
    >(daysModule.listRecentDays);
    const updateDayRating = handler<
      { dayKey: string; rating: number },
      { dayKey: string; rating?: number } | null
    >(daysModule.updateDayRating);

    const ctx = createAuthCtx(db, "clerk_member_001");

    const listed = await listRecentDays(ctx, { limit: 1 });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.dayKey).toBe("2026-04-03");

    const updated = await updateDayRating(ctx, {
      dayKey: "2026-04-01",
      rating: 5,
    });
    expect(updated?.rating).toBe(5);

    const created = await updateDayRating(ctx, {
      dayKey: "2026-04-04",
      rating: 1,
    });
    expect(created?.dayKey).toBe("2026-04-04");
  });

  it("enforces ownership for getDayById and deletes cascaded day data", async () => {
    const db = seededDb();

    const ownDayId = (await db.insert("days", {
      userId: USER_ID,
      dayKey: "2026-04-05",
      rating: 3,
    })) as Id<"days">;

    const otherDayId = (await db.insert("days", {
      userId: OTHER_USER_ID,
      dayKey: "2026-04-05",
      rating: 4,
    })) as Id<"days">;

    await db.insert("memories", {
      userId: USER_ID,
      title: "Cascade memory",
      happenedAt: 1,
      dayKey: "2026-04-05",
    });

    await db.insert("daySummaries", {
      userId: USER_ID,
      dayKey: "2026-04-05",
      story: "Cascade summary",
      highlights: [],
      sourcesUsed: [],
      generatedAt: 1,
    });

    const getDayById = handler<{ dayId: Id<"days"> }, { _id: Id<"days"> }>(
      daysModule.getDayById,
    );
    const deleteDay = handler<{ dayId: Id<"days"> }, { success: boolean }>(
      daysModule.deleteDay,
    );

    const ctx = createAuthCtx(db, "clerk_member_001");

    const ownDay = await getDayById(ctx, { dayId: ownDayId });
    expect(ownDay._id).toBe(ownDayId);

    await expect(getDayById(ctx, { dayId: otherDayId })).rejects.toThrow(
      "Forbidden",
    );

    const deleted = await deleteDay(ctx, { dayId: ownDayId });
    expect(deleted.success).toBe(true);
    expect(db.getTable("days").map((row) => row._id)).not.toContain(ownDayId);
    expect(db.getTable("memories")).toHaveLength(0);
    expect(db.getTable("daySummaries")).toHaveLength(0);
  });
});
