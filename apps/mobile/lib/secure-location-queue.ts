import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import nacl from "tweetnacl";
import type { LocationTrackPoint } from "./location-stay-points";

const LOCATION_QUEUE_STORAGE_KEY = "daylog.background_location.points";
const LOCATION_QUEUE_SCOPE_KEY = "daylog.background_location.points.scope.v1";
const SECURE_KEY_PREFIX = "daylog.background_location.points.key.v1.";
const SECURE_STORE_SERVICE = "daylog.location.queue";

const ENCRYPTION_VERSION = 1;
const ENCRYPTION_KEY_BYTES = 32;
const ENCRYPTION_NONCE_BYTES = 24;
const DEFAULT_SESSION_SCOPE = "anonymous";

type QueueKeyMaterial = {
  keyId: string;
  keyBytes: Uint8Array;
};

type EncryptedQueueEnvelope = {
  version: number;
  keyId: string;
  nonceHex: string;
  cipherHex: string;
  pointCount: number;
  updatedAt: number;
};

let activeSessionScopeCache: string | null = null;
let activeKeyMaterialCache: QueueKeyMaterial | null = null;

function normalizeSessionScope(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_SESSION_SCOPE;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(value: string): Uint8Array | null {
  if (value.length === 0 || value.length % 2 !== 0) {
    return null;
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    const pair = value.slice(i, i + 2);
    const parsed = Number.parseInt(pair, 16);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      return null;
    }
    bytes[i / 2] = parsed;
  }

  return bytes;
}

function isEncryptedQueueEnvelope(
  value: unknown,
): value is EncryptedQueueEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate.version === ENCRYPTION_VERSION &&
    typeof candidate.keyId === "string" &&
    typeof candidate.nonceHex === "string" &&
    typeof candidate.cipherHex === "string" &&
    typeof candidate.pointCount === "number"
  );
}

function isValidTrackPoint(value: unknown): value is LocationTrackPoint {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<LocationTrackPoint>;

  return (
    typeof candidate.latitude === "number" &&
    Number.isFinite(candidate.latitude) &&
    typeof candidate.longitude === "number" &&
    Number.isFinite(candidate.longitude) &&
    typeof candidate.timestampMs === "number" &&
    Number.isFinite(candidate.timestampMs)
  );
}

async function getActiveSessionScope(): Promise<string> {
  if (activeSessionScopeCache) {
    return activeSessionScopeCache;
  }

  try {
    const storedScope = await AsyncStorage.getItem(LOCATION_QUEUE_SCOPE_KEY);
    const normalized = normalizeSessionScope(storedScope);
    activeSessionScopeCache = normalized;

    if (!storedScope) {
      await AsyncStorage.setItem(LOCATION_QUEUE_SCOPE_KEY, normalized);
    }

    return normalized;
  } catch {
    const fallback = DEFAULT_SESSION_SCOPE;
    activeSessionScopeCache = fallback;
    return fallback;
  }
}

async function scopeToKeyId(scope: string): Promise<string> {
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    scope,
  );
}

async function getKeyMaterialForScope(
  scope: string,
  createIfMissing: boolean,
): Promise<QueueKeyMaterial | null> {
  const keyId = await scopeToKeyId(scope);

  if (
    activeKeyMaterialCache &&
    activeSessionScopeCache === scope &&
    activeKeyMaterialCache.keyId === keyId
  ) {
    return activeKeyMaterialCache;
  }

  const secureKeyName = `${SECURE_KEY_PREFIX}${keyId}`;

  try {
    const storedHex = await SecureStore.getItemAsync(secureKeyName, {
      keychainService: SECURE_STORE_SERVICE,
    });

    if (storedHex) {
      const parsed = hexToBytes(storedHex);
      if (parsed && parsed.length === ENCRYPTION_KEY_BYTES) {
        const material = {
          keyId,
          keyBytes: parsed,
        };

        if (activeSessionScopeCache === scope) {
          activeKeyMaterialCache = material;
        }

        return material;
      }
    }

    if (!createIfMissing) {
      return null;
    }

    const nextKey = Crypto.getRandomBytes(ENCRYPTION_KEY_BYTES);
    await SecureStore.setItemAsync(secureKeyName, bytesToHex(nextKey), {
      keychainService: SECURE_STORE_SERVICE,
    });

    const created = {
      keyId,
      keyBytes: nextKey,
    };

    if (activeSessionScopeCache === scope) {
      activeKeyMaterialCache = created;
    }

    return created;
  } catch {
    return null;
  }
}

async function deleteKeyForScope(scope: string): Promise<void> {
  try {
    const keyId = await scopeToKeyId(scope);
    await SecureStore.deleteItemAsync(`${SECURE_KEY_PREFIX}${keyId}`, {
      keychainService: SECURE_STORE_SERVICE,
    });
  } catch {
    // Best-effort key cleanup only.
  }
}

function serializePoints(points: LocationTrackPoint[]): Uint8Array {
  const text = JSON.stringify(points);
  return new TextEncoder().encode(text);
}

function deserializePoints(raw: Uint8Array): LocationTrackPoint[] {
  try {
    const text = new TextDecoder().decode(raw);
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isValidTrackPoint);
  } catch {
    return [];
  }
}

function encryptPoints(
  points: LocationTrackPoint[],
  keyMaterial: QueueKeyMaterial,
): EncryptedQueueEnvelope {
  const nonce = Crypto.getRandomBytes(ENCRYPTION_NONCE_BYTES);
  const plaintext = serializePoints(points);
  const cipher = nacl.secretbox(plaintext, nonce, keyMaterial.keyBytes);

  return {
    version: ENCRYPTION_VERSION,
    keyId: keyMaterial.keyId,
    nonceHex: bytesToHex(nonce),
    cipherHex: bytesToHex(cipher),
    pointCount: points.length,
    updatedAt: Date.now(),
  };
}

function decryptPoints(
  envelope: EncryptedQueueEnvelope,
  keyMaterial: QueueKeyMaterial,
): LocationTrackPoint[] {
  if (envelope.keyId !== keyMaterial.keyId) {
    return [];
  }

  const nonce = hexToBytes(envelope.nonceHex);
  const cipher = hexToBytes(envelope.cipherHex);
  if (!nonce || !cipher || nonce.length !== ENCRYPTION_NONCE_BYTES) {
    return [];
  }

  const opened = nacl.secretbox.open(cipher, nonce, keyMaterial.keyBytes);
  if (!opened) {
    return [];
  }

  return deserializePoints(opened);
}

async function readQueueForScope(scope: string): Promise<LocationTrackPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCATION_QUEUE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;

    // Legacy plaintext payload migration path.
    if (Array.isArray(parsed)) {
      const legacy = parsed.filter(isValidTrackPoint);
      const keyMaterial = await getKeyMaterialForScope(scope, true);
      if (!keyMaterial) {
        return [];
      }

      const encrypted = encryptPoints(legacy, keyMaterial);
      await AsyncStorage.setItem(
        LOCATION_QUEUE_STORAGE_KEY,
        JSON.stringify(encrypted),
      );

      return legacy;
    }

    if (!isEncryptedQueueEnvelope(parsed)) {
      return [];
    }

    const keyMaterial = await getKeyMaterialForScope(scope, false);
    if (!keyMaterial) {
      return [];
    }

    return decryptPoints(parsed, keyMaterial);
  } catch {
    return [];
  }
}

async function writeQueueForScope(
  scope: string,
  points: LocationTrackPoint[],
): Promise<void> {
  if (points.length === 0) {
    await AsyncStorage.removeItem(LOCATION_QUEUE_STORAGE_KEY);
    return;
  }

  const keyMaterial = await getKeyMaterialForScope(scope, true);
  if (!keyMaterial) {
    return;
  }

  const encrypted = encryptPoints(points, keyMaterial);
  await AsyncStorage.setItem(
    LOCATION_QUEUE_STORAGE_KEY,
    JSON.stringify(encrypted),
  );
}

export async function setLocationQueueSessionScope(
  sessionScope: string | null,
): Promise<void> {
  const nextScope = normalizeSessionScope(sessionScope);
  const previousScope = await getActiveSessionScope();

  if (previousScope === nextScope) {
    return;
  }

  const existingPoints = await readQueueForScope(previousScope);

  activeSessionScopeCache = nextScope;
  activeKeyMaterialCache = null;

  try {
    await AsyncStorage.setItem(LOCATION_QUEUE_SCOPE_KEY, nextScope);
  } catch {
    // Keep running with in-memory scope even if persistence fails.
  }

  await writeQueueForScope(nextScope, existingPoints);
  await deleteKeyForScope(previousScope);
}

export async function loadLocationQueueForSync(): Promise<
  LocationTrackPoint[]
> {
  const scope = await getActiveSessionScope();
  return await readQueueForScope(scope);
}

export async function saveLocationQueue(
  points: LocationTrackPoint[],
): Promise<void> {
  const scope = await getActiveSessionScope();
  await writeQueueForScope(scope, points);
}

export async function getLocationQueueSize(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(LOCATION_QUEUE_STORAGE_KEY);
    if (!raw) return 0;

    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      return parsed.filter(isValidTrackPoint).length;
    }

    if (isEncryptedQueueEnvelope(parsed)) {
      return Math.max(0, Math.floor(parsed.pointCount));
    }

    return 0;
  } catch {
    return 0;
  }
}
