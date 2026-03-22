import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addMemoryMedia,
  createMemory,
  deleteMemory,
  generateMemoryMediaUploadUrl,
  listMemoryMedia,
} from "./memories";
import {
  DAILY_SUMMARY_GENERATION_LIMIT,
  getSummaryQuotaForDay,
  reserveSummaryGenerationSlot,
} from "./summaries";
import { listAllUsers } from "./admin";

type TableName =
  | "user"
  | "memories"
  | "memoryMedia"
  | "summaryGenerationQuotas"
  | "daySummaries"
  | "days"
  | "integrations"
  | "auditLogs"
  | "userPreferences";

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
      filters.every(({ field, value }) => String(row[field]) === String(value)),
    );

    return new InMemoryQuery(filtered);
  }

  order(direction: "asc" | "desc") {
    const sorted = [...this.rows].sort((a, b) => {
      const sortField = ["happenedAt", "generatedAt", "updatedAt"].find(
        (field) => field in a || field in b,
      );

      const aValue = sortField ? Number(a[sortField] ?? 0) : a._creationTime;
      const bValue = sortField ? Number(b[sortField] ?? 0) : b._creationTime;
      return direction === "asc" ? aValue - bValue : bValue - aValue;
    });

    return new InMemoryQuery(sorted);
  }

  async collect() {
    return [...this.rows];
  }

  async unique() {
    if (this.rows.length > 1) {
      throw new Error("unique() received multiple rows");
    }
    return this.rows[0] ?? null;
  }

  async take(limit: number) {
    return this.rows.slice(0, limit);
  }
}

class InMemoryDb {
  private tables = new Map<TableName, Map<string, StoredDoc>>();
  private counters = new Map<TableName, number>();

  constructor() {
    const tableNames: TableName[] = [
      "user",
      "memories",
      "memoryMedia",
      "summaryGenerationQuotas",
      "daySummaries",
      "days",
      "integrations",
      "auditLogs",
      "userPreferences",
    ];

    for (const tableName of tableNames) {
      this.tables.set(tableName, new Map<string, StoredDoc>());
      this.counters.set(tableName, 0);
    }
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
    const rows = this.tables.get(table as TableName);
    return rows?.get(id) ?? null;
  }

  async patch(id: string, updates: Record<string, unknown>) {
    const row = await this.get(id);
    if (!row) {
      throw new Error(`Cannot patch missing row: ${id}`);
    }

    Object.assign(row, updates);
  }

  async delete(id: string) {
    const [table] = id.split(":");
    const rows = this.tables.get(table as TableName);
    rows?.delete(id);
  }

  query(table: TableName) {
    const rows = Array.from(this.tables.get(table)?.values() ?? []);
    return new InMemoryQuery(rows);
  }

  async list(table: TableName) {
    return this.query(table).collect();
  }
}

class InMemoryStorage {
  readonly deleted: string[] = [];

  async generateUploadUrl() {
    return "https://upload.local/memory";
  }

  async getUrl(storageId: string) {
    return `https://cdn.local/${storageId}`;
  }

  async delete(storageId: string) {
    this.deleted.push(String(storageId));
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

function createCtx(params: {
  db: InMemoryDb;
  storage: InMemoryStorage;
  subject: string | null;
}) {
  return {
    db: params.db,
    storage: params.storage,
    auth: {
      getUserIdentity: async () =>
        params.subject ? { subject: params.subject } : null,
    },
    runQuery: async () => {
      throw new Error("runQuery is not implemented for this test harness");
    },
    runMutation: async () => {
      throw new Error("runMutation is not implemented for this test harness");
    },
  };
}

async function seedUser(
  db: InMemoryDb,
  args: {
    clerkUserId: string;
    email: string;
    isAdmin?: boolean;
  },
) {
  return db.insert("user", {
    clerkUserId: args.clerkUserId,
    email: args.email,
    isAdmin: args.isAdmin ?? false,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("backend behavior: memory media flow", () => {
  it("creates a memory, attaches media, lists media, and cascades media cleanup on delete", async () => {
    const db = new InMemoryDb();
    const storage = new InMemoryStorage();

    const ownerId = await seedUser(db, {
      clerkUserId: "clerk_owner",
      email: "owner@test.dev",
    });
    await seedUser(db, {
      clerkUserId: "clerk_other",
      email: "other@test.dev",
    });

    const ownerCtx = createCtx({ db, storage, subject: "clerk_owner" });
    const otherCtx = createCtx({ db, storage, subject: "clerk_other" });

    const create = getHandler<
      {
        title: string;
        description?: string;
        mood?: string;
        happenedAt: number;
        dayKey: string;
      },
      StoredDoc | null
    >(createMemory);
    const memory = await create(ownerCtx, {
      title: "Morning run",
      happenedAt: 1_738_800_000_000,
      dayKey: "2025-02-10",
    });

    expect(memory).not.toBeNull();
    expect(memory?.userId).toBe(ownerId);

    const addMedia = getHandler<
      {
        memoryId: string;
        storageId: string;
        type: "image" | "video";
      },
      StoredDoc | null
    >(addMemoryMedia);

    const media = await addMedia(ownerCtx, {
      memoryId: String(memory?._id),
      storageId: "storage-image-1",
      type: "image",
    });

    expect(media).not.toBeNull();

    const listMedia = getHandler<
      { memoryId: string },
      Array<StoredDoc & { url: string | null }>
    >(listMemoryMedia);

    const ownerMedia = await listMedia(ownerCtx, {
      memoryId: String(memory?._id),
    });
    expect(ownerMedia).toHaveLength(1);
    expect(ownerMedia[0]?.url).toBe("https://cdn.local/storage-image-1");

    await expect(
      listMedia(otherCtx, {
        memoryId: String(memory?._id),
      }),
    ).rejects.toThrow("Forbidden: you do not own this resource");

    const removeMemory = getHandler<{ memoryId: string }, { success: boolean }>(
      deleteMemory,
    );
    await expect(
      removeMemory(ownerCtx, { memoryId: String(memory?._id) }),
    ).resolves.toEqual({ success: true });

    expect(await db.get(String(memory?._id))).toBeNull();
    expect(await db.get(String(media?._id))).toBeNull();
    expect(storage.deleted).toContain("storage-image-1");
  });
});

describe("backend behavior: authz failures", () => {
  it("rejects anonymous callers and unknown signed-in users", async () => {
    const db = new InMemoryDb();
    const storage = new InMemoryStorage();

    const anonymousCtx = createCtx({ db, storage, subject: null });
    const unknownUserCtx = createCtx({ db, storage, subject: "clerk_missing" });

    const uploadUrl = getHandler<Record<string, never>, { uploadUrl: string }>(
      generateMemoryMediaUploadUrl,
    );
    await expect(uploadUrl(anonymousCtx, {})).rejects.toThrow(
      "Unauthorized: not signed in",
    );

    const create = getHandler<
      {
        title: string;
        happenedAt: number;
        dayKey: string;
      },
      StoredDoc | null
    >(createMemory);

    await expect(
      create(unknownUserCtx, {
        title: "No user row",
        happenedAt: 1_738_800_000_000,
        dayKey: "2025-02-10",
      }),
    ).rejects.toThrow(
      "Unauthorized: user record not found — sign in once to create it",
    );
  });

  it("rejects cross-user media attachment and non-admin access to admin queries", async () => {
    const db = new InMemoryDb();
    const storage = new InMemoryStorage();

    await seedUser(db, { clerkUserId: "clerk_owner", email: "owner@test.dev" });
    await seedUser(db, { clerkUserId: "clerk_other", email: "other@test.dev" });

    const ownerCtx = createCtx({ db, storage, subject: "clerk_owner" });
    const otherCtx = createCtx({ db, storage, subject: "clerk_other" });

    const create = getHandler<
      {
        title: string;
        happenedAt: number;
        dayKey: string;
      },
      StoredDoc | null
    >(createMemory);
    const memory = await create(ownerCtx, {
      title: "Private memory",
      happenedAt: 1_738_800_000_000,
      dayKey: "2025-02-10",
    });

    const addMedia = getHandler<
      { memoryId: string; storageId: string; type: "image" | "video" },
      StoredDoc | null
    >(addMemoryMedia);

    await expect(
      addMedia(otherCtx, {
        memoryId: String(memory?._id),
        storageId: "forbidden-media",
        type: "image",
      }),
    ).rejects.toThrow("Forbidden: you do not own this resource");

    const listUsers = getHandler<Record<string, never>, StoredDoc[]>(
      listAllUsers,
    );
    await expect(listUsers(ownerCtx, {})).rejects.toThrow(
      "Forbidden: admin access required",
    );
  });
});

describe("backend behavior: summary quota edges", () => {
  it("enforces daily quota limits and resets usage on a new UTC day", async () => {
    const db = new InMemoryDb();
    const storage = new InMemoryStorage();

    await seedUser(db, { clerkUserId: "clerk_quota", email: "quota@test.dev" });

    const ctx = createCtx({ db, storage, subject: "clerk_quota" });
    const reserve = getHandler<
      Record<string, never>,
      {
        quotaDayKey: string;
        used: number;
        limit: number;
        remaining: number;
      }
    >(reserveSummaryGenerationSlot);
    const getQuota = getHandler<
      Record<string, never>,
      { quotaDayKey: string; used: number; limit: number; remaining: number }
    >(getSummaryQuotaForDay);

    const nowSpy = vi.spyOn(Date, "now");

    nowSpy.mockReturnValue(new Date("2025-02-10T12:00:00.000Z").getTime());
    for (let i = 1; i <= DAILY_SUMMARY_GENERATION_LIMIT; i += 1) {
      const reserved = await reserve(ctx, {});
      expect(reserved.used).toBe(i);
      expect(reserved.remaining).toBe(DAILY_SUMMARY_GENERATION_LIMIT - i);
    }

    await expect(reserve(ctx, {})).rejects.toThrow(
      "Daily summary limit reached (5/day). Please try again tomorrow.",
    );

    const dayOneQuota = await getQuota(ctx, {});
    expect(dayOneQuota.used).toBe(DAILY_SUMMARY_GENERATION_LIMIT);
    expect(dayOneQuota.remaining).toBe(0);

    nowSpy.mockReturnValue(new Date("2025-02-11T00:00:01.000Z").getTime());

    const dayTwoQuotaBeforeReserve = await getQuota(ctx, {});
    expect(dayTwoQuotaBeforeReserve.used).toBe(0);
    expect(dayTwoQuotaBeforeReserve.remaining).toBe(
      DAILY_SUMMARY_GENERATION_LIMIT,
    );

    const dayTwoReserved = await reserve(ctx, {});
    expect(dayTwoReserved.used).toBe(1);
    expect(dayTwoReserved.remaining).toBe(DAILY_SUMMARY_GENERATION_LIMIT - 1);

    const quotaRows = await db.list("summaryGenerationQuotas");
    expect(quotaRows).toHaveLength(2);
  });
});
