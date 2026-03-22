"use client";

import { useEffect, useRef } from "react";

type ClerkLikeEmailAddress = {
  id: string;
  emailAddress: string;
};

type ClerkLikeUser = {
  id: string;
  primaryEmailAddressId?: string | null;
  emailAddresses?: ClerkLikeEmailAddress[];
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
};

type UseSyncClerkUserToConvexArgs = {
  isLoaded: boolean;
  isSignedIn?: boolean | null;
  user: ClerkLikeUser | null | undefined;
  syncUser: (args: {
    clerkUserId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    imageUrl?: string;
  }) => Promise<unknown>;
};

export function useSyncClerkUserToConvex({
  isLoaded,
  isSignedIn,
  user,
  syncUser,
}: UseSyncClerkUserToConvexArgs): void {
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
              primaryEmailId ? e.id === primaryEmailId : false,
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
}
