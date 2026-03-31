import { describe, expect, it } from "vitest";

import { createInMemoryDb } from "../test-utils/inMemoryConvex";

describe("in-memory convex harness behavior", () => {
  it("supports gt/lt conditions and collect/take wrappers", async () => {
    const db = createInMemoryDb({
      auditLogs: [
        { _id: "a1", _creationTime: 1, at: 1, action: "x", actorUserId: "u1" },
        { _id: "a2", _creationTime: 2, at: 2, action: "x", actorUserId: "u1" },
        { _id: "a3", _creationTime: 3, at: 3, action: "x", actorUserId: "u1" },
        { _id: "a4", _creationTime: 4, at: 4, action: "x", actorUserId: "u1" },
        { _id: "a5", _creationTime: 5, at: 5, action: "x", actorUserId: "u1" },
      ],
    });

    const query = db
      .query("auditLogs")
      .withIndex("by_createdAt", (q) => q.gt("at", 2).lt("at", 5))
      .order("asc");

    const collected = await query.collect();
    expect(collected.map((row) => row._id)).toEqual(["a3", "a4"]);

    const taken = await query.take(1);
    expect(taken.map((row) => row._id)).toEqual(["a3"]);
  });

  it("handles boolean comparisons through comparePrimitive", async () => {
    const db = createInMemoryDb({
      auditLogs: [
        {
          _id: "b1",
          _creationTime: 10,
          at: 10,
          action: "x",
          actorUserId: "u1",
          active: true,
        },
        {
          _id: "b2",
          _creationTime: 11,
          at: 11,
          action: "x",
          actorUserId: "u1",
          active: false,
        },
      ],
    });

    const activeOnly = await db
      .query("auditLogs")
      .withIndex("by_createdAt", (q) => q.eq("active", true))
      .collect();

    expect(activeOnly.map((row) => row._id)).toEqual(["b1"]);
  });

  it("falls back safely on unknown condition operators", async () => {
    const db = createInMemoryDb({
      auditLogs: [
        {
          _id: "c1",
          _creationTime: 20,
          at: 20,
          action: "x",
          actorUserId: "u1",
        },
      ],
    });

    const query = db.query("auditLogs") as unknown as {
      collect: () => Promise<Array<{ _id: string }>>;
      conditions: Array<{ op: string; field: string; value: unknown }>;
    };
    query.conditions.push({ op: "unknown", field: "at", value: 20 });

    const rows = await query.collect();
    expect(rows).toHaveLength(0);
  });

  it("deletes existing docs and returns null for missing docs", async () => {
    const db = createInMemoryDb();

    const id = await db.insert("daySummaries", {
      userId: "u1",
      dayKey: "2026-03-31",
      story: "x",
      highlights: [],
      sourcesUsed: [],
      generatedAt: 1,
    });

    await db.delete(id);
    await expect(db.get(id)).resolves.toBeNull();
    await expect(db.get("missing_doc_id")).resolves.toBeNull();
    await expect(db.patch("missing_doc_id", { story: "y" })).rejects.toThrow(
      "Document not found: missing_doc_id",
    );
  });
});
