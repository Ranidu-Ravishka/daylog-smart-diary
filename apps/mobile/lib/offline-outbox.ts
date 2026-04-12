import AsyncStorage from "@react-native-async-storage/async-storage";

type OutboxEntryKind =
  | "create_memory"
  | "append_day_log"
  | "upload_memory_media";

type OutboxEntryBase = {
  id: string;
  kind: OutboxEntryKind;
  createdAt: number;
  attempts: number;
  nextRetryAt: number;
  lastError?: string;
};

export type CreateMemoryOutboxPayload = {
  clientRequestId: string;
  title: string;
  description?: string;
  mood?: string;
  happenedAt: number;
  dayKey: string;
};

export type AppendDayLogOutboxPayload = {
  dayKey: string;
  rating?: number;
  manualNotesToAdd?: string[];
  peopleTagsToAdd?: string[];
};

export type UploadMemoryMediaOutboxPayload = {
  memoryClientRequestId: string;
  mediaClientRequestId: string;
  localUri: string;
  width?: number;
  height?: number;
};

type CreateMemoryOutboxEntry = OutboxEntryBase & {
  kind: "create_memory";
  payload: CreateMemoryOutboxPayload;
};

type AppendDayLogOutboxEntry = OutboxEntryBase & {
  kind: "append_day_log";
  payload: AppendDayLogOutboxPayload;
};

type UploadMemoryMediaOutboxEntry = OutboxEntryBase & {
  kind: "upload_memory_media";
  payload: UploadMemoryMediaOutboxPayload;
};

export type OfflineOutboxEntry =
  | CreateMemoryOutboxEntry
  | AppendDayLogOutboxEntry
  | UploadMemoryMediaOutboxEntry;

export type OfflineOutboxLastSyncResult = {
  status: "success" | "partial" | "error";
  updatedAt: number;
  processed: number;
  succeeded: number;
  retried: number;
  dropped: number;
  pending: number;
  message: string;
};

type PersistedOutboxEnvelopeV1 = {
  version: 1;
  updatedAt: number;
  queue: OfflineOutboxEntry[];
};

type PersistedOutboxEnvelopeV2 = {
  version: 2;
  updatedAt: number;
  queue: OfflineOutboxEntry[];
  lastSyncResult?: OfflineOutboxLastSyncResult;
};

type PersistedOutboxEnvelope =
  | PersistedOutboxEnvelopeV1
  | PersistedOutboxEnvelopeV2;

type OutboxState = {
  queue: OfflineOutboxEntry[];
  lastSyncResult?: OfflineOutboxLastSyncResult;
};

export type OfflineOutboxProcessHandlers = {
  createMemory: (payload: CreateMemoryOutboxPayload) => Promise<void>;
  appendDayLog: (payload: AppendDayLogOutboxPayload) => Promise<void>;
  uploadMemoryMedia: (payload: UploadMemoryMediaOutboxPayload) => Promise<void>;
};

export type OfflineOutboxProcessResult = {
  processed: number;
  succeeded: number;
  retried: number;
  dropped: number;
  pending: number;
};

const STORAGE_KEY = "daylog.mobile.offline_outbox.v1";
const MAX_QUEUE_SIZE = 300;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const BASE_RETRY_DELAY_MS = 5_000;

function nowMs(): number {
  return Date.now();
}

function createOperationId(kind: OfflineOutboxEntry["kind"]): string {
  const time = nowMs();
  const randomPart = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");

  return `obox_${kind}_${time}_${randomPart}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Unknown outbox processing error";
}

function normalizeStringArray(items: string[] | undefined): string[] {
  if (!items || items.length === 0) {
    return [];
  }

  return items.map((item) => item.trim()).filter(Boolean);
}

function dedupeItems(items: string[]): string[] {
  return Array.from(new Set(items));
}

function mergeAppendPayload(
  current: AppendDayLogOutboxPayload,
  next: AppendDayLogOutboxPayload,
): AppendDayLogOutboxPayload {
  return {
    dayKey: current.dayKey,
    rating: next.rating ?? current.rating,
    manualNotesToAdd: dedupeItems([
      ...normalizeStringArray(current.manualNotesToAdd),
      ...normalizeStringArray(next.manualNotesToAdd),
    ]),
    peopleTagsToAdd: dedupeItems([
      ...normalizeStringArray(current.peopleTagsToAdd),
      ...normalizeStringArray(next.peopleTagsToAdd),
    ]),
  };
}

function sanitizeCreateMemoryPayload(
  payload: CreateMemoryOutboxPayload,
): CreateMemoryOutboxPayload {
  return {
    clientRequestId: payload.clientRequestId.trim(),
    title: payload.title.trim(),
    description: payload.description?.trim() || undefined,
    mood: payload.mood?.trim() || undefined,
    happenedAt: Math.round(payload.happenedAt),
    dayKey: payload.dayKey.trim(),
  };
}

function sanitizeAppendDayLogPayload(
  payload: AppendDayLogOutboxPayload,
): AppendDayLogOutboxPayload {
  const manualNotesToAdd = dedupeItems(
    normalizeStringArray(payload.manualNotesToAdd),
  );
  const peopleTagsToAdd = dedupeItems(
    normalizeStringArray(payload.peopleTagsToAdd),
  );

  return {
    dayKey: payload.dayKey.trim(),
    rating:
      typeof payload.rating === "number" && Number.isFinite(payload.rating)
        ? Math.round(payload.rating)
        : undefined,
    manualNotesToAdd:
      manualNotesToAdd.length > 0 ? manualNotesToAdd : undefined,
    peopleTagsToAdd: peopleTagsToAdd.length > 0 ? peopleTagsToAdd : undefined,
  };
}

function sanitizeUploadMemoryMediaPayload(
  payload: UploadMemoryMediaOutboxPayload,
): UploadMemoryMediaOutboxPayload {
  return {
    memoryClientRequestId: payload.memoryClientRequestId.trim(),
    mediaClientRequestId: payload.mediaClientRequestId.trim(),
    localUri: payload.localUri.trim(),
    width:
      typeof payload.width === "number" && Number.isFinite(payload.width)
        ? Math.round(payload.width)
        : undefined,
    height:
      typeof payload.height === "number" && Number.isFinite(payload.height)
        ? Math.round(payload.height)
        : undefined,
  };
}

function isOfflineOutboxLastSyncResult(
  value: unknown,
): value is OfflineOutboxLastSyncResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<OfflineOutboxLastSyncResult>;
  return (
    (candidate.status === "success" ||
      candidate.status === "partial" ||
      candidate.status === "error") &&
    typeof candidate.updatedAt === "number" &&
    typeof candidate.processed === "number" &&
    typeof candidate.succeeded === "number" &&
    typeof candidate.retried === "number" &&
    typeof candidate.dropped === "number" &&
    typeof candidate.pending === "number" &&
    typeof candidate.message === "string"
  );
}

function isOfflineOutboxEntry(value: unknown): value is OfflineOutboxEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<OfflineOutboxEntry>;

  if (
    typeof candidate.id !== "string" ||
    (candidate.kind !== "create_memory" &&
      candidate.kind !== "append_day_log" &&
      candidate.kind !== "upload_memory_media") ||
    typeof candidate.createdAt !== "number" ||
    typeof candidate.attempts !== "number" ||
    typeof candidate.nextRetryAt !== "number"
  ) {
    return false;
  }

  if (candidate.kind === "create_memory") {
    const payload = candidate.payload as Partial<CreateMemoryOutboxPayload>;
    return (
      payload &&
      typeof payload.clientRequestId === "string" &&
      typeof payload.title === "string" &&
      typeof payload.happenedAt === "number" &&
      typeof payload.dayKey === "string"
    );
  }

  if (candidate.kind === "upload_memory_media") {
    const payload =
      candidate.payload as Partial<UploadMemoryMediaOutboxPayload>;
    return (
      payload &&
      typeof payload.memoryClientRequestId === "string" &&
      payload.memoryClientRequestId.trim().length > 0 &&
      typeof payload.mediaClientRequestId === "string" &&
      payload.mediaClientRequestId.trim().length > 0 &&
      typeof payload.localUri === "string" &&
      payload.localUri.trim().length > 0
    );
  }

  const payload = candidate.payload as Partial<AppendDayLogOutboxPayload>;
  return payload && typeof payload.dayKey === "string";
}

function sanitizeQueue(queue: OfflineOutboxEntry[]): OfflineOutboxEntry[] {
  const sorted = [...queue]
    .filter(isOfflineOutboxEntry)
    .sort((left, right) => left.createdAt - right.createdAt);

  if (sorted.length <= MAX_QUEUE_SIZE) {
    return sorted;
  }

  return sorted.slice(sorted.length - MAX_QUEUE_SIZE);
}

async function readOutboxState(): Promise<OutboxState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { queue: [] };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedOutboxEnvelope>;
    if (!Array.isArray(parsed.queue)) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return { queue: [] };
    }

    if (parsed.version === 1) {
      return {
        queue: sanitizeQueue(parsed.queue as OfflineOutboxEntry[]),
      };
    }

    if (parsed.version === 2) {
      return {
        queue: sanitizeQueue(parsed.queue as OfflineOutboxEntry[]),
        lastSyncResult: isOfflineOutboxLastSyncResult(parsed.lastSyncResult)
          ? parsed.lastSyncResult
          : undefined,
      };
    }

    await AsyncStorage.removeItem(STORAGE_KEY);
    return { queue: [] };
  } catch {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return { queue: [] };
  }
}

async function writeOutboxState(state: OutboxState): Promise<void> {
  const envelope: PersistedOutboxEnvelopeV2 = {
    version: 2,
    updatedAt: nowMs(),
    queue: sanitizeQueue(state.queue),
    lastSyncResult: state.lastSyncResult,
  };

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

function computeRetryDelayMs(attempts: number): number {
  const exponential = BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(MAX_RETRY_DELAY_MS, exponential);
}

export function isLikelyTransientNetworkError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();

  if (message.includes("memory not found for clientrequestid")) {
    return true;
  }

  if (
    message.includes("status 500") ||
    message.includes("status 502") ||
    message.includes("status 503") ||
    message.includes("status 504") ||
    message.includes("status 429") ||
    message.includes("status 408")
  ) {
    return true;
  }

  if (
    message.includes("conflict: clientrequestid") ||
    message.includes("conflict: clientmediaid") ||
    message.includes("plan limit") ||
    message.includes("invalid") ||
    message.includes("forbidden") ||
    message.includes("unauthorized")
  ) {
    return false;
  }

  return (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("connection") ||
    message.includes("offline") ||
    message.includes("socket")
  );
}

export async function enqueueOfflineCreateMemory(
  payload: CreateMemoryOutboxPayload,
): Promise<void> {
  const sanitizedPayload = sanitizeCreateMemoryPayload(payload);
  const state = await readOutboxState();
  const queue = state.queue;

  const existing = queue.find(
    (item) =>
      item.kind === "create_memory" &&
      item.payload.clientRequestId === sanitizedPayload.clientRequestId,
  );

  if (existing) {
    return;
  }

  const nextEntry: CreateMemoryOutboxEntry = {
    id: createOperationId("create_memory"),
    kind: "create_memory",
    createdAt: nowMs(),
    attempts: 0,
    nextRetryAt: nowMs(),
    payload: sanitizedPayload,
  };

  await writeOutboxState({
    ...state,
    queue: [...queue, nextEntry],
  });
}

export async function enqueueOfflineAppendDayLog(
  payload: AppendDayLogOutboxPayload,
): Promise<void> {
  const sanitizedPayload = sanitizeAppendDayLogPayload(payload);
  const state = await readOutboxState();
  const queue = state.queue;

  const existingIndex = queue.findIndex(
    (item) =>
      item.kind === "append_day_log" &&
      item.payload.dayKey === sanitizedPayload.dayKey,
  );

  if (existingIndex >= 0) {
    const existing = queue[existingIndex] as AppendDayLogOutboxEntry;
    const merged = mergeAppendPayload(existing.payload, sanitizedPayload);

    const nextQueue = [...queue];
    nextQueue[existingIndex] = {
      ...existing,
      payload: merged,
      nextRetryAt: Math.min(existing.nextRetryAt, nowMs()),
      lastError: undefined,
    };

    await writeOutboxState({
      ...state,
      queue: nextQueue,
    });
    return;
  }

  const nextEntry: AppendDayLogOutboxEntry = {
    id: createOperationId("append_day_log"),
    kind: "append_day_log",
    createdAt: nowMs(),
    attempts: 0,
    nextRetryAt: nowMs(),
    payload: sanitizedPayload,
  };

  await writeOutboxState({
    ...state,
    queue: [...queue, nextEntry],
  });
}

export async function enqueueOfflineMemoryMediaUpload(
  payload: UploadMemoryMediaOutboxPayload,
): Promise<void> {
  const sanitizedPayload = sanitizeUploadMemoryMediaPayload(payload);
  const state = await readOutboxState();
  const queue = state.queue;

  const existing = queue.find(
    (item) =>
      item.kind === "upload_memory_media" &&
      item.payload.memoryClientRequestId ===
        sanitizedPayload.memoryClientRequestId &&
      item.payload.mediaClientRequestId ===
        sanitizedPayload.mediaClientRequestId,
  );

  if (existing) {
    return;
  }

  const nextEntry: UploadMemoryMediaOutboxEntry = {
    id: createOperationId("upload_memory_media"),
    kind: "upload_memory_media",
    createdAt: nowMs(),
    attempts: 0,
    nextRetryAt: nowMs(),
    payload: sanitizedPayload,
  };

  await writeOutboxState({
    ...state,
    queue: [...queue, nextEntry],
  });
}

async function dispatchOutboxEntry(
  handlers: OfflineOutboxProcessHandlers,
  entry: OfflineOutboxEntry,
): Promise<void> {
  if (entry.kind === "create_memory") {
    await handlers.createMemory(entry.payload);
    return;
  }

  if (entry.kind === "upload_memory_media") {
    await handlers.uploadMemoryMedia(entry.payload);
    return;
  }

  const hasAnyMutation =
    entry.payload.rating !== undefined ||
    (entry.payload.manualNotesToAdd?.length ?? 0) > 0 ||
    (entry.payload.peopleTagsToAdd?.length ?? 0) > 0;

  if (!hasAnyMutation) {
    return;
  }

  await handlers.appendDayLog(entry.payload);
}

function buildLastSyncResult(
  result: OfflineOutboxProcessResult,
  previous: OfflineOutboxLastSyncResult | undefined,
): OfflineOutboxLastSyncResult | undefined {
  if (
    result.processed === 0 &&
    result.succeeded === 0 &&
    result.retried === 0 &&
    result.dropped === 0
  ) {
    return previous;
  }

  let status: OfflineOutboxLastSyncResult["status"] = "success";
  if (result.dropped > 0 && result.succeeded === 0 && result.retried === 0) {
    status = "error";
  } else if (result.retried > 0 || result.dropped > 0) {
    status = "partial";
  }

  let message = `Synced ${result.succeeded} queued item(s).`;
  if (status === "partial") {
    message = `Synced ${result.succeeded}; retrying ${result.retried}; dropped ${result.dropped}.`;
  }
  if (status === "error") {
    message = `Sync failed for ${result.dropped} queued item(s).`;
  }

  return {
    status,
    updatedAt: nowMs(),
    processed: result.processed,
    succeeded: result.succeeded,
    retried: result.retried,
    dropped: result.dropped,
    pending: result.pending,
    message,
  };
}

export async function processOfflineOutbox(
  handlers: OfflineOutboxProcessHandlers,
): Promise<OfflineOutboxProcessResult> {
  const state = await readOutboxState();
  const queue = state.queue;

  if (queue.length === 0) {
    return {
      processed: 0,
      succeeded: 0,
      retried: 0,
      dropped: 0,
      pending: 0,
    };
  }

  const now = nowMs();
  const nextQueue: OfflineOutboxEntry[] = [];
  let processed = 0;
  let succeeded = 0;
  let retried = 0;
  let dropped = 0;

  for (const entry of queue) {
    if (entry.nextRetryAt > now) {
      nextQueue.push(entry);
      continue;
    }

    processed += 1;

    try {
      await dispatchOutboxEntry(handlers, entry);
      succeeded += 1;
      continue;
    } catch (error) {
      const message = toErrorMessage(error);
      const retryable = isLikelyTransientNetworkError(error);

      if (!retryable) {
        dropped += 1;
        continue;
      }

      const attempts = entry.attempts + 1;
      const retryDelayMs = computeRetryDelayMs(attempts);
      nextQueue.push({
        ...entry,
        attempts,
        nextRetryAt: now + retryDelayMs,
        lastError: message,
      });
      retried += 1;
    }
  }

  const result: OfflineOutboxProcessResult = {
    processed,
    succeeded,
    retried,
    dropped,
    pending: nextQueue.length,
  };

  await writeOutboxState({
    queue: nextQueue,
    lastSyncResult: buildLastSyncResult(result, state.lastSyncResult),
  });

  return result;
}

export async function getOfflineOutboxSnapshot(): Promise<{
  pending: number;
  dueNow: number;
  oldestCreatedAt?: number;
  lastSyncResult?: OfflineOutboxLastSyncResult;
}> {
  const state = await readOutboxState();
  const queue = state.queue;
  const now = nowMs();

  return {
    pending: queue.length,
    dueNow: queue.filter((entry) => entry.nextRetryAt <= now).length,
    oldestCreatedAt: queue[0]?.createdAt,
    lastSyncResult: state.lastSyncResult,
  };
}
