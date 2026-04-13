import { describe, expect, it, vi } from "vitest";

import { fetchJson } from "./data-fetch";

type MockResponseInit = {
  ok: boolean;
  status: number;
  statusText: string;
  headers?: Record<string, string>;
  jsonValue?: unknown;
  textValue?: string;
};

function createMockResponse(init: MockResponseInit): Response {
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText,
    headers: {
      get(name: string) {
        const key = Object.keys(init.headers ?? {}).find(
          (candidate) => candidate.toLowerCase() === name.toLowerCase(),
        );
        return key ? (init.headers?.[key] ?? null) : null;
      },
    } as unknown as Headers,
    json: vi.fn(async () => init.jsonValue),
    text: vi.fn(async () => init.textValue ?? ""),
  } as unknown as Response;
}

describe("mobile data fetch logic", () => {
  it("sends Accept header and parses json payload", async () => {
    const fetchMock = vi.fn(async () =>
      createMockResponse({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json; charset=utf-8" },
        jsonValue: { id: "memory_1", title: "Morning run" },
      }),
    );

    const payload = await fetchJson<{ id: string; title: string }>(
      "https://api.example.com/memories/1",
      {
        init: {
          method: "GET",
        },
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );

    expect(payload).toEqual({ id: "memory_1", title: "Morning run" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/memories/1",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    );
  });

  it("throws descriptive error when upstream request fails", async () => {
    const fetchMock = vi.fn(async () =>
      createMockResponse({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        textValue: "temporary outage",
      }),
    );

    await expect(
      fetchJson("https://api.example.com/memories", {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(
      "Request failed (503 Service Unavailable) - temporary outage",
    );
  });

  it("fails fast when response is not json", async () => {
    const fetchMock = vi.fn(async () =>
      createMockResponse({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/plain" },
        jsonValue: { ignored: true },
      }),
    );

    await expect(
      fetchJson("https://api.example.com/plain", {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Expected JSON response content-type");
  });
});
