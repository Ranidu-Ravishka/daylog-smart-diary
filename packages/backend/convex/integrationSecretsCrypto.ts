const ENVELOPE_VERSION = 1;
const VALUE_ALGORITHM = "AES-256-GCM" as const;
const WRAPPED_DEK_ALGORITHM = "AES-256-GCM" as const;
const AES_GCM_NAME = "AES-GCM";
const AES_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;

// Legacy keyring env (deprecated)
const KEYRING_ENV_NAME = "INTEGRATION_SECRETS_KEYRING_JSON";
const ACTIVE_KEY_ID_ENV_NAME = "INTEGRATION_SECRETS_ACTIVE_KEY_ID";

// New KMS-based envs
const KMS_KEY_ID_ENV = "INTEGRATION_SECRETS_KMS_KEY_ID";
const KMS_KEY_ID_ENV_FALLBACK = "KMS_KEY_ID";

// Local-dev fallback key file path. Create via scripts/init-local-integration-kms.mjs
const LOCAL_KEK_PATH_ENV = "INTEGRATION_SECRETS_LOCAL_KEK_PATH";

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

  throw new IntegrationSecretCryptoError(
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

  throw new IntegrationSecretCryptoError(
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
    throw new IntegrationSecretCryptoError(
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
      throw new IntegrationSecretCryptoError(
        "CONFIG_ERROR",
        "Encryption key material is invalid base64.",
      );
    }

    return decoded;
  } catch (error) {
    if (error instanceof IntegrationSecretCryptoError) {
      throw error;
    }

    throw new IntegrationSecretCryptoError(
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

function getRecordProperty(
  value: unknown,
  key: string,
): Uint8Array | ArrayBuffer | null {
  if (!value || typeof value !== "object" || !(key in value)) {
    return null;
  }
  const property = (value as Record<string, unknown>)[key];
  if (!property) return null;
  if (property instanceof Uint8Array || property instanceof ArrayBuffer) {
    return property;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(property)) {
    return new Uint8Array(property);
  }
  return null;
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
  // Prefer legacy keyring if present (keeps tests and older deployments working).
  const legacyActive = process.env[ACTIVE_KEY_ID_ENV_NAME]?.trim();
  if (legacyActive) {
    try {
      return getParsedKeyring().activeKeyId;
    } catch {
      // fallthrough to KMS options
    }
  }

  const kmsId =
    process.env[KMS_KEY_ID_ENV]?.trim() ||
    process.env[KMS_KEY_ID_ENV_FALLBACK]?.trim();
  if (kmsId) return kmsId;

  throw new IntegrationSecretCryptoError(
    "CONFIG_ERROR",
    `Missing active key configuration. Set ${ACTIVE_KEY_ID_ENV_NAME} or ${KMS_KEY_ID_ENV}.`,
  );
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
  // If a KMS key id is configured, prefer KMS-based envelope encryption.
  const kmsConfiguredKeyId =
    process.env[KMS_KEY_ID_ENV]?.trim() ||
    process.env[KMS_KEY_ID_ENV_FALLBACK]?.trim();
  if (kmsConfiguredKeyId) {
    return encryptIntegrationSecretWithKeyId(
      plaintext,
      context,
      kmsConfiguredKeyId,
      now,
    );
  }

  // Local-dev secure fallback: use a KEK stored in a local file (no plaintext key material in env)
  const localKekPath = process.env[LOCAL_KEK_PATH_ENV]?.trim();
  if (localKekPath) {
    try {
      const fs = await import("node:fs");
      if (fs.existsSync(localKekPath)) {
        const raw = fs.readFileSync(localKekPath, { encoding: "utf8" }).trim();
        const kekBytes = decodeBase64Flexible(raw);
        if (kekBytes.byteLength !== AES_KEY_BYTES) {
          throw new IntegrationSecretCryptoError(
            "CONFIG_ERROR",
            "Local KEK file has invalid length.",
          );
        }

        const keyId = `local:${localKekPath}`;

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
      }
    } catch {
      // fallthrough to legacy keyring
    }
  }

  // Fallback to legacy keyring behavior for backwards compatibility.
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

  // Try KMS-based DEK unwrap first (if available), then fall back to legacy keyring
  let dekBytes: Uint8Array | null = null;

  // Attempt KMS decrypt path
  try {
    dekBytes = await tryKmsDecrypt(
      decodeBase64Flexible(envelope.encryptedDek),
      envelope.keyId,
      buildAad(context, "dek", envelope.keyId),
    );
  } catch {
    // continue to legacy fallback
  }

  // Legacy keyring fallback
  if (!dekBytes) {
    // Try local KEK file fallback
    const localKekPath = process.env[LOCAL_KEK_PATH_ENV]?.trim();
    if (localKekPath) {
      try {
        const fs = await import("node:fs");
        if (fs.existsSync(localKekPath)) {
          const raw = fs
            .readFileSync(localKekPath, { encoding: "utf8" })
            .trim();
          const kekBytes = decodeBase64Flexible(raw);
          if (kekBytes.byteLength !== AES_KEY_BYTES) {
            throw new IntegrationSecretCryptoError(
              "CONFIG_ERROR",
              "Local KEK file has invalid length.",
            );
          }

          const kek = await importAesGcmKey(kekBytes, ["encrypt", "decrypt"]);
          dekBytes = await decryptAesGcm(
            kek,
            decodeBase64Flexible(envelope.encryptedDek),
            decodeBase64Flexible(envelope.dekIv),
            buildAad(context, "dek", envelope.keyId),
          );
        }
      } catch {
        // ignore local fallback failure and continue
      }
    }

    if (!dekBytes) {
      try {
        const parsedKeyring = getParsedKeyring();
        const kekBytes = parsedKeyring.keyring.get(envelope.keyId);
        if (!kekBytes) {
          throw new IntegrationSecretCryptoError(
            "MISSING_KEY_ID",
            "No decryption key found for integration secret key_id.",
          );
        }

        const kek = await importAesGcmKey(kekBytes, ["encrypt", "decrypt"]);
        dekBytes = await decryptAesGcm(
          kek,
          decodeBase64Flexible(envelope.encryptedDek),
          decodeBase64Flexible(envelope.dekIv),
          buildAad(context, "dek", envelope.keyId),
        );
      } catch (error) {
        if (error instanceof IntegrationSecretCryptoError) throw error;
        throw new IntegrationSecretCryptoError(
          "DECRYPTION_FAILED",
          "Failed to unwrap data encryption key.",
        );
      }
    }
  }

  if (!dekBytes || dekBytes.byteLength !== AES_KEY_BYTES) {
    throw new IntegrationSecretCryptoError(
      "DECRYPTION_FAILED",
      "Decrypted data key has invalid length.",
    );
  }

  try {
    const dek = await importAesGcmKey(dekBytes, ["encrypt", "decrypt"]);
    const plaintextBytes = await decryptAesGcm(
      dek,
      decodeBase64Flexible(envelope.encryptedValue),
      decodeBase64Flexible(envelope.valueIv),
      buildAad(context, "value"),
    );

    // Audit decrypt event (best-effort)
    void recordAuditEvent("decrypt", {
      keyId: envelope.keyId,
      provider: context.provider,
      userId: context.userId,
      tokenRef: context.tokenRef,
    });

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

// ------------------------
// KMS + DEK helper routines
// ------------------------

let auditLogger: ((event: Record<string, unknown>) => Promise<void>) | null =
  null;

export function setAuditLogger(
  fn: (event: Record<string, unknown>) => Promise<void>,
) {
  auditLogger = fn;
}

async function appendAuditFile(entry: Record<string, unknown>) {
  const path = process.env["INTEGRATION_SECRETS_AUDIT_LOG_PATH"]?.trim();
  if (!path) return;

  try {
    const fs = await import("node:fs");
    const dir = path.replace(/\/[^/]+$/, "");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path, JSON.stringify(entry) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // best-effort audit logging
  }
}

async function recordAuditEvent(
  action: string,
  details: Record<string, unknown>,
) {
  const event = {
    ts: Date.now(),
    action,
    ...details,
  } as Record<string, unknown>;

  try {
    if (auditLogger) await auditLogger(event);
  } catch {
    // best-effort audit logging
  }

  try {
    await appendAuditFile(event);
  } catch {
    // best-effort audit logging
  }
}

async function tryKmsDecrypt(
  ciphertext: Uint8Array,
  keyId: string,
  aad: Uint8Array,
): Promise<Uint8Array | null> {
  // Try AWS KMS dynamic import. This is best-effort: if the SDK isn't present
  // or the operation fails, we return null and allow legacy fallback.
  try {
    const { KMSClient, DecryptCommand } = await import("@aws-sdk/client-kms");
    const client = new KMSClient({});
    const encryptionContext = { aad: fromUtf8Bytes(aad) } as Record<
      string,
      string
    >;
    const command = new DecryptCommand({
      CiphertextBlob: ciphertext,
      EncryptionContext: encryptionContext,
    });
    const result = await client.send(command as any);
    const plain = getRecordProperty(result, "Plaintext");
    if (!plain) return null;
    if (plain instanceof ArrayBuffer) return new Uint8Array(plain);
    if (plain instanceof Uint8Array) return plain;
    return null;
  } catch {
    return null;
  }
}

async function kmsEncryptDek(
  dekBytes: Uint8Array,
  keyId: string,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const { KMSClient, EncryptCommand } = await import("@aws-sdk/client-kms");
  const client = new KMSClient({});
  const encryptionContext = { aad: fromUtf8Bytes(aad) } as Record<
    string,
    string
  >;
  const cmd = new EncryptCommand({
    KeyId: keyId,
    Plaintext: dekBytes,
    EncryptionContext: encryptionContext,
  });
  const res = await client.send(cmd as any);
  const blob = getRecordProperty(res, "CiphertextBlob");
  if (!blob)
    throw new IntegrationSecretCryptoError(
      "ENCRYPTION_FAILED",
      "KMS encrypt returned no ciphertext.",
    );
  if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
  if (blob instanceof Uint8Array) return blob;
  throw new IntegrationSecretCryptoError(
    "ENCRYPTION_FAILED",
    "Unexpected KMS ciphertext type.",
  );
}

export async function decryptDEK(
  encryptedDekBase64: string,
  envelopeKeyId: string,
  context: IntegrationSecretContext,
  dekIvBase64?: string,
): Promise<Uint8Array> {
  const encryptedDek = decodeBase64Flexible(encryptedDekBase64);
  const aad = buildAad(context, "dek", envelopeKeyId);

  // First try KMS
  const kmsDecoded = await tryKmsDecrypt(encryptedDek, envelopeKeyId, aad);
  if (kmsDecoded && kmsDecoded.byteLength === AES_KEY_BYTES) return kmsDecoded;

  // Fallback to legacy KEK unwrap (requires dekIv)
  if (!dekIvBase64) {
    throw new IntegrationSecretCryptoError(
      "MISSING_KEY_ID",
      "Legacy DEK unwrap requires dekIv.",
    );
  }

  const parsedKeyring = getParsedKeyring();
  const kekBytes = parsedKeyring.keyring.get(envelopeKeyId);
  if (!kekBytes)
    throw new IntegrationSecretCryptoError(
      "MISSING_KEY_ID",
      "No decryption key found for integration secret key_id.",
    );

  const kek = await importAesGcmKey(kekBytes, ["encrypt", "decrypt"]);
  const dek = await decryptAesGcm(
    kek,
    encryptedDek,
    decodeBase64Flexible(dekIvBase64),
    aad,
  );
  if (dek.byteLength !== AES_KEY_BYTES)
    throw new IntegrationSecretCryptoError(
      "DECRYPTION_FAILED",
      "Decrypted DEK has invalid length.",
    );
  return dek;
}

export async function encryptSecret(
  plaintext: string,
  dekBytes: Uint8Array,
  context: IntegrationSecretContext,
) {
  const valueIv = randomBytes(AES_GCM_IV_BYTES);
  const dekKey = await importAesGcmKey(dekBytes, ["encrypt"]);
  const encryptedValue = await encryptAesGcm(
    dekKey,
    toUtf8Bytes(plaintext),
    valueIv,
    buildAad(context, "value"),
  );
  return {
    encryptedValue: encodeBase64Url(encryptedValue),
    valueIv: encodeBase64Url(valueIv),
  };
}

export async function decryptSecret(
  encryptedValueB64: string,
  valueIvB64: string,
  dekBytes: Uint8Array,
  context: IntegrationSecretContext,
) {
  const dekKey = await importAesGcmKey(dekBytes, ["decrypt"]);
  const plaintextBytes = await decryptAesGcm(
    dekKey,
    decodeBase64Flexible(encryptedValueB64),
    decodeBase64Flexible(valueIvB64),
    buildAad(context, "value"),
  );
  return fromUtf8Bytes(plaintextBytes);
}

export async function encryptIntegrationSecretWithKeyId(
  plaintext: string,
  context: IntegrationSecretContext,
  keyId: string,
  now = Date.now(),
): Promise<EncryptedSecretEnvelope> {
  if (!plaintext || plaintext.length === 0) {
    throw new IntegrationSecretCryptoError(
      "ENCRYPTION_FAILED",
      "Secret plaintext is empty.",
    );
  }

  try {
    const dekBytes = randomBytes(AES_KEY_BYTES);
    const valueIv = randomBytes(AES_GCM_IV_BYTES);
    const dekIv = randomBytes(AES_GCM_IV_BYTES);

    const dek = await importAesGcmKey(dekBytes, ["encrypt", "decrypt"]);

    const encryptedValue = await encryptAesGcm(
      dek,
      toUtf8Bytes(plaintext),
      valueIv,
      buildAad(context, "value"),
    );

    // Wrap DEK with KMS
    const wrappedDek = await kmsEncryptDek(
      dekBytes,
      keyId,
      buildAad(context, "dek", keyId),
    );

    // Audit encrypt event (best-effort)
    void recordAuditEvent("encrypt", {
      keyId,
      provider: context.provider,
      userId: context.userId,
      tokenRef: context.tokenRef,
    });

    return {
      version: ENVELOPE_VERSION,
      algorithm: VALUE_ALGORITHM,
      wrappedDekAlgorithm: WRAPPED_DEK_ALGORITHM,
      keyId,
      keyVersion: ENVELOPE_VERSION,
      encryptedValue: encodeBase64Url(encryptedValue),
      valueIv: encodeBase64Url(valueIv),
      encryptedDek: encodeBase64Url(wrappedDek),
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

export async function rotateKey(
  db: any,
  newKeyId: string,
  opts?: { pageSize?: number; dryRun?: boolean },
): Promise<{ processed: number; rotated: number; errors: number }> {
  const pageSize = opts?.pageSize ?? 200;
  let cursor: string | null = null;
  let processed = 0;
  let rotated = 0;
  let errors = 0;

  while (true) {
    const page: any = await db
      .query("integrationSecrets")
      .paginate({ numItems: pageSize, cursor });
    for (const secret of page.page as any[]) {
      processed += 1;
      const cryptoContext: IntegrationSecretContext = {
        userId: String(secret.userId),
        provider: secret.provider,
        tokenRef: secret.tokenRef,
      };

      const patch: Record<string, unknown> = {};

      try {
        if (secret.encryptedAccessToken) {
          const plaintext = await decryptIntegrationSecret(
            secret.encryptedAccessToken,
            cryptoContext,
          );
          if (!opts?.dryRun) {
            patch.encryptedAccessToken =
              await encryptIntegrationSecretWithKeyId(
                plaintext,
                cryptoContext,
                newKeyId,
                Date.now(),
              );
          }
        }

        if (secret.encryptedRefreshToken) {
          const plaintext = await decryptIntegrationSecret(
            secret.encryptedRefreshToken,
            cryptoContext,
          );
          if (!opts?.dryRun) {
            patch.encryptedRefreshToken =
              await encryptIntegrationSecretWithKeyId(
                plaintext,
                cryptoContext,
                newKeyId,
                Date.now(),
              );
          }
        }

        if (!opts?.dryRun) {
          patch.updatedAt = Date.now();
          await db.patch(secret._id, patch);
        }

        rotated += 1;
        void recordAuditEvent("rotate", {
          id: String(secret._id),
          provider: secret.provider,
          userId: String(secret.userId),
        });
      } catch (e) {
        errors += 1;
        // best-effort audit of failure
        void recordAuditEvent("rotate_error", {
          id: String(secret._id),
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (page.isDone) break;
    cursor = page.continueCursor ?? null;
    if (!cursor) break;
  }

  return { processed, rotated, errors };
}
