export type BackgroundTaskRetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export type BackgroundTaskDefinition = {
  taskId: string;
  intervalMs: number;
  run: () => Promise<void>;
  initialDelayMs?: number;
  retryPolicy?: Partial<BackgroundTaskRetryPolicy>;
};

export type BackgroundTaskExecutionStatus =
  | "queued"
  | "started"
  | "succeeded"
  | "failed"
  | "retry_scheduled";

export type BackgroundTaskExecutionEvent = {
  taskId: string;
  status: BackgroundTaskExecutionStatus;
  attempt: number;
  queueDepth: number;
  queuedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  nextRunAt?: number;
  error?: string;
};

export type BackgroundTaskSnapshot = {
  taskId: string;
  nextRunAt: number;
  queued: boolean;
  running: boolean;
  retryFailures: number;
  lastStartedAt?: number;
  lastFinishedAt?: number;
  lastDurationMs?: number;
  lastError?: string;
};

export type BackgroundTaskRunnerOptions = {
  tickIntervalMs?: number;
  onExecution?: (event: BackgroundTaskExecutionEvent) => void;
};

export type BackgroundTaskRunner = {
  start: () => void;
  stop: () => void;
  registerTask: (task: BackgroundTaskDefinition) => void;
  unregisterTask: (taskId: string) => void;
  triggerTaskNow: (taskId: string) => void;
  getSnapshots: () => BackgroundTaskSnapshot[];
};

type QueuedTask = {
  taskId: string;
  queuedAt: number;
};

type InternalTaskState = {
  definition: BackgroundTaskDefinition;
  retryPolicy: BackgroundTaskRetryPolicy;
  nextRunAt: number;
  queued: boolean;
  running: boolean;
  retryFailures: number;
  lastStartedAt?: number;
  lastFinishedAt?: number;
  lastDurationMs?: number;
  lastError?: string;
};

const DEFAULT_TICK_INTERVAL_MS = 1_000;
const DEFAULT_RETRY_POLICY: BackgroundTaskRetryPolicy = {
  maxAttempts: 0,
  baseDelayMs: 10_000,
  maxDelayMs: 5 * 60_000,
};

function clampPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.round(value);
}

function normalizeRetryPolicy(
  policy: Partial<BackgroundTaskRetryPolicy> | undefined,
): BackgroundTaskRetryPolicy {
  const maxAttempts = clampPositiveInt(
    policy?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
    DEFAULT_RETRY_POLICY.maxAttempts,
  );
  const baseDelayMs = clampPositiveInt(
    policy?.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs,
    DEFAULT_RETRY_POLICY.baseDelayMs,
  );
  const maxDelayMs = clampPositiveInt(
    policy?.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs,
    DEFAULT_RETRY_POLICY.maxDelayMs,
  );

  return {
    maxAttempts,
    baseDelayMs: Math.min(baseDelayMs, maxDelayMs),
    maxDelayMs,
  };
}

function normalizeTaskDefinition(
  task: BackgroundTaskDefinition,
): BackgroundTaskDefinition {
  return {
    ...task,
    intervalMs: clampPositiveInt(task.intervalMs, 60_000),
    initialDelayMs:
      task.initialDelayMs === undefined
        ? undefined
        : clampPositiveInt(task.initialDelayMs, 0),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Task failed";
}

function computeBackoffDelayMs(
  policy: BackgroundTaskRetryPolicy,
  retryFailures: number,
): number {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, retryFailures - 1);
  return Math.min(policy.maxDelayMs, exponential);
}

export function createBackgroundTaskRunner(
  options: BackgroundTaskRunnerOptions = {},
): BackgroundTaskRunner {
  const tasks = new Map<string, InternalTaskState>();
  const queue: QueuedTask[] = [];

  const tickIntervalMs = clampPositiveInt(
    options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS,
    DEFAULT_TICK_INTERVAL_MS,
  );

  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let queueProcessing = false;

  const emitExecution = (event: BackgroundTaskExecutionEvent): void => {
    options.onExecution?.(event);
  };

  const enqueueDueTasks = (): void => {
    const now = Date.now();

    for (const [taskId, taskState] of tasks) {
      if (taskState.running || taskState.queued || now < taskState.nextRunAt) {
        continue;
      }

      taskState.queued = true;
      const queuedTask: QueuedTask = {
        taskId,
        queuedAt: now,
      };
      queue.push(queuedTask);

      emitExecution({
        taskId,
        status: "queued",
        attempt: taskState.retryFailures + 1,
        queueDepth: queue.length,
        queuedAt: queuedTask.queuedAt,
        nextRunAt: taskState.nextRunAt,
      });
    }
  };

  const processQueue = async (): Promise<void> => {
    if (queueProcessing || !started) {
      return;
    }

    queueProcessing = true;

    try {
      while (queue.length > 0 && started) {
        const nextQueuedTask = queue.shift();
        if (!nextQueuedTask) {
          continue;
        }

        const taskState = tasks.get(nextQueuedTask.taskId);
        if (!taskState) {
          continue;
        }

        taskState.queued = false;

        if (taskState.running) {
          continue;
        }

        taskState.running = true;

        const attempt = taskState.retryFailures + 1;
        const startedAt = Date.now();

        emitExecution({
          taskId: taskState.definition.taskId,
          status: "started",
          attempt,
          queueDepth: queue.length,
          queuedAt: nextQueuedTask.queuedAt,
          startedAt,
        });

        try {
          await taskState.definition.run();

          const finishedAt = Date.now();
          const durationMs = Math.max(0, finishedAt - startedAt);

          taskState.running = false;
          taskState.retryFailures = 0;
          taskState.nextRunAt = finishedAt + taskState.definition.intervalMs;
          taskState.lastStartedAt = startedAt;
          taskState.lastFinishedAt = finishedAt;
          taskState.lastDurationMs = durationMs;
          taskState.lastError = undefined;

          emitExecution({
            taskId: taskState.definition.taskId,
            status: "succeeded",
            attempt,
            queueDepth: queue.length,
            startedAt,
            finishedAt,
            durationMs,
            nextRunAt: taskState.nextRunAt,
          });
        } catch (error) {
          const finishedAt = Date.now();
          const durationMs = Math.max(0, finishedAt - startedAt);
          const errorMessage = toErrorMessage(error);

          taskState.running = false;
          taskState.lastStartedAt = startedAt;
          taskState.lastFinishedAt = finishedAt;
          taskState.lastDurationMs = durationMs;
          taskState.lastError = errorMessage;

          emitExecution({
            taskId: taskState.definition.taskId,
            status: "failed",
            attempt,
            queueDepth: queue.length,
            startedAt,
            finishedAt,
            durationMs,
            error: errorMessage,
          });

          if (taskState.retryFailures < taskState.retryPolicy.maxAttempts) {
            taskState.retryFailures += 1;

            const retryDelayMs = computeBackoffDelayMs(
              taskState.retryPolicy,
              taskState.retryFailures,
            );
            taskState.nextRunAt = finishedAt + retryDelayMs;

            emitExecution({
              taskId: taskState.definition.taskId,
              status: "retry_scheduled",
              attempt: taskState.retryFailures + 1,
              queueDepth: queue.length,
              finishedAt,
              nextRunAt: taskState.nextRunAt,
              error: errorMessage,
            });
          } else {
            taskState.retryFailures = 0;
            taskState.nextRunAt = finishedAt + taskState.definition.intervalMs;
          }
        }
      }
    } finally {
      queueProcessing = false;
    }
  };

  const triggerTaskNow = (taskId: string): void => {
    const taskState = tasks.get(taskId);
    if (!taskState) {
      return;
    }

    taskState.nextRunAt = Date.now();
    enqueueDueTasks();
    void processQueue();
  };

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      enqueueDueTasks();
      void processQueue();

      timer = setInterval(() => {
        enqueueDueTasks();
        void processQueue();
      }, tickIntervalMs);
    },

    stop() {
      started = false;

      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      queue.length = 0;
      for (const taskState of tasks.values()) {
        taskState.queued = false;
      }
    },

    registerTask(task: BackgroundTaskDefinition) {
      const normalizedTask = normalizeTaskDefinition(task);
      const now = Date.now();
      tasks.set(normalizedTask.taskId, {
        definition: normalizedTask,
        retryPolicy: normalizeRetryPolicy(normalizedTask.retryPolicy),
        nextRunAt: now + (normalizedTask.initialDelayMs ?? 0),
        queued: false,
        running: false,
        retryFailures: 0,
      });

      if (started) {
        enqueueDueTasks();
        void processQueue();
      }
    },

    unregisterTask(taskId: string) {
      tasks.delete(taskId);
    },

    triggerTaskNow,

    getSnapshots() {
      return Array.from(tasks.values()).map((taskState) => ({
        taskId: taskState.definition.taskId,
        nextRunAt: taskState.nextRunAt,
        queued: taskState.queued,
        running: taskState.running,
        retryFailures: taskState.retryFailures,
        lastStartedAt: taskState.lastStartedAt,
        lastFinishedAt: taskState.lastFinishedAt,
        lastDurationMs: taskState.lastDurationMs,
        lastError: taskState.lastError,
      }));
    },
  };
}
