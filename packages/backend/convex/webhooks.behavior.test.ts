import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Webhook } from "svix";

let webhooksModule: typeof import("./webhooks");

beforeAll(async () => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.daylog.dev";
  process.env.CLERK_WEBHOOK_SECRET = `whsec_${Buffer.from("webhook_test_secret").toString("base64")}`;
  process.env.OPENAI_API_KEY ??= "sk-test-valid-key-1234567890";

  webhooksModule = await import("./webhooks");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webhooks behavior", () => {
  it("parses Clerk user payload selecting primary email", () => {
    const parsed = webhooksModule.parseClerkWebhookUser({
      id: "clerk_user_001",
      primary_email_address_id: "email_primary_001",
      email_addresses: [
        { id: "email_secondary_001", email_address: "secondary@example.com" },
        { id: "email_primary_001", email_address: "primary@example.com" },
      ],
      first_name: "Ada",
      last_name: "Lovelace",
      image_url: "https://img.example.com/avatar.png",
    });

    expect(parsed).toEqual({
      clerkUserId: "clerk_user_001",
      email: "primary@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      imageUrl: "https://img.example.com/avatar.png",
    });
  });

  it("rejects non-POST and invalid signatures", async () => {
    const runMutation = vi.fn(
      async (_ref: unknown, _args: Record<string, unknown>) => undefined,
    );
    const webhookHandler = (
      webhooksModule.clerkWebhook as unknown as {
        _handler: (ctx: unknown, request: Request) => Promise<Response>;
      }
    )._handler;

    const getResponse = await webhookHandler(
      { runMutation } as never,
      new Request("https://example.com/clerk/webhook", { method: "GET" }),
    );
    expect(getResponse.status).toBe(405);

    const invalidSigResponse = await webhookHandler(
      { runMutation } as never,
      new Request("https://example.com/clerk/webhook", {
        method: "POST",
        body: JSON.stringify({ type: "user.created", data: { id: "x" } }),
      }),
    );
    expect(invalidSigResponse.status).toBe(401);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("handles created and deleted events when signature verification passes", async () => {
    vi.spyOn(Webhook.prototype, "verify").mockImplementation(
      () => ({}) as never,
    );

    const runMutation = vi.fn(
      async (_ref: unknown, _args: Record<string, unknown>) => undefined,
    );
    const webhookHandler = (
      webhooksModule.clerkWebhook as unknown as {
        _handler: (ctx: unknown, request: Request) => Promise<Response>;
      }
    )._handler;

    const headers = {
      "content-type": "application/json",
      "svix-id": "msg_001",
      "svix-timestamp": "1710000000",
      "svix-signature": "v1,signature",
    };

    const createdResponse = await webhookHandler(
      { runMutation } as never,
      new Request("https://example.com/clerk/webhook", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "user.created",
          data: {
            id: "clerk_user_002",
            primary_email_address_id: "email_primary_002",
            email_addresses: [
              {
                id: "email_primary_002",
                email_address: "created@example.com",
              },
            ],
            first_name: "Created",
            last_name: "User",
          },
        }),
      }),
    );

    expect(createdResponse.status).toBe(204);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      clerkUserId: "clerk_user_002",
      email: "created@example.com",
    });

    const deletedResponse = await webhookHandler(
      { runMutation } as never,
      new Request("https://example.com/clerk/webhook", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "user.deleted",
          data: {
            id: "clerk_user_002",
          },
        }),
      }),
    );

    expect(deletedResponse.status).toBe(204);
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      clerkUserId: "clerk_user_002",
    });
  });

  it("returns 500 when downstream sync mutation fails", async () => {
    vi.spyOn(Webhook.prototype, "verify").mockImplementation(
      () => ({}) as never,
    );

    const runMutation = vi.fn(
      async (_ref: unknown, _args: Record<string, unknown>) => {
        throw new Error("sync failed");
      },
    );
    const webhookHandler = (
      webhooksModule.clerkWebhook as unknown as {
        _handler: (ctx: unknown, request: Request) => Promise<Response>;
      }
    )._handler;

    const response = await webhookHandler(
      { runMutation } as never,
      new Request("https://example.com/clerk/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "svix-id": "msg_001",
          "svix-timestamp": "1710000000",
          "svix-signature": "v1,signature",
        },
        body: JSON.stringify({
          type: "user.created",
          data: {
            id: "clerk_user_003",
            email_addresses: [{ email_address: "created@example.com" }],
          },
        }),
      }),
    );

    expect(response.status).toBe(500);
  });

  it("returns 500 when user.deleted cleanup fails downstream", async () => {
    vi.spyOn(Webhook.prototype, "verify").mockImplementation(
      () => ({}) as never,
    );

    const runMutation = vi.fn(
      async (_ref: unknown, _args: Record<string, unknown>) => {
        throw new Error("deletion cleanup unavailable");
      },
    );
    const webhookHandler = (
      webhooksModule.clerkWebhook as unknown as {
        _handler: (ctx: unknown, request: Request) => Promise<Response>;
      }
    )._handler;

    const response = await webhookHandler(
      { runMutation } as never,
      new Request("https://example.com/clerk/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "svix-id": "msg_002",
          "svix-timestamp": "1710000001",
          "svix-signature": "v1,signature",
        },
        body: JSON.stringify({
          type: "user.deleted",
          data: {
            id: "clerk_user_004",
          },
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      clerkUserId: "clerk_user_004",
    });
  });
});
