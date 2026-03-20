import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Webhook } from "svix";

// Clerk webhook endpoint to sync users into Convex.
// Configure in the Clerk dashboard, pointing to:
//   POST /clerk/webhook
//
function verifyWebhookSignature(
  payloadText: string,
  headers: Headers,
): boolean {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Missing CLERK_WEBHOOK_SECRET");
  }

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

export const clerkWebhook = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payloadText = await request.text();

  // Verify webhook signature when CLERK_WEBHOOK_SECRET is set
  let isValid = false;
  try {
    isValid = verifyWebhookSignature(payloadText, request.headers);
  } catch (error) {
    console.error("[clerk-webhook] Configuration error:", error);
    return new Response("Webhook not configured", { status: 500 });
  }

  if (!isValid) {
    console.error("[clerk-webhook] Signature verification failed");
    return new Response("Unauthorized: invalid signature", { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(payloadText);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventType = body?.type;
  const user = body?.data;

  if ((eventType === "user.created" || eventType === "user.updated") && user) {
    const clerkUserId: string | undefined = user.id;

    // Try to pick the primary email; fall back to first email.
    const primaryEmailId: string | undefined =
      user.primary_email_address_id ?? undefined;
    const emailAddresses: Array<any> | undefined =
      user.email_addresses ?? undefined;

    let email: string | undefined;
    if (emailAddresses && emailAddresses.length > 0) {
      const primary = emailAddresses.find(
        (e: any) => primaryEmailId && e.id === primaryEmailId,
      );
      email = (primary ?? emailAddresses[0]).email_address;
    }

    const firstName: string | undefined = user.first_name ?? undefined;
    const lastName: string | undefined = user.last_name ?? undefined;
    const imageUrl: string | undefined = user.image_url ?? undefined;

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
        console.error("[clerk-webhook] Failed to sync user:", err);
        return new Response("Internal error", { status: 500 });
      }
    } else {
      console.warn(
        "[clerk-webhook] Missing clerkUserId or email, skipping sync",
      );
    }
  }

  return new Response(null, { status: 204 });
});
