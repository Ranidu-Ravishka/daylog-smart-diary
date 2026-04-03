import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.daylog.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_valid_key_1234567890";
  process.env.OPENAI_API_KEY ??= "sk-test-valid-key-1234567890";
});

describe("auth config module", () => {
  it("exports Clerk provider configuration", async () => {
    const authConfig = await import("./auth.config");
    expect(authConfig.default.providers).toHaveLength(1);
    expect(authConfig.default.providers[0]?.applicationID).toBe("convex");
  });
});
