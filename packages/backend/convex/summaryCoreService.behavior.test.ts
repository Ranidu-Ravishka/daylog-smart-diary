import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel";

import { createInMemoryDb } from "../test-utils/inMemoryConvex";
import {
  releaseSummaryGenerationSlotForUser,
  reserveSummaryGenerationSlotForUser,
} from "./summaries/services/summaryCoreService";

const userId = "user_1" as Id<"user">;
const now = Date.parse("2026-04-18T13:00:00.000Z");

describe("summary generation quota persistence", () => {
  it("creates a daily quota and idempotent reservation", async () => {
    const db = createInMemoryDb();

    await expect(
      reserveSummaryGenerationSlotForUser(db as never, userId, now, 3, " request-1 "),
    ).resolves.toMatchObject({
      quotaDayKey: "2026-04-18",
      used: 1,
      limit: 3,
      remaining: 2,
    });

    await expect(
      reserveSummaryGenerationSlotForUser(db as never, userId, now, 3, "request-1"),
    ).resolves.toMatchObject({
      used: 1,
      remaining: 2,
    });

    await expect(
      db.query("summaryGenerationQuotas").collect(),
    ).resolves.toHaveLength(1);
    await expect(
      db.query("summaryGenerationQuotaReservations").collect(),
    ).resolves.toHaveLength(1);
  });

  it("increments existing quota, rejects exhaustion, and supports no-key reservations", async () => {
    const db = createInMemoryDb({
      summaryGenerationQuotas: [
        {
          _id: "quota-1",
          _creationTime: 1,
          userId,
          quotaDayKey: "2026-04-18",
          used: 1,
          updatedAt: now - 1,
        },
      ],
    });

    await expect(
      reserveSummaryGenerationSlotForUser(db as never, userId, now, 2),
    ).resolves.toMatchObject({ used: 2, remaining: 0 });
    await expect(
      reserveSummaryGenerationSlotForUser(db as never, userId, now, 2, "last-one"),
    ).rejects.toThrow("Daily summary limit reached (2/day)");
  });

  it("refunds an existing reservation once and safely ignores missing keys", async () => {
    const db = createInMemoryDb({
      summaryGenerationQuotas: [
        {
          _id: "quota-1",
          _creationTime: 1,
          userId,
          quotaDayKey: "2026-04-18",
          used: 2,
          updatedAt: now - 1,
        },
      ],
      summaryGenerationQuotaReservations: [
        {
          _id: "reservation-1",
          _creationTime: 2,
          userId,
          quotaDayKey: "2026-04-18",
          idempotencyKey: "request-1",
          createdAt: now - 1,
          updatedAt: now - 1,
        },
      ],
    });

    await expect(
      releaseSummaryGenerationSlotForUser(db as never, userId, now, " request-1 "),
    ).resolves.toEqual({ refunded: true });
    await expect(
      releaseSummaryGenerationSlotForUser(db as never, userId, now, "request-1"),
    ).resolves.toEqual({ refunded: false });
    await expect(
      releaseSummaryGenerationSlotForUser(db as never, userId, now, "   "),
    ).resolves.toEqual({ refunded: false });

    await expect(db.get("quota-1")).resolves.toMatchObject({ used: 1 });
  });
});
