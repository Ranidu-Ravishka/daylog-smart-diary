import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import {
  getIntegrationAccessTokenByRefInternal,
  storeIntegrationSecretInternal,
} from "./integrations";
import { encryptIntegrationSecret } from "./integrationSecretsCrypto";
import { createInMemoryDb } from "../test-utils/inMemoryConvex";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const ORIGINAL_KEYRING_ENV = process.env.INTEGRATION_SECRETS_KEYRING_JSON;
const ORIGINAL_ACTIVE_KEY_ENV = process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID;

const USER_ID = "user_secret_hardening_001" as Id<"user">;
const TOKEN_REF = "tokref_secret_hardening_001";

function seededDb() {
  return createInMemoryDb({
    user: [
      {
        _id: USER_ID,
        _creationTime: 1,
        clerkUserId: "clerk_secret_hardening_001",
        isAdmin: false,
      },
    ],
  });
}

async function seedLegacySecretRow(
  db: ReturnType<typeof createInMemoryDb>,
): Promise<void> {
  const cryptoContext = {
    userId: String(USER_ID),
    provider: "spotify" as const,
    tokenRef: TOKEN_REF,
  };

  const encryptedAccessToken = await encryptIntegrationSecret(
    "encrypted_access_token",
    cryptoContext,
    1_700_000_000_000,
  );

  await db.insert("integrationSecrets", {
    userId: USER_ID,
    provider: "spotify",
    tokenRef: TOKEN_REF,
    encryptedAccessToken,
    accessToken: "legacy_plaintext_access_token",
    createdAt: 1,
    updatedAt: 1,
  } as never);
}

beforeAll(() => {
  const key = Buffer.alloc(32, 3).toString("base64url");
  process.env.INTEGRATION_SECRETS_KEYRING_JSON = JSON.stringify({
    "test-key-v1": key,
  });
  process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID = "test-key-v1";
});

afterAll(() => {
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

describe("integration secret hardening", () => {
  it("fails fast when reading a secret record containing legacy plaintext fields", async () => {
    const db = seededDb();
    await seedLegacySecretRow(db);

    const query = handler<
      {
        tokenRef: string;
        userId: Id<"user">;
        provider: string;
      },
      unknown
    >(getIntegrationAccessTokenByRefInternal);

    await expect(
      query(
        {
          db,
        },
        {
          tokenRef: TOKEN_REF,
          userId: USER_ID,
          provider: "spotify",
        },
      ),
    ).rejects.toThrow("Legacy plaintext integration secret fields detected");
  });

  it("fails fast when updating an existing secret record containing legacy plaintext fields", async () => {
    const db = seededDb();
    await seedLegacySecretRow(db);

    const mutation = handler<
      {
        userId: Id<"user">;
        provider: string;
        accessToken: string;
        refreshToken?: string;
        accessTokenExpiresAt?: number;
        lastRefreshAt?: number;
        existingTokenRef?: string;
      },
      string
    >(storeIntegrationSecretInternal);

    await expect(
      mutation(
        {
          db,
        },
        {
          userId: USER_ID,
          provider: "spotify",
          accessToken: "new_access_token",
          existingTokenRef: TOKEN_REF,
        },
      ),
    ).rejects.toThrow("Legacy plaintext integration secret fields detected");
  });
});
