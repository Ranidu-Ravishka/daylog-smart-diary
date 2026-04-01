import { describe, expect, it, vi } from "vitest";
import {
  ProviderAdapterError,
  executeWithProviderRetry,
  isRetryableProviderAdapterError,
} from "./providerAdapters";

describe("provider adapter runtime", () => {
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
});
