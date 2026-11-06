import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderAdapterError,
  executeWithProviderRetry,
  resolveSummaryModelAdapter,
  isRetryableProviderAdapterError,
  callOpenAiChatJsonWithUsage,
} from "./providerAdapters";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("provider adapter unit behavior", () => {
  it("classifies retryable adapter errors", () => {
    expect(
      isRetryableProviderAdapterError(
        new ProviderAdapterError({
          provider: "openai",
          operation: "summary_generation",
          retryable: true,
          statusCode: 503,
          message: "temporarily unavailable",
        }),
      ),
    ).toBe(true);

    expect(isRetryableProviderAdapterError(new TypeError("network"))).toBe(
      true,
    );
    expect(
      isRetryableProviderAdapterError({ name: "AbortError", message: "x" }),
    ).toBe(true);
    expect(isRetryableProviderAdapterError(new Error("regular"))).toBe(false);
  });

  it("retries retryable provider errors and succeeds", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    const execute = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderAdapterError({
          provider: "openai",
          operation: "summary_generation",
          retryable: true,
          statusCode: 503,
          message: "temporarily unavailable",
        }),
      )
      .mockResolvedValue("ok");

    const pending = executeWithProviderRetry({
      maxAttempts: 3,
      baseBackoffMs: 100,
      execute,
      isRetryable: isRetryableProviderAdapterError,
    });

    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe("ok");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("fails fast for non-retryable errors", async () => {
    const execute = vi.fn().mockRejectedValue(
      new ProviderAdapterError({
        provider: "openai",
        operation: "summary_generation",
        retryable: false,
        statusCode: 400,
        message: "bad request",
      }),
    );

    await expect(
      executeWithProviderRetry({
        maxAttempts: 3,
        baseBackoffMs: 100,
        execute,
        isRetryable: isRetryableProviderAdapterError,
      }),
    ).rejects.toThrow("bad request");

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("wraps non-Error failures with a safe generic error", async () => {
    const execute = vi.fn().mockRejectedValue("non-error-value");

    await expect(
      executeWithProviderRetry({
        maxAttempts: 1,
        baseBackoffMs: 100,
        execute,
        isRetryable: isRetryableProviderAdapterError,
      }),
    ).rejects.toThrow("Provider execution failed unexpectedly.");
  });

  it("rejects unsupported summary model providers", () => {
    expect(() => resolveSummaryModelAdapter("anthropic")).toThrow(
      "Unsupported summary model provider: anthropic",
    );
  });

  it("returns provider usage without exposing credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ ok: true }),
              },
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 7,
            total_tokens: 19,
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callOpenAiChatJsonWithUsage({
      apiKey: "sk-test-secret",
      model: "gpt-4o",
      operation: "test",
      responseFormat: { type: "json_object" },
      messages: [{ role: "user", content: "synthetic" }],
    });

    expect(result).toEqual({
      data: { ok: true },
      usage: { promptTokens: 12, completionTokens: 7, totalTokens: 19 },
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: "Bearer sk-test-secret",
      },
    });
  });
});
