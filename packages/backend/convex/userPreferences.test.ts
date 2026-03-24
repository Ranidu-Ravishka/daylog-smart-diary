import { describe, expect, it } from "vitest";
import {
  getMyUserPreferences,
  getUserPreferencesByClerkId,
  listUserPreferences,
  syncMyUserPreferences,
} from "./userPreferences";

type TableName = "user" | "userPreferences";

type StoredDoc = {
  _id: string;
  _creationTime: number;
} & Record<string, unknown>;

class InMemoryQuery {
  constructor(private rows: StoredDoc[]) {}

  withIndex(
    _indexName: string,
    applyFilters: (q: {
      eq: (field: string, value: unknown) => unknown;
    }) => unknown,
  ) {
    const filters: Array<{ field: string; value: unknown }> = [];
    const q = {
      eq: (field: string, value: unknown) => {
        filters.push({ field, value });
        return q;
      },
    };
    applyFilters(q);

    const filtered = this.rows.filter((row) =>
      filters.every(({ field, value }) => row[field] === value),
    );

    return new InMemoryQuery(filtered);
  }

  async unique() {
    if (this.rows.length > 1) {
      throw new Error("unique() received multiple rows");
    }
    return this.rows[0] ?? null;
  }

  async collect() {
    return [...this.rows];
  }
}

class InMemoryDb {
  private tables = new Map<TableName, Map<string, StoredDoc>>();
  private counters = new Map<TableName, number>();

  constructor() {
    this.tables.set("user", new Map());
    this.tables.set("userPreferences", new Map());
    this.counters.set("user", 0);
    this.counters.set("userPreferences", 0);
  }

  async insert(table: TableName, value: Record<string, unknown>) {
    const next = (this.counters.get(table) ?? 0) + 1;
    this.counters.set(table, next);

    const id = `${table}:${next}`;
    const row: StoredDoc = {
      _id: id,
      _creationTime: Date.now(),
      ...value,
    };

    this.tables.get(table)?.set(id, row);
    return id;
  }

  async get(id: string) {
    const [table] = id.split(":");
    return this.tables.get(table as TableName)?.get(id) ?? null;
  }

  async patch(id: string, updates: Record<string, unknown>) {
    const row = await this.get(id);
    if (!row) throw new Error(`Cannot patch missing row: ${id}`);
    Object.assign(row, updates);
  }

  query(table: TableName) {
    return new InMemoryQuery(
      Array.from(this.tables.get(table)?.values() ?? []),
    );
  }
}

function getHandler<TArgs extends Record<string, unknown>, TResult>(
  fn: unknown,
): (ctx: Record<string, unknown>, args: TArgs) => Promise<TResult> {
  const handler = (fn as { _handler?: unknown })._handler;
  if (typeof handler !== "function") {
    throw new Error("Convex function handler not found");
  }
  return handler as (
    ctx: Record<string, unknown>,
    args: TArgs,
  ) => Promise<TResult>;
}

function createCtx(params: { db: InMemoryDb; subject: string | null }) {
  return {
    db: params.db,
    auth: {
      getUserIdentity: async () =>
        params.subject ? { subject: params.subject } : null,
    },
  };
}

async function seedUser(
  db: InMemoryDb,
  args: { clerkUserId: string; email: string; isAdmin?: boolean },
) {
  return db.insert("user", {
    clerkUserId: args.clerkUserId,
    email: args.email,
    isAdmin: args.isAdmin ?? false,
  });
}

describe("user preferences focus area normalization", () => {
  it("normalizes focus areas on write in syncMyUserPreferences", async () => {
    const db = new InMemoryDb();
    await seedUser(db, {
      clerkUserId: "clerk_user",
      email: "user@test.dev",
    });

    const syncHandler = getHandler<
      {
        focusAreas: number[];
        reminderType: "daily" | "weekly";
        dailyTime: string;
        weeklyDay: string;
        formattedTime: string;
      },
      { focusAreas: number[] }
    >(syncMyUserPreferences);

    const result = await syncHandler(createCtx({ db, subject: "clerk_user" }), {
      focusAreas: [5, 2, 5, 999, -1, 0],
      reminderType: "daily",
      dailyTime: new Date().toISOString(),
      weeklyDay: "Sunday",
      formattedTime: "8:00 PM",
    });

    expect(result.focusAreas).toEqual([4, 2, 0]);
  });

  it("normalizes focus areas when reading getMyUserPreferences", async () => {
    const db = new InMemoryDb();
    await seedUser(db, {
      clerkUserId: "clerk_user",
      email: "user@test.dev",
    });

    await db.insert("userPreferences", {
      clerkUserId: "clerk_user",
      focusAreas: [5, 5, 3, 99],
      reminderType: "weekly",
      dailyTime: new Date().toISOString(),
      weeklyDay: "Monday",
      formattedTime: "9:00 AM",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const getMineHandler = getHandler<
      Record<string, never>,
      { focusAreas: number[] } | null
    >(getMyUserPreferences);

    const result = await getMineHandler(
      createCtx({ db, subject: "clerk_user" }),
      {},
    );
    expect(result?.focusAreas).toEqual([4, 3]);
  });

  it("normalizes focus areas for admin read queries", async () => {
    const db = new InMemoryDb();
    await seedUser(db, {
      clerkUserId: "clerk_admin",
      email: "admin@test.dev",
      isAdmin: true,
    });

    await db.insert("userPreferences", {
      clerkUserId: "clerk_target",
      focusAreas: [1, 5, 1, 42],
      reminderType: "daily",
      dailyTime: new Date().toISOString(),
      weeklyDay: "Tuesday",
      formattedTime: "7:00 AM",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const getByClerkHandler = getHandler<
      { clerkUserId: string },
      { focusAreas: number[] } | null
    >(getUserPreferencesByClerkId);
    const listHandler = getHandler<
      Record<string, never>,
      Array<{ focusAreas: number[] }>
    >(listUserPreferences);

    const byClerk = await getByClerkHandler(
      createCtx({ db, subject: "clerk_admin" }),
      { clerkUserId: "clerk_target" },
    );
    const all = await listHandler(
      createCtx({ db, subject: "clerk_admin" }),
      {},
    );

    expect(byClerk?.focusAreas).toEqual([1, 4]);
    expect(all[0]?.focusAreas).toEqual([1, 4]);
  });

  it("blocks non-admin users from admin preference queries", async () => {
    const db = new InMemoryDb();
    await seedUser(db, {
      clerkUserId: "clerk_non_admin",
      email: "user@test.dev",
      isAdmin: false,
    });

    const getByClerkHandler = getHandler<
      { clerkUserId: string },
      { focusAreas: number[] } | null
    >(getUserPreferencesByClerkId);
    const listHandler = getHandler<
      Record<string, never>,
      Array<{ focusAreas: number[] }>
    >(listUserPreferences);

    await expect(
      getByClerkHandler(createCtx({ db, subject: "clerk_non_admin" }), {
        clerkUserId: "clerk_non_admin",
      }),
    ).rejects.toThrow("Forbidden: admin access required");

    await expect(
      listHandler(createCtx({ db, subject: "clerk_non_admin" }), {}),
    ).rejects.toThrow("Forbidden: admin access required");
  });
});
