import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Clerk webhook endpoint to sync users into Convex.
// Configure in the Clerk dashboard, pointing to:
//   POST /clerk/webhook
//
// For production, set the CLERK_WEBHOOK_SECRET environment
// variable on the Convex dashboard so that incoming webhook
// payloads are verified against the Svix signature headers.

/**
 * Verify the webhook came from Clerk by checking the Svix
 * signature headers against CLERK_WEBHOOK_SECRET.
 * Returns true if verification passes or if no secret is
 * configured (dev-mode fallback with a console warning).
 */
async function verifyWebhookSignature(
  payloadText: string,
  headers: Headers,
): Promise<boolean> {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.warn(
      "[clerk-webhook] CLERK_WEBHOOK_SECRET is not set — skipping signature verification. Set it for production.",
    );
    return true;
  }

  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  // Verify timestamp is within 5 minutes to prevent replay attacks
  const timestampSeconds = parseInt(svixTimestamp, 10);
  if (isNaN(timestampSeconds)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > 300) {
    return false;
  }

  // Build the signed content and verify using HMAC-SHA256
  const signedContent = `${svixId}.${svixTimestamp}.${payloadText}`;
  const encoder = new TextEncoder();

  // The secret is base64-encoded with a "whsec_" prefix
  const secretBytes = Uint8Array.from(
    atob(secret.replace(/^whsec_/, "")),
    (c) => c.charCodeAt(0),
  );

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedContent),
  );

  const computedSig = btoa(
    String.fromCharCode(...new Uint8Array(signatureBytes)),
  );

  // svix-signature may contain multiple space-separated sigs (v1,xxx)
  const expectedSignatures = svixSignature.split(" ");
  return expectedSignatures.some((sig) => {
    const [, sigValue] = sig.split(",");
    return sigValue === computedSig;
  });
}

export const clerkWebhook = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payloadText = await request.text();

  // Verify webhook signature when CLERK_WEBHOOK_SECRET is set
  const isValid = await verifyWebhookSignature(payloadText, request.headers);
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
