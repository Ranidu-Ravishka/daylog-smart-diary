import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";

const ADMIN_USER_ID = "user_admin_001" as Id<"user">;
const MEMBER_USER_ID = "user_member_001" as Id<"user">;

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

let usersModule: typeof import("./users");

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

function baseSeed() {
  return {
    user: [
      {
        _id: ADMIN_USER_ID,
        _creationTime: 1,
        clerkUserId: "clerk_admin_001",
        email: "admin@example.com",
        isAdmin: true,
      },
      {
        _id: MEMBER_USER_ID,
        _creationTime: 2,
        clerkUserId: "clerk_member_001",
        email: "member@example.com",
        isAdmin: false,
      },
    ],
  };
}

beforeAll(async () => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.daylog.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_valid_key_1234567890";
  process.env.OPENAI_API_KEY ??= "sk-test-valid-key-1234567890";
  process.env.ADMIN_BOOTSTRAP_CLERK_USER_IDS ??= "clerk_member_001";

  usersModule = await import("./users");
});

describe("users behavior", () => {
  it("syncs Clerk users and updates existing rows", async () => {
    const db = createInMemoryDb({
      ...baseSeed(),
      user: [baseSeed().user[0]],
    });

    const syncUserFromClerk = handler<
      {
        clerkUserId: string;
        email: string;
        firstName?: string;
        lastName?: string;
        imageUrl?: string;
      },
      { _id: Id<"user">; email: string; firstName?: string } | null
    >(usersModule.syncUserFromClerk);

    const memberCtx = createAuthCtx(db, "clerk_member_001");

    const created = await syncUserFromClerk(memberCtx, {
      clerkUserId: "clerk_member_001",
      email: "member@example.com",
      firstName: "Member",
      lastName: "One",
    });

    expect(created?.email).toBe("member@example.com");

    const metrics = db.getTable("adminDashboardMetrics");
    expect(metrics[0]?.totalUsers).toBe(1);

    const updated = await syncUserFromClerk(memberCtx, {
      clerkUserId: "clerk_member_001",
      email: "member+updated@example.com",
      firstName: "Updated",
    });

    expect(updated?.email).toBe("member+updated@example.com");
    expect(updated?.firstName).toBe("Updated");
    expect(db.getTable("user")).toHaveLength(2);
  });

  it("enforces identity checks and admin boundaries", async () => {
    const db = createInMemoryDb(baseSeed());

    const syncUserFromClerk = handler<
      { clerkUserId: string; email: string },
      unknown
    >(usersModule.syncUserFromClerk);
    const getUserByClerkId = handler<{ clerkUserId: string }, unknown>(
      usersModule.getUserByClerkId,
    );
    const listUsers = handler<Record<string, never>, unknown[]>(
      usersModule.listUsers,
    );

    await expect(
      syncUserFromClerk(createAuthCtx(db, "clerk_member_001"), {
        clerkUserId: "clerk_admin_001",
        email: "x@example.com",
      }),
    ).rejects.toThrow("Forbidden: identity mismatch");

    await expect(
      getUserByClerkId(createAuthCtx(db, "clerk_member_001"), {
        clerkUserId: "clerk_admin_001",
      }),
    ).rejects.toThrow("Forbidden");

    await expect(
      listUsers(createAuthCtx(db, "clerk_member_001"), {}),
    ).rejects.toThrow("Forbidden");

    const adminUsers = await listUsers(
      createAuthCtx(db, "clerk_admin_001"),
      {},
    );
    expect(adminUsers).toHaveLength(2);
  });

  it("supports bootstrap admin and admin status updates", async () => {
    const db = createInMemoryDb(baseSeed());

    const bootstrapMakeMeAdmin = handler<
      Record<string, never>,
      { success: boolean }
    >(usersModule.bootstrapMakeMeAdmin);
    const setUserAdminStatus = handler<
      { clerkUserId: string; isAdmin: boolean },
      { success: boolean }
    >(usersModule.setUserAdminStatus);

    await expect(
      setUserAdminStatus(createAuthCtx(db, "clerk_member_001"), {
        clerkUserId: "clerk_admin_001",
        isAdmin: false,
      }),
    ).rejects.toThrow("Forbidden");

    const bootstrapResult = await bootstrapMakeMeAdmin(
      createAuthCtx(db, "clerk_member_001"),
      {},
    );
    expect(bootstrapResult.success).toBe(true);

    const promoted = await db
      .query("user")
      .withIndex("by_clerkUserId", (q) =>
        q.eq("clerkUserId", "clerk_member_001"),
      )
      .unique();
    expect(promoted?.isAdmin).toBe(true);

    const result = await setUserAdminStatus(
      createAuthCtx(db, "clerk_admin_001"),
      {
        clerkUserId: "clerk_member_001",
        isAdmin: false,
      },
    );

    expect(result.success).toBe(true);
  });

  it("deletes user cascade data by Clerk id and remains idempotent", async () => {
    const targetUserId = "user_target_001" as Id<"user">;
    const targetMemoryId = "memory_target_001" as Id<"memories">;

    const db = createInMemoryDb({
      ...baseSeed(),
      user: [
        ...baseSeed().user,
        {
          _id: targetUserId,
          _creationTime: 3,
          clerkUserId: "clerk_target_001",
          email: "target@example.com",
          isAdmin: false,
        },
      ],
      memories: [
        {
          _id: targetMemoryId,
          _creationTime: 4,
          userId: targetUserId,
          title: "Memory",
          happenedAt: 1,
          dayKey: "2026-04-01",
        },
      ],
      memoryMedia: [
        {
          _id: "media_target_001",
          _creationTime: 5,
          memoryId: targetMemoryId,
          userId: targetUserId,
          storageId: "storage_target_001",
          type: "image",
        },
      ],
      days: [
        {
          _id: "day_target_001",
          _creationTime: 6,
          userId: targetUserId,
          dayKey: "2026-04-01",
          rating: 4,
        },
      ],
      daySummaries: [
        {
          _id: "summary_target_001",
          _creationTime: 7,
          userId: targetUserId,
          dayKey: "2026-04-01",
          story: "Story",
          highlights: [],
          sourcesUsed: [],
          generatedAt: 1,
        },
      ],
      integrations: [
        {
          _id: "integration_target_001",
          _creationTime: 8,
          userId: targetUserId,
          provider: "spotify",
          status: "connected",
        },
      ],
      integrationDailyData: [
        {
          _id: "dailydata_target_001",
          _creationTime: 9,
          userId: targetUserId,
          provider: "spotify",
          dayKey: "2026-04-01",
          syncedAt: 1,
        },
      ],
      integrationSecrets: [
        {
          _id: "secret_target_001",
          _creationTime: 10,
          userId: targetUserId,
          provider: "spotify",
          tokenRef: "tokref_target_001",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      integrationSyncRuns: [
        {
          _id: "sync_target_001",
          _creationTime: 11,
          userId: targetUserId,
          provider: "spotify",
          dayKey: "2026-04-01",
          status: "success",
          startedAt: 1,
          updatedAt: 1,
        },
      ],
      userPreferences: [
        {
          _id: "pref_target_001",
          _creationTime: 12,
          clerkUserId: "clerk_target_001",
          focusAreas: [0],
          reminderType: "daily",
          dailyTime: "09:00",
          weeklyDay: "monday",
          formattedTime: "9:00 AM",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      auditLogs: [
        {
          _id: "audit_target_001",
          _creationTime: 13,
          actorUserId: targetUserId,
          action: "test",
          at: 1,
        },
      ],
      summaryGenerationQuotas: [
        {
          _id: "quota_target_001",
          _creationTime: 14,
          userId: targetUserId,
          quotaDayKey: "2026-04-01",
          used: 1,
          updatedAt: 1,
        },
      ],
    });

    const storageDelete = vi.fn(async () => undefined);
    const deleteUserAndRelatedDataByClerkId = handler<
      { clerkUserId: string },
      { success: boolean; deleted: boolean }
    >(usersModule.deleteUserAndRelatedDataByClerkId);

    const ctx = {
      ...createAuthCtx(db, "clerk_admin_001"),
      storage: {
        delete: storageDelete,
      },
    };

    const first = await deleteUserAndRelatedDataByClerkId(ctx, {
      clerkUserId: "clerk_target_001",
    });

    expect(first).toEqual({ success: true, deleted: true });
    expect(storageDelete).toHaveBeenCalledTimes(1);
    expect(db.getTable("user").map((row) => row._id)).not.toContain(
      targetUserId,
    );
    expect(db.getTable("memories")).toHaveLength(0);
    expect(db.getTable("days")).toHaveLength(0);
    expect(db.getTable("daySummaries")).toHaveLength(0);
    expect(db.getTable("integrations")).toHaveLength(0);
    expect(db.getTable("integrationDailyData")).toHaveLength(0);
    expect(db.getTable("integrationSecrets")).toHaveLength(0);
    expect(db.getTable("integrationSyncRuns")).toHaveLength(0);
    expect(db.getTable("userPreferences")).toHaveLength(0);
    expect(db.getTable("auditLogs")).toHaveLength(0);
    expect(db.getTable("summaryGenerationQuotas")).toHaveLength(0);

    const second = await deleteUserAndRelatedDataByClerkId(ctx, {
      clerkUserId: "clerk_target_001",
    });

    expect(second).toEqual({ success: true, deleted: false });
  });
});
