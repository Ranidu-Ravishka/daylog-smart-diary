import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocationTrackPoint } from "./location-stay-points";

const LOCATION_QUEUE_STORAGE_KEY = "daylog.background_location.points";
const LOCATION_QUEUE_SCOPE_KEY = "daylog.background_location.points.scope.v1";
const SECURE_KEY_PREFIX = "daylog.background_location.points.key.v1.";

const { asyncStorageState, secureStoreState, randomSeed } = vi.hoisted(() => ({
  asyncStorageState: new Map<string, string>(),
  secureStoreState: new Map<string, string>(),
  randomSeed: { value: 1 },
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

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string): Promise<string | null> => {
    return secureStoreState.get(key) ?? null;
  }),
  setItemAsync: vi.fn(async (key: string, value: string): Promise<void> => {
    secureStoreState.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string): Promise<void> => {
    secureStoreState.delete(key);
  }),
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: {
    SHA256: "SHA256",
  },
  digestStringAsync: vi.fn(async (_algorithm: string, value: string) => {
    return `mock-sha256:${value}`;
  }),
  getRandomBytes: vi.fn((length: number) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = (randomSeed.value + index) % 256;
    }

    randomSeed.value = (randomSeed.value + 37) % 256;
    return bytes;
  }),
}));

type SecureLocationQueueModule = typeof import("./secure-location-queue");

async function loadModule(): Promise<SecureLocationQueueModule> {
  return await import("./secure-location-queue");
}

function keyNameForScope(scope: string): string {
  return `${SECURE_KEY_PREFIX}mock-sha256:${scope}`;
}

describe("secure location queue", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    asyncStorageState.clear();
    secureStoreState.clear();
    randomSeed.value = 1;
  });

  it("migrates legacy plaintext queue payloads to encrypted envelopes", async () => {
    const secureQueue = await loadModule();

    const validPointA: LocationTrackPoint = {
      latitude: 6.9271,
      longitude: 79.8612,
      timestampMs: 1_740_000_000_000,
      accuracyMeters: 9,
    };
    const validPointB: LocationTrackPoint = {
      latitude: 6.9272,
      longitude: 79.8613,
      timestampMs: 1_740_000_030_000,
      accuracyMeters: 12,
    };

    asyncStorageState.set(LOCATION_QUEUE_SCOPE_KEY, "user-1:session-1");
    asyncStorageState.set(
      LOCATION_QUEUE_STORAGE_KEY,
      JSON.stringify([
        validPointA,
        {
          latitude: "bad",
          longitude: 79.8613,
          timestampMs: 1_740_000_060_000,
        },
        validPointB,
      ]),
    );

    await expect(secureQueue.loadLocationQueueForSync()).resolves.toEqual([
      validPointA,
      validPointB,
    ]);

    const persistedQueueRaw = asyncStorageState.get(LOCATION_QUEUE_STORAGE_KEY);
    expect(persistedQueueRaw).toBeTruthy();

    const persistedQueue = JSON.parse(persistedQueueRaw ?? "null") as {
      version: number;
      keyId: string;
      pointCount: number;
      nonceHex: string;
      cipherHex: string;
    };

    expect(Array.isArray(persistedQueue)).toBe(false);
    expect(persistedQueue.version).toBe(1);
    expect(persistedQueue.keyId).toBe("mock-sha256:user-1:session-1");
    expect(persistedQueue.pointCount).toBe(2);
    expect(typeof persistedQueue.nonceHex).toBe("string");
    expect(typeof persistedQueue.cipherHex).toBe("string");
    expect(secureStoreState.has(keyNameForScope("user-1:session-1"))).toBe(
      true,
    );

    await expect(secureQueue.getLocationQueueSize()).resolves.toBe(2);
  });

  it("returns an empty queue when encrypted payload integrity is broken", async () => {
    const secureQueue = await loadModule();

    await secureQueue.setLocationQueueSessionScope("user-2:session-1");
    await secureQueue.saveLocationQueue([
      {
        latitude: 6.91,
        longitude: 79.85,
        timestampMs: 1_740_001_000_000,
      },
      {
        latitude: 6.92,
        longitude: 79.86,
        timestampMs: 1_740_001_030_000,
      },
    ]);

    const encryptedRaw = asyncStorageState.get(LOCATION_QUEUE_STORAGE_KEY);
    expect(encryptedRaw).toBeTruthy();

    const tamperedEnvelope = JSON.parse(encryptedRaw ?? "null") as {
      cipherHex: string;
    };

    tamperedEnvelope.cipherHex = `00${tamperedEnvelope.cipherHex.slice(2)}`;
    asyncStorageState.set(
      LOCATION_QUEUE_STORAGE_KEY,
      JSON.stringify(tamperedEnvelope),
    );

    await expect(secureQueue.loadLocationQueueForSync()).resolves.toEqual([]);
  });

  it("rotates key scope by session while preserving queued points", async () => {
    const secureQueue = await loadModule();

    const originalScope = "user-3:session-1";
    const nextScope = "user-3:session-2";
    const queuedPoints: LocationTrackPoint[] = [
      {
        latitude: 7.001,
        longitude: 80.001,
        timestampMs: 1_740_002_000_000,
      },
      {
        latitude: 7.002,
        longitude: 80.002,
        timestampMs: 1_740_002_050_000,
      },
    ];

    await secureQueue.setLocationQueueSessionScope(originalScope);
    await secureQueue.saveLocationQueue(queuedPoints);

    expect(secureStoreState.has(keyNameForScope(originalScope))).toBe(true);

    await secureQueue.setLocationQueueSessionScope(nextScope);

    await expect(secureQueue.loadLocationQueueForSync()).resolves.toEqual(
      queuedPoints,
    );
    expect(asyncStorageState.get(LOCATION_QUEUE_SCOPE_KEY)).toBe(nextScope);
    expect(secureStoreState.has(keyNameForScope(originalScope))).toBe(false);
    expect(secureStoreState.has(keyNameForScope(nextScope))).toBe(true);
  });
});
