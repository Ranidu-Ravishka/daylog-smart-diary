"use client";

import {
  ConvexReactClient,
  ConvexProviderWithAuth,
  useMutation,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { api } from "@repo/backend/convex";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/**
 * Dummy auth hook used when Clerk is not configured.
 * Provides the same shape expected by ConvexProviderWithAuth so that
 * useConvexAuth() works everywhere (returns isAuthenticated: false).
 */
function useNoAuth() {
  const fetchAccessToken = useCallback(async () => null, []);
  return useMemo(
    () => ({
      isLoading: false,
      isAuthenticated: false,
      fetchAccessToken,
    }),
    [fetchAccessToken],
  );
}

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
          ).emailAddress
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

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!hasClerk) {
    return (
      <ConvexProviderWithAuth client={convex} useAuth={useNoAuth}>
        {children}
      </ConvexProviderWithAuth>
    );
  }

  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      <SyncClerkUserToConvex />
      {children}
    </ConvexProviderWithClerk>
  );
}
