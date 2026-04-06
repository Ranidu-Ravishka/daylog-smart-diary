import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderAdapterError,
  executeWithProviderRetry,
  resolveSummaryModelAdapter,
  isRetryableProviderAdapterError,
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
});
