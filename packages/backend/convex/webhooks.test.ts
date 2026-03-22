import { beforeAll, describe, expect, it } from "vitest";

let parseClerkWebhookUser: typeof import("./webhooks").parseClerkWebhookUser;

beforeAll(async () => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.accounts.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_secret";
  process.env.OPENAI_API_KEY ??= "sk-test-key";

  const mod = await import("./webhooks");
  parseClerkWebhookUser = mod.parseClerkWebhookUser;
});

describe("parseClerkWebhookUser", () => {
  it("returns primary email when present", () => {
    const parsed = parseClerkWebhookUser({
      id: "user_123",
      primary_email_address_id: "em_2",
      email_addresses: [
        { id: "em_1", email_address: "first@example.com" },
        { id: "em_2", email_address: "primary@example.com" },
      ],
      first_name: "Ada",
      last_name: "Lovelace",
      image_url: "https://example.com/avatar.png",
    });

    expect(parsed).toEqual({
      clerkUserId: "user_123",
      email: "primary@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      imageUrl: "https://example.com/avatar.png",
    });
  });

  it("falls back to first email when primary id is missing", () => {
    const parsed = parseClerkWebhookUser({
      id: "user_123",
      email_addresses: [{ id: "em_1", email_address: "first@example.com" }],
    });

    expect(parsed.email).toBe("first@example.com");
  });

  it("returns empty object when no user payload exists", () => {
    expect(parseClerkWebhookUser(undefined)).toEqual({});
    expect(parseClerkWebhookUser(null)).toEqual({});
  });
});
