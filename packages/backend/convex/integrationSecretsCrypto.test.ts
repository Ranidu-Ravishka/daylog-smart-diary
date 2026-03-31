import { afterEach, describe, expect, it } from "vitest";

import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  getActiveIntegrationSecretKeyId,
  IntegrationSecretCryptoError,
} from "./integrationSecretsCrypto";

const ORIGINAL_KEYRING_ENV = process.env.INTEGRATION_SECRETS_KEYRING_JSON;
const ORIGINAL_ACTIVE_KEY_ENV = process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID;

function setKeyring(activeKeyId: string, entries: Record<string, string>) {
  process.env.INTEGRATION_SECRETS_KEYRING_JSON = JSON.stringify(entries);
  process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID = activeKeyId;
}

afterEach(() => {
  if (ORIGINAL_KEYRING_ENV === undefined) {
    delete process.env.INTEGRATION_SECRETS_KEYRING_JSON;
  } else {
    process.env.INTEGRATION_SECRETS_KEYRING_JSON = ORIGINAL_KEYRING_ENV;
  }

  if (ORIGINAL_ACTIVE_KEY_ENV === undefined) {
    delete process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID;
  } else {
    process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID = ORIGINAL_ACTIVE_KEY_ENV;
  }
});

describe("integration secret envelope encryption", () => {
  it("encrypts and decrypts secret values without plaintext persistence", async () => {
    const keyV1 = Buffer.alloc(32, 1).toString("base64url");
    setKeyring("key-v1", { "key-v1": keyV1 });

    const envelope = await encryptIntegrationSecret("access-token-123", {
      userId: "user_1",
      provider: "spotify",
      tokenRef: "tokref_abc",
    });

    expect(envelope.keyId).toBe("key-v1");
    expect(envelope.encryptedValue).not.toContain("access-token-123");

    const decrypted = await decryptIntegrationSecret(envelope, {
      userId: "user_1",
      provider: "spotify",
      tokenRef: "tokref_abc",
    });

    expect(decrypted).toBe("access-token-123");
    expect(getActiveIntegrationSecretKeyId()).toBe("key-v1");
  });

  it("keeps old records decryptable after key rotation", async () => {
    const keyV1 = Buffer.alloc(32, 1).toString("base64url");
    const keyV2 = Buffer.alloc(32, 2).toString("base64url");

    setKeyring("key-v1", { "key-v1": keyV1, "key-v2": keyV2 });
    const envelope = await encryptIntegrationSecret("refresh-token-xyz", {
      userId: "user_7",
      provider: "google_fit",
      tokenRef: "tokref_rotation",
    });

    setKeyring("key-v2", { "key-v1": keyV1, "key-v2": keyV2 });
    const decrypted = await decryptIntegrationSecret(envelope, {
      userId: "user_7",
      provider: "google_fit",
      tokenRef: "tokref_rotation",
    });

    expect(envelope.keyId).toBe("key-v1");
    expect(getActiveIntegrationSecretKeyId()).toBe("key-v2");
    expect(decrypted).toBe("refresh-token-xyz");
  });

  it("fails securely when envelope key_id is unavailable", async () => {
    const keyV1 = Buffer.alloc(32, 3).toString("base64url");
    const keyV2 = Buffer.alloc(32, 4).toString("base64url");

    setKeyring("key-v1", { "key-v1": keyV1 });
    const envelope = await encryptIntegrationSecret("token-to-fail", {
      userId: "user_9",
      provider: "google_calendar",
      tokenRef: "tokref_missing_key",
    });

    setKeyring("key-v2", { "key-v2": keyV2 });

    await expect(
      decryptIntegrationSecret(envelope, {
        userId: "user_9",
        provider: "google_calendar",
        tokenRef: "tokref_missing_key",
      }),
    ).rejects.toMatchObject({
      code: "MISSING_KEY_ID",
    } satisfies Partial<IntegrationSecretCryptoError>);
  });
});
