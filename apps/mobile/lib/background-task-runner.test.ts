import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBackgroundTaskRunner,
  type BackgroundTaskExecutionEvent,
} from "./background-task-runner";

describe("background task runner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs due tasks through a single queue", async () => {
    const executionOrder: string[] = [];
    const events: BackgroundTaskExecutionEvent[] = [];

    const runner = createBackgroundTaskRunner({
      tickIntervalMs: 25,
      onExecution: (event) => {
        events.push(event);
      },
    });

    runner.registerTask({
      taskId: "life_context",
      intervalMs: 60_000,
      run: async () => {
        executionOrder.push("life_context");
      },
    });

    runner.registerTask({
      taskId: "location_flush",
      intervalMs: 60_000,
      run: async () => {
        executionOrder.push("location_flush");
      },
    });

    runner.start();
    runner.triggerTaskNow("life_context");
    runner.triggerTaskNow("location_flush");

    await vi.advanceTimersByTimeAsync(100);

    expect(executionOrder).toEqual(["life_context", "location_flush"]);
    expect(
      events
        .filter((event) => event.status === "started")
        .map((event) => event.taskId),
    ).toEqual(["life_context", "location_flush"]);

    runner.stop();
  });

  it("retries with backoff and isolates failures per task", async () => {
    let flakyRuns = 0;
    let healthyRuns = 0;
    const events: BackgroundTaskExecutionEvent[] = [];

    const runner = createBackgroundTaskRunner({
      tickIntervalMs: 25,
      onExecution: (event) => {
        events.push(event);
      },
    });

    runner.registerTask({
      taskId: "flaky_pipeline",
      intervalMs: 60_000,
      retryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 500,
      },
      run: async () => {
        flakyRuns += 1;
        if (flakyRuns < 3) {
          throw new Error(`flaky failure ${flakyRuns}`);
        }
      },
    });

    runner.registerTask({
      taskId: "healthy_pipeline",
      intervalMs: 150,
      run: async () => {
        healthyRuns += 1;
      },
    });

    runner.start();
    runner.triggerTaskNow("flaky_pipeline");
    runner.triggerTaskNow("healthy_pipeline");

    await vi.advanceTimersByTimeAsync(1_000);

    expect(flakyRuns).toBe(3);
    expect(healthyRuns).toBeGreaterThanOrEqual(2);

    const retryEvents = events.filter(
      (event) =>
        event.taskId === "flaky_pipeline" && event.status === "retry_scheduled",
    );
    expect(retryEvents).toHaveLength(2);

    const healthySuccesses = events.filter(
      (event) =>
        event.taskId === "healthy_pipeline" && event.status === "succeeded",
    );
    expect(healthySuccesses.length).toBeGreaterThanOrEqual(2);

    runner.stop();
  });

  it("stops scheduling when stopped", async () => {
    let runs = 0;

    const runner = createBackgroundTaskRunner({
      tickIntervalMs: 20,
    });

    runner.registerTask({
      taskId: "stop_check",
      intervalMs: 100,
      run: async () => {
        runs += 1;
      },
    });

    runner.start();
    runner.triggerTaskNow("stop_check");

    await vi.advanceTimersByTimeAsync(50);
    expect(runs).toBe(1);

    runner.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(runs).toBe(1);
  });
});
