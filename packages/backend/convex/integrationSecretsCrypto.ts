const ENVELOPE_VERSION = 1;
const VALUE_ALGORITHM = "AES-256-GCM" as const;
const WRAPPED_DEK_ALGORITHM = "AES-256-GCM" as const;
const AES_GCM_NAME = "AES-GCM";
const AES_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;

const KEYRING_ENV_NAME = "INTEGRATION_SECRETS_KEYRING_JSON";
const ACTIVE_KEY_ID_ENV_NAME = "INTEGRATION_SECRETS_ACTIVE_KEY_ID";

type EnvelopePhase = "value" | "dek";

type ParsedKeyring = {
  activeKeyId: string;
  keyring: Map<string, Uint8Array>;
  keyringEnvRaw: string;
};

type CachedKeyring = ParsedKeyring | null;

let cachedKeyring: CachedKeyring = null;

export type IntegrationSecretContext = {
  userId: string;
  provider: string;
  tokenRef: string;
};

export type EncryptedSecretEnvelope = {
  version: number;
  algorithm: typeof VALUE_ALGORITHM;
  wrappedDekAlgorithm: typeof WRAPPED_DEK_ALGORITHM;
  keyId: string;
  keyVersion: number;
  encryptedValue: string;
  valueIv: string;
  encryptedDek: string;
  dekIv: string;
  createdAt: number;
};

export class IntegrationSecretCryptoError extends Error {
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
    this.name = "IntegrationSecretCryptoError";
    this.code = code;
  }
}

function normalizeBase64Url(value: string): string {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return normalizeBase64Url(Buffer.from(bytes).toString("base64"));
}

function decodeBase64Flexible(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new IntegrationSecretCryptoError(
      "CONFIG_ERROR",
      "Encryption key material is empty.",
    );
  }

  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const buffer = Buffer.from(padded, "base64");

  if (buffer.length === 0) {
    throw new IntegrationSecretCryptoError(
      "CONFIG_ERROR",
      "Encryption key material is invalid base64.",
    );
  }

  return new Uint8Array(buffer);
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
    throw new IntegrationSecretCryptoError(
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
    throw new IntegrationSecretCryptoError(
      "CONFIG_ERROR",
      `${KEYRING_ENV_NAME} must be a valid JSON object mapping key ids to base64 keys.`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new IntegrationSecretCryptoError(
      "CONFIG_ERROR",
      `${KEYRING_ENV_NAME} must be a JSON object mapping key ids to base64 keys.`,
    );
  }

  const keyringMap = new Map<string, Uint8Array>();
  for (const [keyId, keyMaterial] of Object.entries(parsed)) {
    if (!keyId.trim() || typeof keyMaterial !== "string") {
      throw new IntegrationSecretCryptoError(
        "CONFIG_ERROR",
        `${KEYRING_ENV_NAME} contains an invalid key entry.`,
      );
    }

    const decoded = decodeBase64Flexible(keyMaterial);
    if (decoded.byteLength !== AES_KEY_BYTES) {
      throw new IntegrationSecretCryptoError(
        "CONFIG_ERROR",
        `Key "${keyId}" must decode to exactly ${AES_KEY_BYTES} bytes.`,
      );
    }

    keyringMap.set(keyId, decoded);
  }

  if (!keyringMap.has(activeKeyId)) {
    throw new IntegrationSecretCryptoError(
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

function buildAad(
  context: IntegrationSecretContext,
  phase: EnvelopePhase,
  keyId?: string,
): Uint8Array {
  const keyPart = keyId ? `/${keyId}` : "";
  return toUtf8Bytes(
    `integration-secrets/v${ENVELOPE_VERSION}/${phase}/${context.userId}/${context.provider}/${context.tokenRef}${keyPart}`,
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

export function getActiveIntegrationSecretKeyId(): string {
  return getParsedKeyring().activeKeyId;
}

export function constantTimeStringEquals(left: string, right: string): boolean {
  return constantTimeStringEqualsInternal(left, right);
}

export async function encryptIntegrationSecret(
  plaintext: string,
  context: IntegrationSecretContext,
  now = Date.now(),
): Promise<EncryptedSecretEnvelope> {
  if (!plaintext || plaintext.length === 0) {
    throw new IntegrationSecretCryptoError(
      "ENCRYPTION_FAILED",
      "Secret plaintext is empty.",
    );
  }

  const parsedKeyring = getParsedKeyring();
  const keyId = parsedKeyring.activeKeyId;
  const kekBytes = parsedKeyring.keyring.get(keyId);

  if (!kekBytes) {
    throw new IntegrationSecretCryptoError(
      "MISSING_KEY_ID",
      "Active key is unavailable for encryption.",
    );
  }

  try {
    const dekBytes = randomBytes(AES_KEY_BYTES);
    const valueIv = randomBytes(AES_GCM_IV_BYTES);
    const dekIv = randomBytes(AES_GCM_IV_BYTES);

    const dek = await importAesGcmKey(dekBytes, ["encrypt", "decrypt"]);
    const kek = await importAesGcmKey(kekBytes, ["encrypt", "decrypt"]);

    const encryptedValue = await encryptAesGcm(
      dek,
      toUtf8Bytes(plaintext),
      valueIv,
      buildAad(context, "value"),
    );

    const encryptedDek = await encryptAesGcm(
      kek,
      dekBytes,
      dekIv,
      buildAad(context, "dek", keyId),
    );

    return {
      version: ENVELOPE_VERSION,
      algorithm: VALUE_ALGORITHM,
      wrappedDekAlgorithm: WRAPPED_DEK_ALGORITHM,
      keyId,
      keyVersion: ENVELOPE_VERSION,
      encryptedValue: encodeBase64Url(encryptedValue),
      valueIv: encodeBase64Url(valueIv),
      encryptedDek: encodeBase64Url(encryptedDek),
      dekIv: encodeBase64Url(dekIv),
      createdAt: now,
    };
  } catch {
    throw new IntegrationSecretCryptoError(
      "ENCRYPTION_FAILED",
      "Failed to encrypt integration secret.",
    );
  }
}

export async function decryptIntegrationSecret(
  envelope: EncryptedSecretEnvelope,
  context: IntegrationSecretContext,
): Promise<string> {
  if (
    !envelope ||
    envelope.version !== ENVELOPE_VERSION ||
    envelope.algorithm !== VALUE_ALGORITHM ||
    envelope.wrappedDekAlgorithm !== WRAPPED_DEK_ALGORITHM ||
    !envelope.keyId ||
    !envelope.encryptedValue ||
    !envelope.valueIv ||
    !envelope.encryptedDek ||
    !envelope.dekIv
  ) {
    throw new IntegrationSecretCryptoError(
      "INVALID_ENVELOPE",
      "Encrypted integration secret payload is invalid.",
    );
  }

  const parsedKeyring = getParsedKeyring();
  const kekBytes = parsedKeyring.keyring.get(envelope.keyId);
  if (!kekBytes) {
    throw new IntegrationSecretCryptoError(
      "MISSING_KEY_ID",
      "No decryption key found for integration secret key_id.",
    );
  }

  try {
    const kek = await importAesGcmKey(kekBytes, ["encrypt", "decrypt"]);
    const dekBytes = await decryptAesGcm(
      kek,
      decodeBase64Flexible(envelope.encryptedDek),
      decodeBase64Flexible(envelope.dekIv),
      buildAad(context, "dek", envelope.keyId),
    );

    if (dekBytes.byteLength !== AES_KEY_BYTES) {
      throw new IntegrationSecretCryptoError(
        "DECRYPTION_FAILED",
        "Decrypted data key has invalid length.",
      );
    }

    const dek = await importAesGcmKey(dekBytes, ["encrypt", "decrypt"]);
    const plaintextBytes = await decryptAesGcm(
      dek,
      decodeBase64Flexible(envelope.encryptedValue),
      decodeBase64Flexible(envelope.valueIv),
      buildAad(context, "value"),
    );

    return fromUtf8Bytes(plaintextBytes);
  } catch (error) {
    if (error instanceof IntegrationSecretCryptoError) {
      throw error;
    }

    throw new IntegrationSecretCryptoError(
      "DECRYPTION_FAILED",
      "Failed to decrypt integration secret.",
    );
  }
}
