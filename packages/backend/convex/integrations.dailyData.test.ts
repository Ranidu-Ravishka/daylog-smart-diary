import { describe, expect, it } from "vitest";

import {
  buildIntegrationContextAggregate,
  sanitizeContext,
  sanitizeMetrics,
  sanitizeSignals,
  sanitizeSignalText,
  sanitizeSummaryText,
} from "./integrations.dailyData";

describe("integration daily data sanitization", () => {
  it("trims and bounds signal and summary text", () => {
    expect(sanitizeSignals([" first ", " ", "second"])).toEqual([
      "first",
      "second",
    ]);
    expect(sanitizeSummaryText("  summary  ")).toBe("summary");
    expect(sanitizeSummaryText("   ")).toBeUndefined();
    expect(sanitizeSummaryText(undefined)).toBeUndefined();
    expect(sanitizeSignalText(` ${"a".repeat(200)} `)).toHaveLength(160);
  });

  it("drops unsafe context values while retaining valid integration sections", () => {
    const result = sanitizeContext({
      schemaVersion: 99,
      location: {
        mode: "invalid",
        totalTrackedMinutes: -1,
        stayPoints: [
          { label: "bad", startedAt: 20, endedAt: 10, durationMinutes: 1 },
          { label: " Office ", startedAt: 10, endedAt: 70 },
        ],
      },
      fitness: { steps: -3, source: " Health " },
      calendar: {
        meetingsCount: 2,
        eventTitles: [" Meeting ", " "],
      },
      activitySummary: {
        callsCount: 1,
        mood: " focused ",
        moodConfidence: 0.756,
        activityLevel: "active",
      },
    } as never);

    expect(result).toMatchObject({
      schemaVersion: 1,
      location: { stayPoints: [{ label: "Office", startedAt: 10, endedAt: 70 }] },
      calendar: { meetingsCount: 2, eventTitles: ["Meeting"] },
      activitySummary: {
        callsCount: 1,
        mood: "focused",
        moodConfidence: 0.76,
        activityLevel: "active",
      },
    });
    expect(sanitizeContext(undefined)).toBeUndefined();
    expect(
      sanitizeContext({ schemaVersion: 1 } as never),
    ).toBeUndefined();
  });

  it("returns bounded metrics or undefined when no metrics are usable", () => {
    expect(
      sanitizeMetrics({
        steps: 500,
        sleepMinutes: -1,
        spendingTotal: 12.5,
      }),
    ).toMatchObject({ steps: 500, spendingTotal: 12.5 });
    expect(sanitizeMetrics(undefined)).toBeUndefined();
    expect(sanitizeMetrics({})).toBeUndefined();
  });
});

describe("integration context aggregation", () => {
  it("merges provider metrics, signals, location, calendar, and sync status", () => {
    const result = buildIntegrationContextAggregate({
      dayKey: "2026-04-20",
      rows: [
        {
          provider: "fitness",
          metrics: { steps: 5000, spendingTotal: 4 },
          signals: ["  Walked  ", ""],
          context: {
            schemaVersion: 1,
            fitness: { steps: 5200, distanceMeters: 1000, activeMinutes: 30 },
            activitySummary: {
              mood: "calm",
              moodConfidence: 0.8,
              activityLevel: "active",
              callsCount: 2,
              callDurationMinutes: 30,
            },
          },
        },
        {
          provider: "calendar",
          metrics: { steps: 4000, spendingTotal: 6 },
          context: {
            schemaVersion: 1,
            calendar: { meetingsCount: 3, busyMinutes: 90, remindersCount: 1 },
            location: {
              totalTrackedMinutes: 60,
              totalDistanceMeters: 2000,
              stayPoints: [
                { label: "Office", startedAt: 1, endedAt: 2, durationMinutes: 90 },
              ],
            },
          },
        },
      ],
      syncRuns: [
        { provider: "fitness", status: "success", updatedAt: 2 },
        { provider: "calendar", status: "error", updatedAt: 3, lastError: "timeout" },
        { provider: "spotify", status: "in_progress", updatedAt: 4 },
      ],
    } as never);

    expect(result).toMatchObject({
      dayKey: "2026-04-20",
      providerCount: 2,
      providers: ["fitness", "calendar"],
      metrics: { steps: 5200, spendingTotal: 10 },
      calendar: { meetingsCount: 3, busyMinutes: 90, remindersCount: 1 },
      activitySummary: { callsCount: 2, callDurationMinutes: 30, mood: "calm" },
      signals: expect.arrayContaining(["Walked"]),
      health: {
        isDegraded: true,
        degradedProviders: [{ provider: "calendar", lastError: "timeout" }],
        pendingProviders: [{ provider: "spotify" }],
      },
    });
    expect(result.location.stayPoints).toHaveLength(1);
  });
});
