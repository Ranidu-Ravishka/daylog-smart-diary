import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Webhook } from "svix";
import { convexServerEnv } from "./env";
import { captureException, logInfo, logWarn } from "./observability";

type ClerkWebhookEmailAddress = {
  id?: string;
  email_address?: string;
};

type ClerkWebhookUserPayload = {
  id?: string;
  primary_email_address_id?: string;
  email_addresses?: ClerkWebhookEmailAddress[];
  first_name?: string;
  last_name?: string;
  image_url?: string;
};

type ParsedClerkWebhookUser = {
  clerkUserId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
};

// Clerk webhook endpoint to sync users into Convex.
// Configure in the Clerk dashboard, pointing to:
//   POST /clerk/webhook
//
function verifyWebhookSignature(
  payloadText: string,
  headers: Headers,
): boolean {
  const secret = convexServerEnv.clerkWebhookSecret;

  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  const webhook = new Webhook(secret);

  try {
    webhook.verify(payloadText, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
    return true;
  } catch {
    return false;
  }
}

export function parseClerkWebhookUser(
  user: ClerkWebhookUserPayload | null | undefined,
): ParsedClerkWebhookUser {
  if (!user) return {};

  const clerkUserId = user.id;
  const primaryEmailId = user.primary_email_address_id;
  const emailAddresses = user.email_addresses;

  const email =
    emailAddresses && emailAddresses.length > 0
      ? (
          emailAddresses.find((entry) =>
            primaryEmailId ? entry.id === primaryEmailId : false,
          ) ?? emailAddresses[0]
        )?.email_address
      : undefined;

  return {
    clerkUserId,
    email,
    firstName: user.first_name,
    lastName: user.last_name,
    imageUrl: user.image_url,
  };
}

export const clerkWebhook = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  logInfo("webhook.started", {
    status: "started",
    path: "/clerk/webhook",
  });

  const payloadText = await request.text();

  // Verify webhook signature when CLERK_WEBHOOK_SECRET is set
  let isValid = false;
  try {
    isValid = verifyWebhookSignature(payloadText, request.headers);
  } catch (error) {
    captureException("webhook.configuration_error", error, {
      status: "failed",
      path: "/clerk/webhook",
    });
    return new Response("Webhook not configured", { status: 500 });
  }

  if (!isValid) {
    logWarn("webhook.signature_verification_failed", {
      status: "failed",
      path: "/clerk/webhook",
    });
    return new Response("Unauthorized: invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(payloadText);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const typedBody = body as { type?: string; data?: ClerkWebhookUserPayload };
  const eventType = typedBody.type;
  const user = typedBody.data;

  if ((eventType === "user.created" || eventType === "user.updated") && user) {
    const { clerkUserId, email, firstName, lastName, imageUrl } =
      parseClerkWebhookUser(user);

    if (clerkUserId && email) {
      try {
        await ctx.runMutation(internal.users.syncUserFromClerkWebhook, {
          clerkUserId,
          email,
          firstName,
          lastName,
          imageUrl,
        });
      } catch (err) {
        captureException("webhook.user_sync_failed", err, {
          status: "failed",
          eventType,
          clerkUserId,
          userId: clerkUserId,
        });
        return new Response("Internal error", { status: 500 });
      }
    } else {
      logWarn("webhook.user_sync_skipped_missing_identity", {
        status: "skipped",
        eventType,
      });
    }
  }

  if (eventType === "user.deleted" && user) {
    const clerkUserId: string | undefined = user.id;
    if (!clerkUserId) {
      logWarn("webhook.user_delete_skipped_missing_identity", {
        status: "skipped",
        eventType,
      });

      logInfo("webhook.succeeded", {
        status: "succeeded",
        path: "/clerk/webhook",
        eventType,
      });

      return new Response(null, { status: 204 });
    }

    try {
      await ctx.runMutation(internal.users.deleteUserAndRelatedDataByClerkId, {
        clerkUserId,
      });
    } catch (err) {
      captureException("webhook.user_delete_failed", err, {
        status: "failed",
        eventType,
        clerkUserId,
        userId: clerkUserId,
      });
      return new Response("Internal error", { status: 500 });
    }
  }

  logInfo("webhook.succeeded", {
    status: "succeeded",
    path: "/clerk/webhook",
    eventType,
  });

  return new Response(null, { status: 204 });
});
