import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveIntegrationSyncAdapter,
  resolveSummaryModelAdapter,
} from "./providerAdapters";

const BASE_SYNC_INPUT = {
  accessToken: "token",
  dayKey: "2026-04-06",
  timeZone: "UTC",
  syncStartedAt: 123,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("provider adapter runtime behavior", () => {
  it("normalizes google calendar day events", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      items: [
        {
          summary: "  Standup  ",
          start: { dateTime: "2026-04-06T09:00:00.000Z" },
          end: { dateTime: "2026-04-06T09:30:00.000Z" },
        },
        {
          summary: "Planning",
          start: { dateTime: "2026-04-06T11:00:00.000Z" },
          end: { dateTime: "2026-04-06T10:30:00.000Z" },
        },
        {
          summary: "Retro",
          start: { date: "2026-04-06" },
          end: { date: "2026-04-06" },
        },
      ],
    });

    const adapter = resolveIntegrationSyncAdapter("google_calendar");
    const result = await adapter.execute({
      ...(BASE_SYNC_INPUT as any),
      requestJson,
    });

    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(requestJson.mock.calls[0]?.[0]).toContain(
      "calendar/v3/calendars/primary/events",
    );
    expect(result.summary).toBe("Google Calendar: 3 events, ~30 busy minutes.");
    expect(result.signals).toEqual([
      "3 calendar events",
      "30 busy minutes",
      "Standup",
      "Planning",
      "Retro",
    ]);
    expect(result.context?.calendar).toEqual({
      meetingsCount: 3,
      busyMinutes: 30,
      eventTitles: ["Standup", "Planning", "Retro"],
    });
  });

  it("returns empty-state summary for spotify when no in-range plays exist", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      items: [
        {
          played_at: "2026-04-07T00:00:00.000Z",
          track: {
            name: "Outside window",
            artists: [{ name: "Artist X" }],
          },
        },
      ],
    });

    const adapter = resolveIntegrationSyncAdapter("spotify");
    const result = await adapter.execute({
      ...(BASE_SYNC_INPUT as any),
      requestJson,
    });

    expect(result.summary).toBe("Spotify: no recent playback for this day.");
    expect(result.signals).toEqual(["No track playback", "No artist activity"]);
  });

  it("summarizes slack search activity", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      ok: true,
      messages: {
        total: 3,
        matches: [
          {
            text: "  Deploy update  ",
            channel: { name: "engineering" },
          },
          {
            text: "On-call triage",
            channel: { name: "incident-response" },
          },
        ],
      },
    });

    const adapter = resolveIntegrationSyncAdapter("slack");
    const result = await adapter.execute({
      ...(BASE_SYNC_INPUT as any),
      requestJson,
    });

    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(requestJson.mock.calls[0]?.[0]).toContain(
      "slack.com/api/search.messages",
    );
    expect(result.summary).toBe("Slack: 3 matched messages across 2 channels.");
    expect(result.signals).toEqual([
      "3 Slack messages",
      "2 active Slack channels",
      "Deploy update",
      "On-call triage",
    ]);
  });

  it("summarizes strava activity volume and distance", async () => {
    const requestJson = vi.fn().mockResolvedValue([
      {
        name: "Morning Run",
        type: "Run",
        distance: 5000,
        moving_time: 1800,
        start_date: "2026-04-06T07:00:00.000Z",
      },
      {
        name: "Lunch Ride",
        type: "Ride",
        distance: 25000,
        moving_time: 3600,
        start_date: "2026-04-06T12:00:00.000Z",
      },
      {
        name: "Outside window",
        type: "Run",
        distance: 1000,
        moving_time: 600,
        start_date: "2026-04-07T08:00:00.000Z",
      },
    ]);

    const adapter = resolveIntegrationSyncAdapter("strava");
    const result = await adapter.execute({
      ...(BASE_SYNC_INPUT as any),
      requestJson,
    });

    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(requestJson.mock.calls[0]?.[0]).toContain(
      "www.strava.com/api/v3/athlete/activities",
    );
    expect(result.summary).toBe(
      "Strava: 2 activities, 30.0 km, 90 active minutes.",
    );
    expect(result.signals).toEqual([
      "2 Strava activities",
      "30.0 km total distance",
      "90 active minutes",
      "Run",
      "Ride",
      "Morning Run",
      "Lunch Ride",
    ]);
    expect(result.context?.fitness).toEqual({
      distanceMeters: 30000,
      activeMinutes: 90,
      source: "strava",
    });
  });

  it("summarizes todoist completed task signals", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      items: [
        {
          content: "Finalize sprint plan",
          completed_date: "2026-04-06T09:00:00.000Z",
          project_id: "1001",
        },
        {
          content: "Buy groceries",
          completed_date: "2026-04-06T18:30:00.000Z",
          project_id: "1002",
        },
        {
          content: "Outside window",
          completed_date: "2026-04-07T09:00:00.000Z",
          project_id: "1003",
        },
      ],
      projects: [
        { id: "1001", name: "Work" },
        { id: "1002", name: "Personal" },
      ],
    });

    const adapter = resolveIntegrationSyncAdapter("todoist");
    const result = await adapter.execute({
      ...(BASE_SYNC_INPUT as any),
      requestJson,
    });

    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(requestJson.mock.calls[0]?.[0]).toContain(
      "api.todoist.com/sync/v9/completed/get_all",
    );
    expect(result.summary).toBe(
      "Todoist: 2 tasks completed across 2 projects.",
    );
    expect(result.signals).toEqual([
      "2 completed Todoist tasks",
      "2 active Todoist projects",
      "Work",
      "Personal",
      "Finalize sprint plan",
      "Buy groceries",
    ]);
  });

  it("normalizes google fit aggregate payloads with valid metrics", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      bucket: [
        {
          dataset: [
            {
              point: [
                {
                  value: [{ intVal: 1200 }],
                  startTimeNanos: "0",
                  endTimeNanos: "0",
                },
                {
                  value: [{ intVal: 300 }],
                  startTimeNanos: "0",
                  endTimeNanos: "0",
                },
                {
                  value: [{ intVal: -3 }],
                  startTimeNanos: "0",
                  endTimeNanos: "0",
                },
                {
                  startTimeNanos: "1000000000",
                  endTimeNanos: "7201000000000",
                },
                {
                  startTimeNanos: "invalid",
                  endTimeNanos: "10",
                },
              ],
            },
          ],
        },
      ],
    });

    const adapter = resolveIntegrationSyncAdapter("google_fit");
    const result = await adapter.execute({
      ...(BASE_SYNC_INPUT as any),
      requestJson,
    });

    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(requestJson.mock.calls[0]?.[0]).toBe(
      "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate",
    );
    expect(requestJson.mock.calls[0]?.[3]).toMatchObject({ method: "POST" });
    expect(result.metrics).toEqual({ steps: 1500, sleepMinutes: 120 });
    expect(result.summary).toBe("Google Fit: 1,500 steps, 120 sleep minutes.");
    expect(result.signals).toEqual(["1,500 steps", "120 sleep minutes"]);
    expect(result.context?.fitness).toEqual({
      steps: 1500,
      source: "google_fit",
    });
  });

  it("normalizes notion updated pages for the target day", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      results: [
        {
          object: "page",
          last_edited_time: "2026-04-06T09:00:00.000Z",
          properties: {
            Name: {
              type: "title",
              title: [{ plain_text: "Daily Notes" }],
            },
          },
        },
        {
          object: "page",
          last_edited_time: "2026-04-07T09:00:00.000Z",
          properties: {
            Name: {
              type: "title",
              title: [{ plain_text: "Outside Window" }],
            },
          },
        },
      ],
    });

    const adapter = resolveIntegrationSyncAdapter("notion");
    const result = await adapter.execute({
      ...(BASE_SYNC_INPUT as any),
      requestJson,
    });

    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(requestJson.mock.calls[0]?.[0]).toBe(
      "https://api.notion.com/v1/search",
    );
    expect(requestJson.mock.calls[0]?.[3]).toMatchObject({ method: "POST" });
    expect(result.summary).toBe("Notion: 1 recently updated page.");
    expect(result.signals).toEqual(["1 updated Notion pages", "Daily Notes"]);
  });

  it("summarizes gmail message volume and sender diversity", async () => {
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [{ id: "m1" }, { id: "m2" }],
        resultSizeEstimate: 2,
      })
      .mockResolvedValueOnce({
        payload: {
          headers: [
            { name: "From", value: "Alice <alice@example.com>" },
            { name: "Subject", value: "Project update" },
          ],
        },
      })
      .mockResolvedValueOnce({
        payload: {
          headers: [
            { name: "From", value: "Bob <bob@example.com>" },
            { name: "Subject", value: "Meeting notes" },
          ],
        },
      });

    const adapter = resolveIntegrationSyncAdapter("gmail_summary");
    const result = await adapter.execute({
      ...(BASE_SYNC_INPUT as any),
      requestJson,
    });

    expect(requestJson).toHaveBeenCalledTimes(3);
    expect(requestJson.mock.calls[0]?.[0]).toContain(
      "gmail.googleapis.com/gmail/v1/users/me/messages",
    );
    expect(result.summary).toBe("Gmail: 2 messages from 2 senders.");
    expect(result.signals).toEqual([
      "2 Gmail messages",
      "2 unique senders",
      "Project update",
      "Meeting notes",
    ]);
  });

  it("throws an explicit adapter error for apple health sync", async () => {
    const adapter = resolveIntegrationSyncAdapter("apple_health");

    await expect(
      adapter.execute({
        ...(BASE_SYNC_INPUT as any),
        requestJson: vi.fn(),
      }),
    ).rejects.toMatchObject({
      name: "ProviderAdapterError",
      message:
        "Apple Health sync requires client-device upload. Use syncAppleHealthDailyData from mobile.",
      retryable: false,
    });
  });

  it("retries OpenAI on 429 and normalizes successful output", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: vi.fn().mockResolvedValue("rate-limited"),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  story: "  Productive day  ",
                  highlights: ["  Deep work  ", "", 42, "walk"],
                  metrics: {
                    steps: 2200,
                    sleepMinutes: Number.NaN,
                    screenTimeMinutes: 120,
                    spendingTotal: null,
                  },
                  sourcesUsed: ["  Calendar  ", "", 99, "Spotify"],
                }),
              },
            },
          ],
        }),
      });

    vi.stubGlobal("fetch", fetchMock as any);

    const adapter = resolveSummaryModelAdapter("openai");
    const pending = adapter.execute({
      dayKey: "2026-04-06",
      modelInput: "{}",
      apiKey: "test-key",
    });

    await vi.runAllTimersAsync();
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      story: "Productive day",
      highlights: ["Deep work", "walk"],
      metrics: {
        steps: 2200,
        sleepMinutes: undefined,
        screenTimeMinutes: 120,
        spendingTotal: undefined,
      },
      sourcesUsed: ["Calendar", "Spotify"],
    });
  });

  it("returns a safe authentication error for OpenAI 401 failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue("unauthorized"),
    });
    vi.stubGlobal("fetch", fetchMock as any);

    const adapter = resolveSummaryModelAdapter("openai");

    await expect(
      adapter.execute({
        dayKey: "2026-04-06",
        modelInput: "{}",
        apiKey: "test-key",
      }),
    ).rejects.toMatchObject({
      name: "ProviderAdapterError",
      message: "OpenAI authentication failed (401)",
      statusCode: 401,
      retryable: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws explicit output errors for empty and invalid OpenAI payloads", async () => {
    const adapter = resolveSummaryModelAdapter("openai");

    const emptyFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [] }),
    });
    vi.stubGlobal("fetch", emptyFetch as any);

    await expect(
      adapter.execute({
        dayKey: "2026-04-06",
        modelInput: "{}",
        apiKey: "test-key",
      }),
    ).rejects.toMatchObject({
      name: "ProviderAdapterError",
      message: "OpenAI summary output was empty.",
    });

    const invalidJsonFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "not-json" } }],
      }),
    });
    vi.stubGlobal("fetch", invalidJsonFetch as any);

    await expect(
      adapter.execute({
        dayKey: "2026-04-06",
        modelInput: "{}",
        apiKey: "test-key",
      }),
    ).rejects.toMatchObject({
      name: "ProviderAdapterError",
      message: "OpenAI summary output was not valid JSON.",
    });
  });
});
