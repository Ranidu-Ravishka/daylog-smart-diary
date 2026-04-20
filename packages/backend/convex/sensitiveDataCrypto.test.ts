import { afterEach, describe, expect, it } from "vitest";

import {
  decrypt,
  encrypt,
  getActiveSensitiveDataKeyId,
  SensitiveDataCryptoError,
} from "./sensitiveDataCrypto";

const ORIGINAL_KEYRING_ENV = process.env.SENSITIVE_DATA_KEYRING_JSON;
const ORIGINAL_ACTIVE_KEY_ENV = process.env.SENSITIVE_DATA_ACTIVE_KEY_ID;

function setKeyring(activeKeyId: string, entries: Record<string, string>) {
  process.env.SENSITIVE_DATA_KEYRING_JSON = JSON.stringify(entries);
  process.env.SENSITIVE_DATA_ACTIVE_KEY_ID = activeKeyId;
}

afterEach(() => {
  if (ORIGINAL_KEYRING_ENV === undefined) {
    delete process.env.SENSITIVE_DATA_KEYRING_JSON;
  } else {
    process.env.SENSITIVE_DATA_KEYRING_JSON = ORIGINAL_KEYRING_ENV;
  }

  if (ORIGINAL_ACTIVE_KEY_ENV === undefined) {
    delete process.env.SENSITIVE_DATA_ACTIVE_KEY_ID;
  } else {
    process.env.SENSITIVE_DATA_ACTIVE_KEY_ID = ORIGINAL_ACTIVE_KEY_ENV;
  }
});

describe("sensitive data envelope encryption", () => {
  it("encrypts and decrypts payloads without storing plaintext", async () => {
    const keyV1 = Buffer.alloc(32, 1).toString("base64url");
    setKeyring("sd-key-v1", { "sd-key-v1": keyV1 });

    const envelope = await encrypt(
      {
        story: "Spent focused time building migration tooling",
        highlights: ["wrote tests", "validated key rotation"],
      },
      {
        table: "daySummaries",
        userId: "user_1",
        nonce: "sd_nonce_1",
        field: "story",
      },
    );

    expect(envelope.keyId).toBe("sd-key-v1");
    expect(envelope.algorithm).toBe("AES-256-GCM");
    expect(envelope.ciphertext).not.toContain("migration");

    const decrypted = await decrypt<{ story: string; highlights: string[] }>(
      envelope,
      {
        table: "daySummaries",
        userId: "user_1",
        nonce: "sd_nonce_1",
        field: "story",
      },
    );

    expect(decrypted).toEqual({
      story: "Spent focused time building migration tooling",
      highlights: ["wrote tests", "validated key rotation"],
    });
    expect(getActiveSensitiveDataKeyId()).toBe("sd-key-v1");
  });

  it("keeps historical rows decryptable after key rotation", async () => {
    const keyV1 = Buffer.alloc(32, 2).toString("base64url");
    const keyV2 = Buffer.alloc(32, 3).toString("base64url");

    setKeyring("sd-key-v1", {
      "sd-key-v1": keyV1,
      "sd-key-v2": keyV2,
    });

    const envelope = await encrypt(["tag-1", "tag-2"], {
      table: "days",
      userId: "user_2",
      nonce: "sd_nonce_2",
      field: "peopleTags",
    });

    setKeyring("sd-key-v2", {
      "sd-key-v1": keyV1,
      "sd-key-v2": keyV2,
    });

    const decrypted = await decrypt<string[]>(envelope, {
      table: "days",
      userId: "user_2",
      nonce: "sd_nonce_2",
      field: "peopleTags",
    });

    expect(envelope.keyId).toBe("sd-key-v1");
    expect(getActiveSensitiveDataKeyId()).toBe("sd-key-v2");
    expect(decrypted).toEqual(["tag-1", "tag-2"]);
  });

  it("fails securely when decrypting with a missing key id", async () => {
    const keyV1 = Buffer.alloc(32, 4).toString("base64url");
    const keyV2 = Buffer.alloc(32, 5).toString("base64url");

    setKeyring("sd-key-v1", {
      "sd-key-v1": keyV1,
    });

    const envelope = await encrypt("secret-memory-title", {
      table: "memories",
      userId: "user_3",
      nonce: "sd_nonce_3",
      field: "title",
    });

    setKeyring("sd-key-v2", {
      "sd-key-v2": keyV2,
    });

    await expect(
      decrypt(envelope, {
        table: "memories",
        userId: "user_3",
        nonce: "sd_nonce_3",
        field: "title",
      }),
    ).rejects.toMatchObject({
      code: "MISSING_KEY_ID",
    } satisfies Partial<SensitiveDataCryptoError>);
  });
});
