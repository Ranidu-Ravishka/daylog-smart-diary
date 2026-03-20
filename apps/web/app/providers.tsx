"use client";

import { ConvexReactClient, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ReactNode, useEffect, useRef } from "react";
import { ClerkProvider, useAuth, useUser } from "@clerk/nextjs";
import { api } from "@repo/backend/convex";
import { ToastProvider } from "@/components/ToastProvider";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

function SyncClerkUserToConvex() {
  const { isLoaded, isSignedIn, user } = useUser();
  const syncUser = useMutation(api.users.syncUserFromClerk);
  const lastSyncedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    if (lastSyncedUserId.current === user.id) return;

    const primaryEmailId = user.primaryEmailAddressId;
    const emailAddresses = user.emailAddresses;

    const email =
      emailAddresses && emailAddresses.length > 0
        ? (
            emailAddresses.find((e) =>
              primaryEmailId
                ? e.id === primaryEmailId
                : e.id === user.primaryEmailAddressId,
            ) ?? emailAddresses[0]
          )?.emailAddress
        : undefined;

    if (!email) return;

    syncUser({
      clerkUserId: user.id,
      email,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
      imageUrl: user.imageUrl ?? undefined,
    }).catch((error) => {
      console.error("Failed to sync user to Convex", error);
    });

    lastSyncedUserId.current = user.id;
  }, [isLoaded, isSignedIn, user, syncUser]);

  return null;
}

function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) return <>{children}</>;

  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      <SyncClerkUserToConvex />
      {children}
    </ConvexProviderWithClerk>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!clerkPublishableKey) {
    return <ToastProvider>{children}</ToastProvider>;
  }

  const inner = <ConvexClientProvider>{children}</ConvexClientProvider>;

  return (
    <ToastProvider>
      <ClerkProvider publishableKey={clerkPublishableKey}>
        {inner}
      </ClerkProvider>
    </ToastProvider>
  );
}
