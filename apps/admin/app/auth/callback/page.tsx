import { api } from "@repo/backend/convex";
import { ConvexHttpClient } from "convex/browser";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function AuthCallbackPage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    redirect("/unauthorized");
  }

  const { userId, getToken } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const token = await getToken({ template: "convex" });
  if (!token) {
    redirect("/unauthorized");
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (!user || !email) {
    redirect("/unauthorized");
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  await client.mutation(api.users.syncUserFromClerk, {
    clerkUserId: userId,
    email,
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
    imageUrl: user.imageUrl ?? undefined,
  });

  const isAdmin = await client.query(api.users.isCurrentUserAdmin, {});

  if (isAdmin) {
    redirect("/admin/dashboard");
  }

  redirect("/unauthorized");
}
