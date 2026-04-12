import { beforeEach, describe, expect, it, vi } from "vitest";

const { asyncStorageState } = vi.hoisted(() => ({
  asyncStorageState: new Map<string, string>(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string): Promise<string | null> => {
      return asyncStorageState.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string): Promise<void> => {
      asyncStorageState.set(key, value);
    }),
    removeItem: vi.fn(async (key: string): Promise<void> => {
      asyncStorageState.delete(key);
    }),
  },
}));

type OfflineOutboxModule = typeof import("./offline-outbox");

async function loadModule(): Promise<OfflineOutboxModule> {
  return await import("./offline-outbox");
}

describe("offline outbox", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    asyncStorageState.clear();
  });

  it("deduplicates create-memory items by clientRequestId", async () => {
    const outbox = await loadModule();

    await outbox.enqueueOfflineCreateMemory({
      clientRequestId: "req_001",
      title: "Offline memory",
      description: "Queued",
      mood: "calm",
      happenedAt: 100,
      dayKey: "2026-04-12",
    });

    await outbox.enqueueOfflineCreateMemory({
      clientRequestId: "req_001",
      title: "Offline memory",
      description: "Queued",
      mood: "calm",
      happenedAt: 100,
      dayKey: "2026-04-12",
    });

    const snapshot = await outbox.getOfflineOutboxSnapshot();
    expect(snapshot.pending).toBe(1);
  });

  it("merges append-day-log entries for the same day", async () => {
    const outbox = await loadModule();

    await outbox.enqueueOfflineAppendDayLog({
      dayKey: "2026-04-12",
      manualNotesToAdd: ["Morning run"],
    });

    await outbox.enqueueOfflineAppendDayLog({
      dayKey: "2026-04-12",
      peopleTagsToAdd: ["Alex"],
      rating: 4,
    });

    const appendDayLog = vi.fn(async () => undefined);

    const result = await outbox.processOfflineOutbox({
      createMemory: async () => undefined,
      appendDayLog,
      uploadMemoryMedia: async () => undefined,
    });

    expect(result.succeeded).toBe(1);
    expect(appendDayLog).toHaveBeenCalledTimes(1);
    expect(appendDayLog).toHaveBeenCalledWith({
      dayKey: "2026-04-12",
      manualNotesToAdd: ["Morning run"],
      peopleTagsToAdd: ["Alex"],
      rating: 4,
    });
  });

  it("retries transient failures and drops non-retryable conflicts", async () => {
    const outbox = await loadModule();

    await outbox.enqueueOfflineCreateMemory({
      clientRequestId: "req_transient",
      title: "Retry memory",
      happenedAt: 100,
      dayKey: "2026-04-12",
    });

    await outbox.enqueueOfflineCreateMemory({
      clientRequestId: "req_conflict",
      title: "Conflict memory",
      happenedAt: 200,
      dayKey: "2026-04-12",
    });

    const createMemory = vi.fn(async (payload: { clientRequestId: string }) => {
      if (payload.clientRequestId === "req_transient") {
        throw new Error("Network request failed");
      }

      throw new Error(
        "Conflict: clientRequestId already used for a different memory payload.",
      );
    });

    const first = await outbox.processOfflineOutbox({
      createMemory,
      appendDayLog: async () => undefined,
      uploadMemoryMedia: async () => undefined,
    });

    expect(first.retried).toBe(1);
    expect(first.dropped).toBe(1);

    const snapshot = await outbox.getOfflineOutboxSnapshot();
    expect(snapshot.pending).toBe(1);
  });

  it("queues staged media uploads and tracks last sync result", async () => {
    const outbox = await loadModule();

    await outbox.enqueueOfflineCreateMemory({
      clientRequestId: "req_photo_001",
      title: "Photo memory",
      happenedAt: 100,
      dayKey: "2026-04-12",
    });

    await outbox.enqueueOfflineMemoryMediaUpload({
      memoryClientRequestId: "req_photo_001",
      mediaClientRequestId: "req_photo_001_media_0",
      localUri: "file:///tmp/photo-1.jpg",
      width: 1280,
      height: 720,
    });

    await outbox.enqueueOfflineMemoryMediaUpload({
      memoryClientRequestId: "req_photo_001",
      mediaClientRequestId: "req_photo_001_media_0",
      localUri: "file:///tmp/photo-1.jpg",
      width: 1280,
      height: 720,
    });

    const createMemory = vi.fn(async () => undefined);
    const uploadMemoryMedia = vi.fn(async () => undefined);

    const result = await outbox.processOfflineOutbox({
      createMemory,
      appendDayLog: async () => undefined,
      uploadMemoryMedia,
    });

    expect(result.succeeded).toBe(2);
    expect(createMemory).toHaveBeenCalledTimes(1);
    expect(uploadMemoryMedia).toHaveBeenCalledTimes(1);

    const snapshot = await outbox.getOfflineOutboxSnapshot();
    expect(snapshot.pending).toBe(0);
    expect(snapshot.lastSyncResult?.status).toBe("success");
    expect(snapshot.lastSyncResult?.succeeded).toBe(2);
  });
});
