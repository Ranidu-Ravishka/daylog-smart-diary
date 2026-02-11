"use client";

import {
  ConvexReactClient,
  ConvexProviderWithAuth,
  useMutation,
} from "convex/react";
import { ReactNode, useEffect, useRef } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { api } from "@repo/backend/convex";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

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
  const { isLoaded, isSignedIn, getToken } = useAuth();

  return (
    <ConvexProviderWithAuth
      client={convex}
      useAuth={() => ({
        isLoading: !isLoaded,
        isAuthenticated: !!isSignedIn,
        fetchAccessToken: async ({ forceRefreshToken }) => {
          return await getToken({
            template: "convex",
            skipCache: forceRefreshToken,
          });
        },
      })}
    >
      <SyncClerkUserToConvex />
      {children}
    </ConvexProviderWithAuth>
  );
}
