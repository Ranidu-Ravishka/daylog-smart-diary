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
