import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addMemoryMedia,
  createMemory,
  deleteMemory,
  generateMemoryMediaUploadUrl,
  listMemoryMedia,
} from "./memories";
import {
  syncAllMyIntegrationsForDay,
  syncMyIntegrationForDay,
} from "./integrations";
import {
  listAllUsers,
  listAuditLogsPaginated,
  listIntegrationsPaginated,
} from "./admin";
import {
  DAILY_SUMMARY_GENERATION_LIMIT,
  getSummaryQuotaForDay,
  reserveSummaryGenerationSlot,
} from "./summaries";

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

  async paginate(args: { numItems: number; cursor?: string | null }) {
    const start = args.cursor ? Number(args.cursor) : 0;
    const end = Math.min(start + args.numItems, this.rows.length);
    const page = this.rows.slice(start, end);

    return {
      page,
      isDone: end >= this.rows.length,
      continueCursor: String(end),
      splitCursor: null,
      pageStatus: null,
    };
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

describe("backend behavior: admin pagination and filters", () => {
  it("paginates integrations and applies status filter with stable cursors", async () => {
    const db = new InMemoryDb();
    const storage = new InMemoryStorage();

    const adminUserId = await seedUser(db, {
      clerkUserId: "clerk_admin",
      email: "admin@test.dev",
      isAdmin: true,
    });
    const memberId = await seedUser(db, {
      clerkUserId: "clerk_member",
      email: "member@test.dev",
    });

    await db.insert("integrations", {
      userId: memberId,
      provider: "calendar",
      status: "connected",
      scopes: ["read"],
    });
    await db.insert("integrations", {
      userId: memberId,
      provider: "health",
      status: "connected",
      scopes: ["read"],
    });
    await db.insert("integrations", {
      userId: memberId,
      provider: "banking",
      status: "error",
      scopes: ["read"],
    });

    const adminCtx = createCtx({ db, storage, subject: "clerk_admin" });
    const memberCtx = createCtx({ db, storage, subject: "clerk_member" });

    const listPaginatedIntegrations = getHandler<
      {
        paginationOpts: { numItems: number; cursor?: string | null };
        status?: "connected" | "disconnected" | "error";
      },
      { page: StoredDoc[]; continueCursor: string; isDone: boolean }
    >(listIntegrationsPaginated);

    const firstPage = await listPaginatedIntegrations(adminCtx, {
      status: "connected",
      paginationOpts: { numItems: 1, cursor: null },
    });

    expect(firstPage.page).toHaveLength(1);
    expect(firstPage.page[0]?.status).toBe("connected");
    expect(firstPage.isDone).toBe(false);

    const secondPage = await listPaginatedIntegrations(adminCtx, {
      status: "connected",
      paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
    });

    expect(secondPage.page).toHaveLength(1);
    expect(secondPage.page[0]?.status).toBe("connected");

    await expect(
      listPaginatedIntegrations(memberCtx, {
        status: "connected",
        paginationOpts: { numItems: 1, cursor: null },
      }),
    ).rejects.toThrow("Forbidden: admin access required");

    expect(String(adminUserId)).toContain("user:");
  });

  it("applies audit log filters and returns empty pages when no match exists", async () => {
    const db = new InMemoryDb();
    const storage = new InMemoryStorage();

    const adminUserId = await seedUser(db, {
      clerkUserId: "clerk_admin",
      email: "admin@test.dev",
      isAdmin: true,
    });

    await db.insert("auditLogs", {
      actorUserId: adminUserId,
      action: "create_user",
      target: "user-a",
      at: new Date("2025-03-01T10:00:00.000Z").getTime(),
    });
    await db.insert("auditLogs", {
      actorUserId: adminUserId,
      action: "delete_user",
      target: "user-b",
      at: new Date("2025-03-02T10:00:00.000Z").getTime(),
    });

    const adminCtx = createCtx({ db, storage, subject: "clerk_admin" });

    const listPaginatedAuditLogs = getHandler<
      {
        paginationOpts: { numItems: number; cursor?: string | null };
        actorUserId?: string;
        action?: string;
        fromTs?: number;
        toTs?: number;
      },
      { page: StoredDoc[] }
    >(listAuditLogsPaginated);

    const filtered = await listPaginatedAuditLogs(adminCtx, {
      action: "delete_user",
      fromTs: new Date("2025-03-02T00:00:00.000Z").getTime(),
      toTs: new Date("2025-03-02T23:59:59.999Z").getTime(),
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(filtered.page).toHaveLength(1);
    expect(filtered.page[0]?.action).toBe("delete_user");

    const empty = await listPaginatedAuditLogs(adminCtx, {
      action: "update_summary",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(empty.page).toHaveLength(0);
  });
});

describe("backend behavior: integration sync actions", () => {
  it("marks integration error when provider token is missing", async () => {
    const syncOne = getHandler<
      { provider: string; dayKey: string },
      { success: boolean; provider: string; dayKey: string }
    >(syncMyIntegrationForDay);

    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ shouldSync: true, reason: "ready" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const ctx = {
      runQuery: vi.fn().mockResolvedValueOnce({
        _id: "integrations:1",
        userId: "user:1",
        status: "connected",
      }),
      runMutation,
      runAction: vi.fn(),
    };

    await expect(
      syncOne(ctx, { provider: "spotify", dayKey: "2025-03-10" }),
    ).rejects.toThrow(
      'Provider "spotify" is missing tokenRef. Reconnect integration before syncing.',
    );

    expect(runMutation).toHaveBeenCalledTimes(3);
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      integrationId: "integrations:1",
      reason: expect.stringContaining("missing tokenRef"),
    });
    expect(runMutation.mock.calls[2]?.[1]).toMatchObject({
      userId: "user:1",
      provider: "spotify",
      dayKey: "2025-03-10",
      status: "error",
    });
  });

  it("syncs only supported connected providers and returns per-provider outcomes", async () => {
    const syncAll = getHandler<
      { dayKey: string },
      {
        dayKey: string;
        results: Array<{
          provider: string;
          success: boolean;
          message?: string;
        }>;
      }
    >(syncAllMyIntegrationsForDay);

    const runAction = vi.fn(
      async (_ref: unknown, args: { provider: string }) => {
        if (args.provider === "google_calendar") {
          throw new Error("calendar api timeout");
        }
        return { success: true };
      },
    );

    const ctx = {
      runQuery: vi.fn().mockResolvedValue([
        { provider: "spotify", status: "connected" },
        { provider: "google_calendar", status: "connected" },
        { provider: "google_fit", status: "disconnected" },
        { provider: "banking", status: "connected" },
      ]),
      runMutation: vi.fn(),
      runAction,
    };

    const result = await syncAll(ctx, { dayKey: "2025-03-10" });

    expect(result.dayKey).toBe("2025-03-10");
    expect(result.results).toEqual([
      { provider: "spotify", success: true },
      {
        provider: "google_calendar",
        success: false,
        message: "calendar api timeout",
      },
    ]);
    expect(runAction).toHaveBeenCalledTimes(2);
  });
});
