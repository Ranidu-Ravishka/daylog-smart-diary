import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as observabilityIngestionModule from "./observabilityIngestion";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const ADMIN_ID = "user_admin_001" as Id<"user">;
const MEMBER_ID = "user_member_001" as Id<"user">;

type TransportHealthResult = {
  windowHours: number;
  windowStartAt: number;
  evaluatedRows: number;
  truncated: boolean;
  filters: {
    eventName: string | null;
    sourceEnvironment: string | null;
  };
  overall: {
    ingestedCount: number;
    estimatedAttemptedCount: number;
    estimatedDroppedCount: number;
    estimatedDropRate: number;
    averageSampleRate: number | null;
    lastReceivedAt: number | null;
  };
  bySurface: {
    web: {
      ingestedCount: number;
      estimatedAttemptedCount: number;
      estimatedDroppedCount: number;
      estimatedDropRate: number;
      averageSampleRate: number | null;
      lastReceivedAt: number | null;
    };
    mobile: {
      ingestedCount: number;
      estimatedAttemptedCount: number;
      estimatedDroppedCount: number;
      estimatedDropRate: number;
      averageSampleRate: number | null;
      lastReceivedAt: number | null;
    };
  };
  topEvents: Array<{
    event: string;
    ingestedCount: number;
    webCount: number;
    mobileCount: number;
    lastReceivedAt: number | null;
    shareOfIngested: number;
  }>;
};

type RateLimitMetricsResult = {
  windowMinutes: number;
  windowStartMinute: number;
  nowMinute: number;
  evaluatedRows: number;
  truncated: boolean;
  totals: {
    totalRequests: number;
    allowedRequests: number;
    blockedRequests: number;
    burstAttempts: number;
    blockedRate: number;
  };
  minuteBuckets: Array<{
    epochMinute: number;
    allowedRequests: number;
    blockedRequests: number;
    burstAttempts: number;
  }>;
};

function toSlotMinute(epochMinute: number): number {
  const minutesPerDay = 24 * 60;
  const normalized = epochMinute % minutesPerDay;
  return normalized >= 0 ? normalized : normalized + minutesPerDay;
}

function seededDb(now: number) {
  const nowMinute = Math.floor(now / 60_000);

  return createInMemoryDb({
    user: [
      {
        _id: ADMIN_ID,
        _creationTime: now - 10_000,
        clerkUserId: "clerk_admin_001",
        email: "admin@example.com",
        isAdmin: true,
      },
      {
        _id: MEMBER_ID,
        _creationTime: now - 9_000,
        clerkUserId: "clerk_member_001",
        email: "member@example.com",
        isAdmin: false,
      },
    ],
    observabilityInfoEvents: [
      {
        _id: "obs_001",
        _creationTime: now - 4_000,
        app: "daylog",
        surface: "web",
        level: "info",
        event: "page_loaded",
        timestamp: new Date(now - 3_500).toISOString(),
        emittedAt: now - 3_500,
        receivedAt: now - 1_000,
        sampleRate: 0.25,
        sourceEnvironment: "production",
        contextJson: '{"route":"/dashboard"}',
      },
      {
        _id: "obs_002",
        _creationTime: now - 5_000,
        app: "daylog",
        surface: "web",
        level: "info",
        event: "cta_clicked",
        timestamp: new Date(now - 4_400).toISOString(),
        emittedAt: now - 4_400,
        receivedAt: now - 2_000,
        sampleRate: 0.5,
        sourceEnvironment: "production",
      },
      {
        _id: "obs_003",
        _creationTime: now - 6_000,
        app: "daylog",
        surface: "mobile",
        level: "info",
        event: "screen_opened",
        timestamp: new Date(now - 5_300).toISOString(),
        emittedAt: now - 5_300,
        receivedAt: now - 3_000,
        sampleRate: 1,
        sourceEnvironment: "production",
      },
      {
        _id: "obs_004",
        _creationTime: now - 8_000,
        app: "daylog",
        surface: "mobile",
        level: "info",
        event: "screen_opened",
        timestamp: new Date(now - 74 * 60 * 60 * 1000).toISOString(),
        emittedAt: now - 74 * 60 * 60 * 1000,
        receivedAt: now - 72 * 60 * 60 * 1000,
        sampleRate: 0.2,
        sourceEnvironment: "production",
      },
    ],
    observabilityIngestRateLimitMetrics: [
      {
        _id: "metric_001",
        _creationTime: now - 1_200,
        slotMinute: toSlotMinute(nowMinute - 2),
        epochMinute: nowMinute - 2,
        shard: 0,
        allowedRequests: 8,
        blockedRequests: 2,
        burstAttempts: 1,
        updatedAt: now - 1_200,
      },
      {
        _id: "metric_002",
        _creationTime: now - 1_100,
        slotMinute: toSlotMinute(nowMinute - 2),
        epochMinute: nowMinute - 2,
        shard: 1,
        allowedRequests: 4,
        blockedRequests: 1,
        burstAttempts: 0,
        updatedAt: now - 1_100,
      },
      {
        _id: "metric_003",
        _creationTime: now - 500,
        slotMinute: toSlotMinute(nowMinute - 1),
        epochMinute: nowMinute - 1,
        shard: 0,
        allowedRequests: 5,
        blockedRequests: 3,
        burstAttempts: 2,
        updatedAt: now - 500,
      },
      {
        _id: "metric_004",
        _creationTime: now - 91 * 60 * 1_000,
        slotMinute: toSlotMinute(nowMinute - 90),
        epochMinute: nowMinute - 90,
        shard: 0,
        allowedRequests: 20,
        blockedRequests: 4,
        burstAttempts: 1,
        updatedAt: now - 91 * 60 * 1_000,
      },
    ],
  });
}

describe("observability ingestion admin queries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists recent info events with optional surface filtering", async () => {
    const now = Date.parse("2026-04-12T12:00:00.000Z");
    const db = seededDb(now);

    const listObservabilityInfoEventsPaginated = handler<
      {
        paginationOpts: { numItems: number; cursor: string | null };
        surface?: "web" | "mobile";
      },
      {
        page: Array<{
          _id: string;
          surface: "web" | "mobile";
          receivedAt: number;
        }>;
      }
    >(observabilityIngestionModule.listObservabilityInfoEventsPaginated);

    const firstPage = await listObservabilityInfoEventsPaginated(
      createAuthCtx(db, "clerk_admin_001"),
      {
        paginationOpts: {
          numItems: 3,
          cursor: null,
        },
      },
    );

    expect(firstPage.page.map((row) => row._id)).toEqual([
      "obs_001",
      "obs_002",
      "obs_003",
    ]);

    const webOnly = await listObservabilityInfoEventsPaginated(
      createAuthCtx(db, "clerk_admin_001"),
      {
        paginationOpts: {
          numItems: 10,
          cursor: null,
        },
        surface: "web",
      },
    );

    expect(webOnly.page).toHaveLength(2);
    expect(webOnly.page.every((row) => row.surface === "web")).toBe(true);
  });

  it("computes transport health volume and estimated drop metrics", async () => {
    const now = Date.parse("2026-04-12T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const db = seededDb(now);

    const getObservabilityInfoTransportHealth = handler<
      { windowHours?: number },
      TransportHealthResult
    >(observabilityIngestionModule.getObservabilityInfoTransportHealth);

    const summary = await getObservabilityInfoTransportHealth(
      createAuthCtx(db, "clerk_admin_001"),
      {
        windowHours: 24,
      },
    );

    expect(summary.windowHours).toBe(24);
    expect(summary.windowStartAt).toBe(now - 24 * 60 * 60 * 1000);
    expect(summary.evaluatedRows).toBe(3);
    expect(summary.truncated).toBe(false);
    expect(summary.filters).toEqual({
      eventName: null,
      sourceEnvironment: null,
    });

    expect(summary.overall.ingestedCount).toBe(3);
    expect(summary.overall.estimatedAttemptedCount).toBeCloseTo(7, 6);
    expect(summary.overall.estimatedDroppedCount).toBeCloseTo(4, 6);
    expect(summary.overall.estimatedDropRate).toBeCloseTo(4 / 7, 6);
    expect(summary.overall.averageSampleRate).toBeCloseTo(
      (0.25 + 0.5 + 1) / 3,
      6,
    );
    expect(summary.overall.lastReceivedAt).toBe(now - 1_000);

    expect(summary.bySurface.web.ingestedCount).toBe(2);
    expect(summary.bySurface.web.estimatedAttemptedCount).toBeCloseTo(6, 6);
    expect(summary.bySurface.web.estimatedDroppedCount).toBeCloseTo(4, 6);
    expect(summary.bySurface.web.estimatedDropRate).toBeCloseTo(2 / 3, 6);
    expect(summary.bySurface.web.averageSampleRate).toBeCloseTo(0.375, 6);
    expect(summary.bySurface.web.lastReceivedAt).toBe(now - 1_000);

    expect(summary.bySurface.mobile.ingestedCount).toBe(1);
    expect(summary.bySurface.mobile.estimatedAttemptedCount).toBeCloseTo(1, 6);
    expect(summary.bySurface.mobile.estimatedDroppedCount).toBeCloseTo(0, 6);
    expect(summary.bySurface.mobile.estimatedDropRate).toBeCloseTo(0, 6);
    expect(summary.bySurface.mobile.averageSampleRate).toBeCloseTo(1, 6);
    expect(summary.bySurface.mobile.lastReceivedAt).toBe(now - 3_000);

    expect(summary.topEvents).toEqual([
      {
        event: "page_loaded",
        ingestedCount: 1,
        webCount: 1,
        mobileCount: 0,
        lastReceivedAt: now - 1_000,
        shareOfIngested: 1 / 3,
      },
      {
        event: "cta_clicked",
        ingestedCount: 1,
        webCount: 1,
        mobileCount: 0,
        lastReceivedAt: now - 2_000,
        shareOfIngested: 1 / 3,
      },
      {
        event: "screen_opened",
        ingestedCount: 1,
        webCount: 0,
        mobileCount: 1,
        lastReceivedAt: now - 3_000,
        shareOfIngested: 1 / 3,
      },
    ]);
  });

  it("applies transport health filters for event name and environment", async () => {
    const now = Date.parse("2026-04-12T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const db = seededDb(now);

    const getObservabilityInfoTransportHealth = handler<
      { windowHours?: number; eventName?: string; sourceEnvironment?: string },
      TransportHealthResult
    >(observabilityIngestionModule.getObservabilityInfoTransportHealth);

    const summary = await getObservabilityInfoTransportHealth(
      createAuthCtx(db, "clerk_admin_001"),
      {
        windowHours: 24,
        eventName: "screen",
        sourceEnvironment: "production",
      },
    );

    expect(summary.filters).toEqual({
      eventName: "screen",
      sourceEnvironment: "production",
    });

    expect(summary.overall.ingestedCount).toBe(1);
    expect(summary.overall.estimatedAttemptedCount).toBe(1);
    expect(summary.overall.estimatedDroppedCount).toBe(0);
    expect(summary.overall.estimatedDropRate).toBe(0);
    expect(summary.overall.lastReceivedAt).toBe(now - 3_000);

    expect(summary.bySurface.web.ingestedCount).toBe(0);
    expect(summary.bySurface.mobile.ingestedCount).toBe(1);
    expect(summary.topEvents).toEqual([
      {
        event: "screen_opened",
        ingestedCount: 1,
        webCount: 0,
        mobileCount: 1,
        lastReceivedAt: now - 3_000,
        shareOfIngested: 1,
      },
    ]);
  });

  it("aggregates ingest rate-limit metrics over the selected window", async () => {
    const now = Date.parse("2026-04-12T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const db = seededDb(now);

    const getObservabilityIngestRateLimitMetrics = handler<
      { windowMinutes?: number },
      RateLimitMetricsResult
    >(observabilityIngestionModule.getObservabilityIngestRateLimitMetrics);

    const summary = await getObservabilityIngestRateLimitMetrics(
      createAuthCtx(db, "clerk_admin_001"),
      {
        windowMinutes: 60,
      },
    );

    const nowMinute = Math.floor(now / 60_000);

    expect(summary.windowMinutes).toBe(60);
    expect(summary.windowStartMinute).toBe(nowMinute - 59);
    expect(summary.nowMinute).toBe(nowMinute);
    expect(summary.evaluatedRows).toBe(3);
    expect(summary.truncated).toBe(false);

    expect(summary.totals).toEqual({
      totalRequests: 23,
      allowedRequests: 17,
      blockedRequests: 6,
      burstAttempts: 3,
      blockedRate: 6 / 23,
    });

    expect(summary.minuteBuckets).toEqual([
      {
        epochMinute: nowMinute - 2,
        allowedRequests: 12,
        blockedRequests: 3,
        burstAttempts: 1,
      },
      {
        epochMinute: nowMinute - 1,
        allowedRequests: 5,
        blockedRequests: 3,
        burstAttempts: 2,
      },
    ]);
  });

  it("rejects non-admin access to observability inspection queries", async () => {
    const now = Date.parse("2026-04-12T12:00:00.000Z");
    const db = seededDb(now);

    const listObservabilityInfoEventsPaginated = handler<
      {
        paginationOpts: { numItems: number; cursor: string | null };
        surface?: "web" | "mobile";
      },
      { page: Array<{ _id: string }> }
    >(observabilityIngestionModule.listObservabilityInfoEventsPaginated);

    const getObservabilityInfoTransportHealth = handler<
      { windowHours?: number },
      TransportHealthResult
    >(observabilityIngestionModule.getObservabilityInfoTransportHealth);

    const getObservabilityIngestRateLimitMetrics = handler<
      { windowMinutes?: number },
      RateLimitMetricsResult
    >(observabilityIngestionModule.getObservabilityIngestRateLimitMetrics);

    await expect(
      listObservabilityInfoEventsPaginated(
        createAuthCtx(db, "clerk_member_001"),
        {
          paginationOpts: {
            numItems: 5,
            cursor: null,
          },
        },
      ),
    ).rejects.toThrow("Forbidden: admin access required");

    await expect(
      getObservabilityInfoTransportHealth(
        createAuthCtx(db, "clerk_member_001"),
        {
          windowHours: 24,
        },
      ),
    ).rejects.toThrow("Forbidden: admin access required");

    await expect(
      getObservabilityIngestRateLimitMetrics(
        createAuthCtx(db, "clerk_member_001"),
        {
          windowMinutes: 60,
        },
      ),
    ).rejects.toThrow("Forbidden: admin access required");
  });
});
