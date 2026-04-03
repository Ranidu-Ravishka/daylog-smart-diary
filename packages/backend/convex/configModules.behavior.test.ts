import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.daylog.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_valid_key_1234567890";
  process.env.OPENAI_API_KEY ??= "sk-test-valid-key-1234567890";
});

describe("config and wiring modules", () => {
  it("loads auth config, schema, http routes, and crons", async () => {
    const [authConfig, schema, http, crons] = await Promise.all([
      import("./auth.config"),
      import("./schema"),
      import("./http"),
      import("./crons"),
    ]);

    expect(authConfig.default.providers[0]?.applicationID).toBe("convex");
    expect(schema.default).toBeDefined();
    expect(http.default).toBeDefined();
    expect(crons.default).toBeDefined();
  });
});
