type Primitive = string | number | boolean | null | undefined;

type Condition = {
  op: "eq" | "gte" | "lte" | "gt" | "lt";
  field: string;
  value: Primitive;
};

type GenericDoc = {
  _id: string;
  _creationTime: number;
  [key: string]: unknown;
};

type TableName =
  | "content"
  | "user"
  | "userPreferences"
  | "memories"
  | "memoryMedia"
  | "days"
  | "summaryGenerationQuotas"
  | "exportJobs"
  | "restoreJobs"
  | "daySummaries"
  | "auditLogs"
  | "integrations"
  | "integrationSecrets"
  | "integrationSyncRuns"
  | "integrationDailyData"
  | "integrationProviderHealth"
  | "integrationHealthEvents"
  | "observabilityInfoEvents"
  | "summaryGenerationEvents"
  | "summaryQualityEvaluations"
  | "dataRetentionPolicies"
  | "dataRetentionRuns"
  | "platformAuditEvents"
  | "adminDashboardMetrics"
  | "featureFlags"
  | "userDeletionJobs";

type SeedData = Partial<Record<TableName, GenericDoc[]>>;

type PaginationOpts = {
  numItems: number;
  cursor: string | null;
};

const INDEX_FIELDS: Record<TableName, Record<string, string[]>> = {
  content: {
    by_slug: ["slug"],
  },
  user: {
    by_clerkUserId: ["clerkUserId"],
    by_email: ["email"],
  },
  userPreferences: {
    by_clerkUserId: ["clerkUserId"],
    by_updatedAt: ["updatedAt"],
  },
  memories: {
    by_user_day: ["userId", "dayKey"],
    by_user_clientRequestId: ["userId", "clientRequestId"],
    by_user_happenedAt: ["userId", "happenedAt"],
    by_happenedAt: ["happenedAt"],
    by_day_happenedAt: ["dayKey", "happenedAt"],
  },
  memoryMedia: {
    by_memory: ["memoryId"],
    by_memory_clientMediaId: ["memoryId", "clientMediaId"],
    by_user: ["userId"],
    by_user_memory_type: ["userId", "memoryId", "type"],
  },
  days: {
    by_user_day: ["userId", "dayKey"],
    by_dayKey: ["dayKey"],
  },
  summaryGenerationQuotas: {
    by_user_day: ["userId", "quotaDayKey"],
    by_quotaDayKey: ["quotaDayKey"],
  },
  exportJobs: {
    by_user_requestedAt: ["userId", "requestedAt"],
    by_requestedAt: ["requestedAt"],
    by_status_requestedAt: ["status", "requestedAt"],
  },
  restoreJobs: {
    by_user_requestedAt: ["userId", "requestedAt"],
    by_requestedAt: ["requestedAt"],
    by_status_requestedAt: ["status", "requestedAt"],
  },
  daySummaries: {
    by_user_day: ["userId", "dayKey"],
    by_user_generatedAt: ["userId", "generatedAt"],
    by_generatedAt: ["generatedAt"],
    by_day_generatedAt: ["dayKey", "generatedAt"],
  },
  auditLogs: {
    by_userId: ["actorUserId"],
    by_createdAt: ["at"],
    by_userId_createdAt: ["actorUserId", "at"],
    by_action_createdAt: ["action", "at"],
    by_userId_action_createdAt: ["actorUserId", "action", "at"],
  },
  integrations: {
    by_user_provider: ["userId", "provider"],
    by_status: ["status"],
    by_provider: ["provider"],
    by_status_provider: ["status", "provider"],
  },
  integrationSecrets: {
    by_tokenRef: ["tokenRef"],
    by_user_provider: ["userId", "provider"],
  },
  integrationSyncRuns: {
    by_user_provider_day: ["userId", "provider", "dayKey"],
    by_user_provider: ["userId", "provider"],
    by_user_day_updatedAt: ["userId", "dayKey", "updatedAt"],
    by_updatedAt: ["updatedAt"],
  },
  integrationDailyData: {
    by_user_day: ["userId", "dayKey"],
    by_user_provider_day: ["userId", "provider", "dayKey"],
    by_user_provider: ["userId", "provider"],
    by_syncedAt: ["syncedAt"],
    by_provider_syncedAt: ["provider", "syncedAt"],
  },
  integrationProviderHealth: {
    by_provider: ["provider"],
    by_status_updatedAt: ["status", "updatedAt"],
  },
  integrationHealthEvents: {
    by_provider_at: ["provider", "at"],
    by_status_at: ["status", "at"],
    by_outcome_at: ["outcome", "at"],
    by_at: ["at"],
    by_userId_at: ["userId", "at"],
  },
  observabilityInfoEvents: {
    by_receivedAt: ["receivedAt"],
    by_surface_receivedAt: ["surface", "receivedAt"],
    by_event_receivedAt: ["event", "receivedAt"],
  },
  summaryGenerationEvents: {
    by_createdAt: ["createdAt"],
    by_user_day_createdAt: ["userId", "dayKey", "createdAt"],
    by_success_createdAt: ["success", "createdAt"],
  },
  summaryQualityEvaluations: {
    by_evaluatedAt: ["evaluatedAt"],
    by_lowQuality_evaluatedAt: ["lowQuality", "evaluatedAt"],
    by_generationEventId: ["generationEventId"],
    by_user_day_evaluatedAt: ["userId", "dayKey", "evaluatedAt"],
  },
  dataRetentionPolicies: {
    by_key: ["key"],
  },
  dataRetentionRuns: {
    by_startedAt: ["startedAt"],
    by_status_startedAt: ["status", "startedAt"],
  },
  platformAuditEvents: {
    by_category_at: ["category", "at"],
    by_actor_at: ["actorType", "at"],
    by_at: ["at"],
    by_actorUserId_at: ["actorUserId", "at"],
  },
  adminDashboardMetrics: {
    by_key: ["key"],
  },
  featureFlags: {
    by_key: ["key"],
    by_updatedAt: ["updatedAt"],
  },
  userDeletionJobs: {
    by_user_status: ["userId", "status"],
    by_clerk_status: ["clerkUserId", "status"],
    by_updatedAt: ["updatedAt"],
  },
};

class RangeBuilder {
  conditions: Condition[] = [];

  eq(field: string, value: Primitive): this {
    this.conditions.push({ op: "eq", field, value });
    return this;
  }

  gte(field: string, value: Primitive): this {
    this.conditions.push({ op: "gte", field, value });
    return this;
  }

  lte(field: string, value: Primitive): this {
    this.conditions.push({ op: "lte", field, value });
    return this;
  }

  gt(field: string, value: Primitive): this {
    this.conditions.push({ op: "gt", field, value });
    return this;
  }

  lt(field: string, value: Primitive): this {
    this.conditions.push({ op: "lt", field, value });
    return this;
  }
}

function comparePrimitive(a: Primitive, b: Primitive): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  if (a === null) return -1;
  if (b === null) return 1;

  if (typeof a === "number" && typeof b === "number") {
    return a < b ? -1 : 1;
  }

  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b ? 0 : a ? 1 : -1;
  }

  const left = String(a);
  const right = String(b);
  return left < right ? -1 : 1;
}

function passesCondition(value: Primitive, condition: Condition): boolean {
  const cmp = comparePrimitive(value, condition.value);
  switch (condition.op) {
    case "eq":
      return cmp === 0;
    case "gte":
      return cmp >= 0;
    case "lte":
      return cmp <= 0;
    case "gt":
      return cmp > 0;
    case "lt":
      return cmp < 0;
    default:
      return false;
  }
}

type CursorPayload = {
  order: "asc" | "desc";
  indexFields: string[];
  fieldValues: Primitive[];
  id: string;
};

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(value: string): CursorPayload {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function isAfterCursor(row: GenericDoc, cursor: CursorPayload): boolean {
  for (let index = 0; index < cursor.indexFields.length; index += 1) {
    const field = cursor.indexFields[index];
    if (!field) continue;
    const rowValue = row[field] as Primitive;
    const cursorValue = cursor.fieldValues[index];
    const cmp = comparePrimitive(rowValue, cursorValue);
    if (cmp === 0) continue;

    return cursor.order === "asc" ? cmp > 0 : cmp < 0;
  }

  const idCmp = comparePrimitive(row._id, cursor.id);
  return cursor.order === "asc" ? idCmp > 0 : idCmp < 0;
}

class InMemoryQuery {
  private readonly db: InMemoryDb;
  private readonly table: TableName;
  private conditions: Condition[] = [];
  private indexName: string | null = null;
  private orderDirection: "asc" | "desc" = "asc";

  constructor(db: InMemoryDb, table: TableName) {
    this.db = db;
    this.table = table;
  }

  withIndex(indexName: string, apply?: (q: RangeBuilder) => unknown): this {
    this.indexName = indexName;
    if (apply) {
      const builder = new RangeBuilder();
      apply(builder);
      this.conditions = [...this.conditions, ...builder.conditions];
    }
    return this;
  }

  order(direction: "asc" | "desc"): this {
    this.orderDirection = direction;
    return this;
  }

  async collect(): Promise<GenericDoc[]> {
    return this.materialize();
  }

  async unique(): Promise<GenericDoc | null> {
    const rows = this.materialize();
    return rows[0] ?? null;
  }

  async take(limit: number): Promise<GenericDoc[]> {
    return this.materialize().slice(0, limit);
  }

  async paginate(opts: PaginationOpts): Promise<{
    page: GenericDoc[];
    isDone: boolean;
    continueCursor: string | null;
    splitCursor: string | null;
  }> {
    const indexFields = this.resolveIndexFields();
    const rows = this.materialize();

    const cursorPayload = opts.cursor ? decodeCursor(opts.cursor) : null;
    const afterCursor = cursorPayload
      ? rows.filter((row) => isAfterCursor(row, cursorPayload))
      : rows;

    const page = afterCursor.slice(0, opts.numItems);
    const isDone = afterCursor.length <= opts.numItems;

    const continueCursor =
      page.length > 0 && !isDone
        ? (() => {
            const lastRow = page[page.length - 1];
            if (!lastRow) return null;
            return encodeCursor({
              order: this.orderDirection,
              indexFields,
              fieldValues: indexFields.map(
                (field) => lastRow[field] as Primitive,
              ),
              id: lastRow._id,
            });
          })()
        : null;

    return {
      page,
      isDone,
      continueCursor,
      splitCursor: continueCursor,
    };
  }

  private resolveIndexFields(): string[] {
    if (!this.indexName) return ["_creationTime"];
    return INDEX_FIELDS[this.table][this.indexName] ?? ["_creationTime"];
  }

  private materialize(): GenericDoc[] {
    const indexFields = this.resolveIndexFields();
    const records = this.db.getTable(this.table);

    const filtered = records.filter((record) =>
      this.conditions.every((condition) => {
        const value = record[condition.field] as Primitive;
        return passesCondition(value, condition);
      }),
    );

    filtered.sort((left, right) => {
      for (const field of indexFields) {
        const cmp = comparePrimitive(
          left[field] as Primitive,
          right[field] as Primitive,
        );
        if (cmp === 0) continue;
        return this.orderDirection === "asc" ? cmp : -cmp;
      }

      const idCmp = comparePrimitive(left._id, right._id);
      return this.orderDirection === "asc" ? idCmp : -idCmp;
    });

    return filtered;
  }
}

export class InMemoryDb {
  private readonly tables: Record<TableName, GenericDoc[]>;
  private idCounter = 0;

  constructor(seed?: SeedData) {
    this.tables = {
      content: [...(seed?.content ?? [])],
      user: [...(seed?.user ?? [])],
      userPreferences: [...(seed?.userPreferences ?? [])],
      memories: [...(seed?.memories ?? [])],
      memoryMedia: [...(seed?.memoryMedia ?? [])],
      days: [...(seed?.days ?? [])],
      summaryGenerationQuotas: [...(seed?.summaryGenerationQuotas ?? [])],
      exportJobs: [...(seed?.exportJobs ?? [])],
      restoreJobs: [...(seed?.restoreJobs ?? [])],
      daySummaries: [...(seed?.daySummaries ?? [])],
      auditLogs: [...(seed?.auditLogs ?? [])],
      integrations: [...(seed?.integrations ?? [])],
      integrationSecrets: [...(seed?.integrationSecrets ?? [])],
      integrationSyncRuns: [...(seed?.integrationSyncRuns ?? [])],
      integrationDailyData: [...(seed?.integrationDailyData ?? [])],
      integrationProviderHealth: [...(seed?.integrationProviderHealth ?? [])],
      integrationHealthEvents: [...(seed?.integrationHealthEvents ?? [])],
      observabilityInfoEvents: [...(seed?.observabilityInfoEvents ?? [])],
      summaryGenerationEvents: [...(seed?.summaryGenerationEvents ?? [])],
      summaryQualityEvaluations: [...(seed?.summaryQualityEvaluations ?? [])],
      dataRetentionPolicies: [...(seed?.dataRetentionPolicies ?? [])],
      dataRetentionRuns: [...(seed?.dataRetentionRuns ?? [])],
      platformAuditEvents: [...(seed?.platformAuditEvents ?? [])],
      adminDashboardMetrics: [...(seed?.adminDashboardMetrics ?? [])],
      featureFlags: [...(seed?.featureFlags ?? [])],
      userDeletionJobs: [...(seed?.userDeletionJobs ?? [])],
    };
  }

  query(table: TableName): InMemoryQuery {
    return new InMemoryQuery(this, table);
  }

  async insert(
    table: TableName,
    value: Record<string, unknown>,
  ): Promise<string> {
    this.idCounter += 1;
    const id = `${table}_${String(this.idCounter).padStart(5, "0")}`;
    const doc: GenericDoc = {
      _id: id,
      _creationTime: Date.now(),
      ...value,
    };
    this.tables[table].push(doc);
    return id;
  }

  async patch(id: string, value: Record<string, unknown>): Promise<void> {
    const doc = this.findById(id);
    if (!doc) throw new Error(`Document not found: ${id}`);
    Object.assign(doc, value);
  }

  async get(id: string): Promise<GenericDoc | null> {
    const found = this.findById(id);
    return found ? { ...found } : null;
  }

  async delete(id: string): Promise<void> {
    for (const table of Object.keys(this.tables) as TableName[]) {
      const index = this.tables[table].findIndex((item) => item._id === id);
      if (index >= 0) {
        this.tables[table].splice(index, 1);
        return;
      }
    }
  }

  getTable(table: TableName): GenericDoc[] {
    return this.tables[table].map((item) => ({ ...item }));
  }

  private findById(id: string): GenericDoc | null {
    for (const table of Object.keys(this.tables) as TableName[]) {
      const found = this.tables[table].find((item) => item._id === id);
      if (found) return found;
    }
    return null;
  }
}

export function createInMemoryDb(seed?: SeedData): InMemoryDb {
  return new InMemoryDb(seed);
}

export function createAuthCtx(db: InMemoryDb, clerkSubject?: string | null) {
  return {
    db,
    auth: {
      async getUserIdentity() {
        if (!clerkSubject) return null;
        return { subject: clerkSubject };
      },
    },
  };
}
