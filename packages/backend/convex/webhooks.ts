import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

// Optional: Clerk webhook endpoint to sync users into Convex.
// You can configure this in the Clerk dashboard, pointing to
//   POST /clerk/webhook
// on your Convex deployment.
//
// NOTE: For production you should verify the Svix signature
// using CLERK_WEBHOOK_SECRET. This example skips verification
// for simplicity and should be hardened before going live.

export const clerkWebhook = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payloadText = await request.text();

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
      await ctx.runMutation(api.users.syncUserFromClerk, {
        clerkUserId,
        email,
        firstName,
        lastName,
        imageUrl,
      });
    }
  }

  return new Response(null, { status: 204 });
});
