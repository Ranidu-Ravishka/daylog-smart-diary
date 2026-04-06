import { describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as integrationsModule from "./integrations";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const USER_ID = "user_member_001" as Id<"user">;

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
    ],
  });
}

describe("integration context aggregate behavior", () => {
  it("merges mixed providers into a single daily context snapshot", async () => {
    const db = seededDb();
    const getAggregate = handler<
      { dayKey: string },
      {
        providerCount: number;
        providers: string[];
        metrics: {
          steps?: number;
          sleepMinutes?: number;
          screenTimeMinutes?: number;
        };
        location: {
          totalTrackedMinutes?: number;
          stayPoints: unknown[];
          humanSummary?: string;
        };
        calendar: {
          meetingsCount?: number;
          busyMinutes?: number;
          remindersCount?: number;
        };
        fitness: {
          steps?: number;
          distanceMeters?: number;
          activeMinutes?: number;
        };
        activitySummary: {
          mood?: string;
          moodConfidence?: number;
          activityLevel?: string;
        };
        signals: string[];
      }
    >(integrationsModule.getMyIntegrationContextAggregateForDay);

    await db.insert("integrationDailyData", {
      userId: USER_ID,
      provider: "location",
      dayKey: "2026-04-06",
      syncedAt: 100,
      signals: ["  Morning commute  ", "Gym visit"],
      context: {
        schemaVersion: 1,
        location: {
          mode: "foreground",
          totalTrackedMinutes: 120,
          totalDistanceMeters: 5800,
          stayPoints: [
            {
              label: "Home",
              startedAt: 10,
              endedAt: 70,
              durationMinutes: 60,
            },
            {
              label: "Office",
              startedAt: 80,
              endedAt: 170,
              durationMinutes: 90,
            },
          ],
        },
      },
    });

    await db.insert("integrationDailyData", {
      userId: USER_ID,
      provider: "fitness",
      dayKey: "2026-04-06",
      syncedAt: 120,
      metrics: {
        steps: 5300,
      },
      context: {
        schemaVersion: 1,
        fitness: {
          steps: 6200,
          distanceMeters: 4100,
          activeMinutes: 48,
          idleMinutes: 18,
        },
      },
    });

    await db.insert("integrationDailyData", {
      userId: USER_ID,
      provider: "calendar",
      dayKey: "2026-04-06",
      syncedAt: 130,
      context: {
        schemaVersion: 1,
        calendar: {
          meetingsCount: 3,
          busyMinutes: 165,
          remindersCount: 2,
        },
      },
    });

    await db.insert("integrationDailyData", {
      userId: USER_ID,
      provider: "activity_summary",
      dayKey: "2026-04-06",
      syncedAt: 140,
      context: {
        schemaVersion: 1,
        activitySummary: {
          callsCount: 2,
          callDurationMinutes: 26,
          mood: "tired",
          moodConfidence: 0.33,
          activityLevel: "idle",
        },
      },
    });

    await db.insert("integrationDailyData", {
      userId: USER_ID,
      provider: "activity_summary",
      dayKey: "2026-04-06",
      syncedAt: 150,
      context: {
        schemaVersion: 1,
        activitySummary: {
          mood: "focused",
          moodConfidence: 0.81,
          activityLevel: "active",
        },
      },
    });

    const result = await getAggregate(createAuthCtx(db, "clerk_member_001"), {
      dayKey: "2026-04-06",
    });

    expect(result.providerCount).toBe(4);
    expect(result.providers).toEqual(
      expect.arrayContaining([
        "location",
        "fitness",
        "calendar",
        "activity_summary",
      ]),
    );
    expect(result.metrics.steps).toBe(6200);
    expect(result.fitness.distanceMeters).toBe(4100);
    expect(result.fitness.activeMinutes).toBe(48);
    expect(result.location.totalTrackedMinutes).toBe(120);
    expect(result.location.stayPoints.length).toBeGreaterThan(0);
    expect(result.location.humanSummary).toContain("Spent");
    expect(result.calendar.meetingsCount).toBe(3);
    expect(result.calendar.busyMinutes).toBe(165);
    expect(result.activitySummary.mood).toBe("focused");
    expect(result.activitySummary.moodConfidence).toBe(0.81);
    expect(result.activitySummary.activityLevel).toBe("active");
    expect(result.signals.some((signal) => signal.includes("meetings"))).toBe(
      true,
    );
    expect(result.signals.some((signal) => signal.includes("calls"))).toBe(
      true,
    );
  });

  it("returns a stable empty aggregate when no providers have synced data", async () => {
    const db = seededDb();
    const getAggregate = handler<
      { dayKey: string },
      {
        providerCount: number;
        providers: string[];
        metrics: { steps?: number; spendingTotal?: number };
        signals: string[];
        syncedAtMax: number;
        health: {
          isDegraded: boolean;
          degradedProviders: unknown[];
          pendingProviders: unknown[];
        };
      }
    >(integrationsModule.getMyIntegrationContextAggregateForDay);

    const result = await getAggregate(createAuthCtx(db, "clerk_member_001"), {
      dayKey: "2026-04-07",
    });

    expect(result.providerCount).toBe(0);
    expect(result.providers).toEqual([]);
    expect(result.metrics.steps).toBeUndefined();
    expect(result.metrics.spendingTotal).toBeUndefined();
    expect(result.signals).toEqual([]);
    expect(result.syncedAtMax).toBe(0);
    expect(result.health.isDegraded).toBe(false);
    expect(result.health.degradedProviders).toEqual([]);
    expect(result.health.pendingProviders).toEqual([]);
  });

  it("resolves conflicting mood values by highest confidence", async () => {
    const db = seededDb();
    const getAggregate = handler<
      { dayKey: string },
      { activitySummary: { mood?: string; moodConfidence?: number } }
    >(integrationsModule.getMyIntegrationContextAggregateForDay);

    await db.insert("integrationDailyData", {
      userId: USER_ID,
      provider: "activity_summary",
      dayKey: "2026-04-08",
      syncedAt: 100,
      context: {
        schemaVersion: 1,
        activitySummary: {
          mood: "anxious",
          moodConfidence: 0.45,
        },
      },
    });

    await db.insert("integrationDailyData", {
      userId: USER_ID,
      provider: "activity_summary",
      dayKey: "2026-04-08",
      syncedAt: 101,
      context: {
        schemaVersion: 1,
        activitySummary: {
          mood: "calm",
          moodConfidence: 0.91,
        },
      },
    });

    const result = await getAggregate(createAuthCtx(db, "clerk_member_001"), {
      dayKey: "2026-04-08",
    });

    expect(result.activitySummary.mood).toBe("calm");
    expect(result.activitySummary.moodConfidence).toBe(0.91);
  });

  it("reports degraded provider health when a provider sync fails for the same day", async () => {
    const db = seededDb();
    const getAggregate = handler<
      { dayKey: string },
      {
        providerCount: number;
        providers: string[];
        health: {
          isDegraded: boolean;
          degradedProviders: Array<{
            provider: string;
            lastError?: string;
          }>;
          pendingProviders: Array<{
            provider: string;
          }>;
        };
      }
    >(integrationsModule.getMyIntegrationContextAggregateForDay);

    await db.insert("integrationDailyData", {
      userId: USER_ID,
      provider: "location",
      dayKey: "2026-04-09",
      syncedAt: 200,
      context: {
        schemaVersion: 1,
        location: {
          mode: "foreground",
          totalTrackedMinutes: 20,
        },
      },
    });

    await db.insert("integrationSyncRuns", {
      userId: USER_ID,
      provider: "google_fit",
      dayKey: "2026-04-09",
      status: "success",
      startedAt: 210,
      updatedAt: 210,
    });

    await db.insert("integrationSyncRuns", {
      userId: USER_ID,
      provider: "google_fit",
      dayKey: "2026-04-09",
      status: "error",
      startedAt: 220,
      updatedAt: 225,
      lastError: "provider timeout",
    });

    await db.insert("integrationSyncRuns", {
      userId: USER_ID,
      provider: "spotify",
      dayKey: "2026-04-09",
      status: "in_progress",
      startedAt: 230,
      updatedAt: 231,
    });

    const result = await getAggregate(createAuthCtx(db, "clerk_member_001"), {
      dayKey: "2026-04-09",
    });

    expect(result.providerCount).toBe(1);
    expect(result.providers).toEqual(["location"]);
    expect(result.health.isDegraded).toBe(true);
    expect(result.health.degradedProviders).toEqual([
      {
        provider: "google_fit",
        lastError: "provider timeout",
        updatedAt: 225,
      },
    ]);
    expect(result.health.pendingProviders).toEqual([
      {
        provider: "spotify",
        updatedAt: 231,
      },
    ]);
  });
});
