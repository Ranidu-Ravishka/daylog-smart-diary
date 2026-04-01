import { describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import { listAuditLogsPaginatedImpl } from "./admin";
import {
  createAuthCtx,
  createInMemoryDb,
  type InMemoryDb,
} from "../test-utils/inMemoryConvex";

const ADMIN_USER_ID = "user_admin_001" as Id<"user">;
const MEMBER_USER_ID = "user_member_001" as Id<"user">;
const OTHER_USER_ID = "user_other_001" as Id<"user">;

const BASE_TS = 1_700_000_000_000;

type AuditLogShape = {
  _id: string;
  at: number;
  action: string;
  actorUserId: string;
};

function seedAuditDb(): {
  db: InMemoryDb;
  ctx: ReturnType<typeof createAuthCtx>;
} {
  const auditLogs: Array<Record<string, unknown>> = [];

  for (let index = 0; index < 72; index += 1) {
    const at = BASE_TS + Math.floor(index / 3);
    const action =
      index % 3 === 0
        ? "create_user"
        : index % 3 === 1
          ? "update_role"
          : "delete_user";
    const actorUserId = index % 2 === 0 ? MEMBER_USER_ID : OTHER_USER_ID;

    auditLogs.push({
      _id: `audit_${String(index).padStart(3, "0")}`,
      _creationTime: at,
      action,
      actorUserId,
      targetType: "user",
      targetId: `target_${index}`,
      details: { index },
      at,
    });
  }

  const db = createInMemoryDb({
    user: [
      {
        _id: ADMIN_USER_ID,
        _creationTime: 1,
        clerkUserId: "clerk_admin_001",
        isAdmin: true,
      },
      {
        _id: MEMBER_USER_ID,
        _creationTime: 2,
        clerkUserId: "clerk_member_001",
        isAdmin: false,
      },
      {
        _id: OTHER_USER_ID,
        _creationTime: 3,
        clerkUserId: "clerk_other_001",
        isAdmin: false,
      },
    ],
    auditLogs: auditLogs as never,
  });

  return {
    db,
    ctx: createAuthCtx(db, "clerk_admin_001"),
  };
}

function toComparableRows(db: InMemoryDb): AuditLogShape[] {
  return db.getTable("auditLogs") as unknown as AuditLogShape[];
}

function sortByAtThenIdDesc(rows: AuditLogShape[]): AuditLogShape[] {
  return [...rows].sort((left, right) => {
    if (left.at !== right.at) return right.at - left.at;
    return right._id.localeCompare(left._id);
  });
}

async function collectAllPages(
  ctx: ReturnType<typeof createAuthCtx>,
  filters: {
    action?: string;
    userId?: Id<"user">;
    fromTs?: number;
    toTs?: number;
  },
): Promise<AuditLogShape[]> {
  const all: AuditLogShape[] = [];
  let cursor: string | null = null;

  for (let guard = 0; guard < 50; guard += 1) {
    const page = await listAuditLogsPaginatedImpl(ctx as never, {
      paginationOpts: {
        numItems: 5,
        cursor,
      },
      ...filters,
    });

    all.push(...(page.page as unknown as AuditLogShape[]));

    if (page.isDone) break;
    cursor = page.continueCursor;
  }

  return all;
}

async function collectAllPagesByActorAlias(
  ctx: ReturnType<typeof createAuthCtx>,
  filters: {
    action?: string;
    actorUserId?: Id<"user">;
    fromTs?: number;
    toTs?: number;
  },
): Promise<AuditLogShape[]> {
  const all: AuditLogShape[] = [];
  let cursor: string | null = null;

  for (let guard = 0; guard < 50; guard += 1) {
    const page = await listAuditLogsPaginatedImpl(ctx as never, {
      paginationOpts: {
        numItems: 5,
        cursor,
      },
      ...filters,
    });

    all.push(...(page.page as unknown as AuditLogShape[]));

    if (page.isDone) break;
    cursor = page.continueCursor;
  }

  return all;
}

describe("audit log pagination behavior", () => {
  it("keeps strict continuity with combined action, user, and date filters", async () => {
    const { db, ctx } = seedAuditDb();

    const filters = {
      action: "create_user",
      userId: MEMBER_USER_ID,
      fromTs: BASE_TS + 4,
      toTs: BASE_TS + 18,
    };

    const actual = await collectAllPages(ctx, filters);
    const expected = sortByAtThenIdDesc(
      toComparableRows(db).filter(
        (row) =>
          row.action === filters.action &&
          row.actorUserId === filters.userId &&
          row.at >= filters.fromTs &&
          row.at <= filters.toTs,
      ),
    );

    expect(actual.map((item) => item._id)).toEqual(
      expected.map((item) => item._id),
    );
    expect(new Set(actual.map((item) => item._id)).size).toBe(actual.length);
  });

  it("preserves continuity for every filter mode", async () => {
    const { db, ctx } = seedAuditDb();

    const cases: Array<{
      name: string;
      filters: {
        action?: string;
        userId?: Id<"user">;
        fromTs?: number;
        toTs?: number;
      };
    }> = [
      { name: "no filters", filters: {} },
      { name: "action only", filters: { action: "update_role" } },
      { name: "user only", filters: { userId: MEMBER_USER_ID } },
      {
        name: "date only",
        filters: { fromTs: BASE_TS + 8, toTs: BASE_TS + 12 },
      },
      {
        name: "action + user",
        filters: { action: "delete_user", userId: OTHER_USER_ID },
      },
      {
        name: "action + date",
        filters: {
          action: "create_user",
          fromTs: BASE_TS + 3,
          toTs: BASE_TS + 16,
        },
      },
      {
        name: "user + date",
        filters: {
          userId: MEMBER_USER_ID,
          fromTs: BASE_TS + 1,
          toTs: BASE_TS + 10,
        },
      },
    ];

    const source = toComparableRows(db);

    for (const testCase of cases) {
      const actual = await collectAllPages(ctx, testCase.filters);
      const expected = sortByAtThenIdDesc(
        source.filter((row) => {
          if (testCase.filters.action && row.action !== testCase.filters.action)
            return false;
          if (
            testCase.filters.userId &&
            row.actorUserId !== testCase.filters.userId
          )
            return false;
          if (
            testCase.filters.fromTs !== undefined &&
            row.at < testCase.filters.fromTs
          )
            return false;
          if (
            testCase.filters.toTs !== undefined &&
            row.at > testCase.filters.toTs
          )
            return false;
          return true;
        }),
      );

      expect(
        actual.map((item) => item._id),
        `cursor continuity mismatch for ${testCase.name}`,
      ).toEqual(expected.map((item) => item._id));
      expect(new Set(actual.map((item) => item._id)).size).toBe(actual.length);
    }
  });

  it("returns empty deterministic result for non-matching filters", async () => {
    const { ctx } = seedAuditDb();

    const page = await listAuditLogsPaginatedImpl(ctx as never, {
      paginationOpts: { numItems: 10, cursor: null },
      action: "non_existent_action",
    });

    expect(page.page).toHaveLength(0);
    expect(page.isDone).toBe(true);
    expect(page.continueCursor).toBeNull();
  });

  it("keeps userId and actorUserId alias filters behaviorally equivalent", async () => {
    const { ctx } = seedAuditDb();

    const viaUserId = await collectAllPages(ctx, {
      userId: MEMBER_USER_ID,
      action: "update_role",
      fromTs: BASE_TS + 2,
      toTs: BASE_TS + 20,
    });

    const viaActorAlias = await collectAllPagesByActorAlias(ctx, {
      actorUserId: MEMBER_USER_ID,
      action: "update_role",
      fromTs: BASE_TS + 2,
      toTs: BASE_TS + 20,
    });

    expect(viaActorAlias.map((item) => item._id)).toEqual(
      viaUserId.map((item) => item._id),
    );
  });

  it("rejects inverted time ranges to prevent inconsistent pagination windows", async () => {
    const { ctx } = seedAuditDb();

    await expect(
      listAuditLogsPaginatedImpl(ctx as never, {
        paginationOpts: { numItems: 10, cursor: null },
        fromTs: BASE_TS + 50,
        toTs: BASE_TS + 10,
      }),
    ).rejects.toThrow("fromTs must be less than or equal to toTs");
  });
});
