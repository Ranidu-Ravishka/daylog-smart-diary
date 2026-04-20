const ENVELOPE_VERSION = 1;
const VALUE_ALGORITHM = "AES-256-GCM" as const;
const AES_GCM_NAME = "AES-GCM";
const AES_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;

const KEYRING_ENV_NAME = "SENSITIVE_DATA_KEYRING_JSON";
const ACTIVE_KEY_ID_ENV_NAME = "SENSITIVE_DATA_ACTIVE_KEY_ID";

type ParsedKeyring = {
  activeKeyId: string;
  keyring: Map<string, Uint8Array>;
  keyringEnvRaw: string;
};

type CachedKeyring = ParsedKeyring | null;

let cachedKeyring: CachedKeyring = null;

export type SensitiveDataTable =
  | "memories"
  | "days"
  | "daySummaries"
  | "integrationDailyData";

export type SensitiveDataCryptoContext = {
  table: SensitiveDataTable;
  userId: string;
  nonce: string;
  field: string;
};

export type SensitiveDataEnvelope = {
  version: number;
  algorithm: typeof VALUE_ALGORITHM;
  keyId: string;
  keyVersion: number;
  ciphertext: string;
  iv: string;
  createdAt: number;
};

export class SensitiveDataCryptoError extends Error {
  code:
    | "CONFIG_ERROR"
    | "MISSING_KEY_ID"
    | "INVALID_ENVELOPE"
    | "ENCRYPTION_FAILED"
    | "DECRYPTION_FAILED";

  constructor(
    code:
      | "CONFIG_ERROR"
      | "MISSING_KEY_ID"
      | "INVALID_ENVELOPE"
      | "ENCRYPTION_FAILED"
      | "DECRYPTION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "SensitiveDataCryptoError";
    this.code = code;
  }
}

function normalizeBase64Url(value: string): string {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toBinaryString(bytes: Uint8Array): string {
  let output = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    output += String.fromCharCode(...chunk);
  }

  return output;
}

function fromBinaryString(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    return btoa(toBinaryString(bytes));
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  throw new SensitiveDataCryptoError(
    "CONFIG_ERROR",
    "No base64 encoder is available in the current runtime.",
  );
}

function decodeBase64(value: string): Uint8Array {
  if (typeof atob === "function") {
    return fromBinaryString(atob(value));
  }

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  throw new SensitiveDataCryptoError(
    "CONFIG_ERROR",
    "No base64 decoder is available in the current runtime.",
  );
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return normalizeBase64Url(encodeBase64(bytes));
}

function decodeBase64Flexible(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new SensitiveDataCryptoError(
      "CONFIG_ERROR",
      "Encryption key material is empty.",
    );
  }

  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);

  try {
    const decoded = decodeBase64(padded);

    if (decoded.byteLength === 0) {
      throw new SensitiveDataCryptoError(
        "CONFIG_ERROR",
        "Encryption key material is invalid base64.",
      );
    }

    return decoded;
  } catch (error) {
    if (error instanceof SensitiveDataCryptoError) {
      throw error;
    }

    throw new SensitiveDataCryptoError(
      "CONFIG_ERROR",
      "Encryption key material is invalid base64.",
    );
  }
}

function constantTimeStringEqualsInternal(
  left: string,
  right: string,
): boolean {
  const leftLength = left.length;
  const rightLength = right.length;
  const maxLength = Math.max(leftLength, rightLength);

  let mismatch = leftLength ^ rightLength;

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = index < leftLength ? left.charCodeAt(index) : 0;
    const rightCode = index < rightLength ? right.charCodeAt(index) : 0;
    mismatch |= leftCode ^ rightCode;
  }

  return mismatch === 0;
}

function getParsedKeyring(): ParsedKeyring {
  const keyringEnvRaw = process.env[KEYRING_ENV_NAME]?.trim() ?? "";
  const activeKeyId = process.env[ACTIVE_KEY_ID_ENV_NAME]?.trim() ?? "";

  if (!keyringEnvRaw || !activeKeyId) {
    throw new SensitiveDataCryptoError(
      "CONFIG_ERROR",
      `Missing encryption config. Set ${KEYRING_ENV_NAME} and ${ACTIVE_KEY_ID_ENV_NAME}.`,
    );
  }

  if (
    cachedKeyring &&
    cachedKeyring.keyringEnvRaw === keyringEnvRaw &&
    constantTimeStringEqualsInternal(cachedKeyring.activeKeyId, activeKeyId)
  ) {
    return cachedKeyring;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(keyringEnvRaw);
  } catch {
    throw new SensitiveDataCryptoError(
      "CONFIG_ERROR",
      `${KEYRING_ENV_NAME} must be a valid JSON object mapping key ids to base64 keys.`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SensitiveDataCryptoError(
      "CONFIG_ERROR",
      `${KEYRING_ENV_NAME} must be a JSON object mapping key ids to base64 keys.`,
    );
  }

  const keyringMap = new Map<string, Uint8Array>();
  for (const [keyId, keyMaterial] of Object.entries(parsed)) {
    if (!keyId.trim() || typeof keyMaterial !== "string") {
      throw new SensitiveDataCryptoError(
        "CONFIG_ERROR",
        `${KEYRING_ENV_NAME} contains an invalid key entry.`,
      );
    }

    const decoded = decodeBase64Flexible(keyMaterial);
    if (decoded.byteLength !== AES_KEY_BYTES) {
      throw new SensitiveDataCryptoError(
        "CONFIG_ERROR",
        `Key "${keyId}" must decode to exactly ${AES_KEY_BYTES} bytes.`,
      );
    }

    keyringMap.set(keyId, decoded);
  }

  if (!keyringMap.has(activeKeyId)) {
    throw new SensitiveDataCryptoError(
      "CONFIG_ERROR",
      `${ACTIVE_KEY_ID_ENV_NAME} does not exist in ${KEYRING_ENV_NAME}.`,
    );
  }

  const next: ParsedKeyring = {
    activeKeyId,
    keyring: keyringMap,
    keyringEnvRaw,
  };

  cachedKeyring = next;
  return next;
}

function randomBytes(length: number): Uint8Array {
  const output = new Uint8Array(length);
  crypto.getRandomValues(output);
  return output;
}

function toUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function fromUtf8Bytes(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function buildAad(context: SensitiveDataCryptoContext): Uint8Array {
  return toUtf8Bytes(
    `sensitive-data/v${ENVELOPE_VERSION}/${context.table}/${context.userId}/${context.nonce}/${context.field}`,
  );
}

async function importAesGcmKey(
  keyBytes: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: AES_GCM_NAME },
    false,
    usages,
  );
}

async function encryptAesGcm(
  key: CryptoKey,
  plaintext: Uint8Array,
  iv: Uint8Array,
  additionalData: Uint8Array,
): Promise<Uint8Array> {
  const encrypted = await crypto.subtle.encrypt(
    {
      name: AES_GCM_NAME,
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(additionalData),
    },
    key,
    toArrayBuffer(plaintext),
  );

  return new Uint8Array(encrypted);
}

async function decryptAesGcm(
  key: CryptoKey,
  ciphertext: Uint8Array,
  iv: Uint8Array,
  additionalData: Uint8Array,
): Promise<Uint8Array> {
  const decrypted = await crypto.subtle.decrypt(
    {
      name: AES_GCM_NAME,
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(additionalData),
    },
    key,
    toArrayBuffer(ciphertext),
  );

  return new Uint8Array(decrypted);
}

export function isSensitiveDataEnvelope(
  value: unknown,
): value is SensitiveDataEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.version === "number" &&
    candidate.algorithm === VALUE_ALGORITHM &&
    typeof candidate.keyId === "string" &&
    typeof candidate.keyVersion === "number" &&
    typeof candidate.ciphertext === "string" &&
    typeof candidate.iv === "string" &&
    typeof candidate.createdAt === "number"
  );
}

export function getActiveSensitiveDataKeyId(): string {
  return getParsedKeyring().activeKeyId;
}

export function createSensitiveDataNonce(): string {
  if (typeof crypto.randomUUID === "function") {
    return `sd_${crypto.randomUUID()}`;
  }

  return `sd_${encodeBase64Url(randomBytes(16))}`;
}

export async function encrypt(
  data: unknown,
  context: SensitiveDataCryptoContext,
  now = Date.now(),
): Promise<SensitiveDataEnvelope> {
  if (!context.userId || !context.nonce || !context.field) {
    throw new SensitiveDataCryptoError(
      "ENCRYPTION_FAILED",
      "Encryption context is incomplete for sensitive data payload.",
    );
  }

  const serialized = JSON.stringify(data);
  if (serialized === undefined) {
    throw new SensitiveDataCryptoError(
      "ENCRYPTION_FAILED",
      "Sensitive data payload is not serializable.",
    );
  }

  const parsedKeyring = getParsedKeyring();
  const keyId = parsedKeyring.activeKeyId;
  const keyBytes = parsedKeyring.keyring.get(keyId);

  if (!keyBytes) {
    throw new SensitiveDataCryptoError(
      "MISSING_KEY_ID",
      "Active key is unavailable for sensitive data encryption.",
    );
  }

  try {
    const iv = randomBytes(AES_GCM_IV_BYTES);
    const key = await importAesGcmKey(keyBytes, ["encrypt", "decrypt"]);

    const encryptedBytes = await encryptAesGcm(
      key,
      toUtf8Bytes(serialized),
      iv,
      buildAad(context),
    );

    return {
      version: ENVELOPE_VERSION,
      algorithm: VALUE_ALGORITHM,
      keyId,
      keyVersion: ENVELOPE_VERSION,
      ciphertext: encodeBase64Url(encryptedBytes),
      iv: encodeBase64Url(iv),
      createdAt: now,
    };
  } catch {
    throw new SensitiveDataCryptoError(
      "ENCRYPTION_FAILED",
      "Failed to encrypt sensitive data payload.",
    );
  }
}

export async function decrypt<T>(
  value: SensitiveDataEnvelope | T | undefined,
  context: SensitiveDataCryptoContext,
): Promise<T | undefined> {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isSensitiveDataEnvelope(value)) {
    return value;
  }

  if (!context.userId || !context.nonce || !context.field) {
    throw new SensitiveDataCryptoError(
      "DECRYPTION_FAILED",
      "Decryption context is incomplete for sensitive data payload.",
    );
  }

  const parsedKeyring = getParsedKeyring();
  const keyBytes = parsedKeyring.keyring.get(value.keyId);

  if (!keyBytes) {
    throw new SensitiveDataCryptoError(
      "MISSING_KEY_ID",
      "No decryption key found for sensitive data key_id.",
    );
  }

  try {
    const key = await importAesGcmKey(keyBytes, ["encrypt", "decrypt"]);
    const decryptedBytes = await decryptAesGcm(
      key,
      decodeBase64Flexible(value.ciphertext),
      decodeBase64Flexible(value.iv),
      buildAad(context),
    );

    const parsed = JSON.parse(fromUtf8Bytes(decryptedBytes)) as T;
    return parsed;
  } catch (error) {
    if (error instanceof SensitiveDataCryptoError) {
      throw error;
    }

    throw new SensitiveDataCryptoError(
      "DECRYPTION_FAILED",
      "Failed to decrypt sensitive data payload.",
    );
  }
}
