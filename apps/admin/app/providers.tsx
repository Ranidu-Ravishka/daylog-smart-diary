"use client";

import {
  ConvexProviderWithAuth,
  ConvexReactClient,
  useMutation,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ReactNode } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { api } from "@repo/backend/convex";
import { useSyncClerkUserToConvex } from "@repo/ui/hooks/use-sync-clerk";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;
const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function useNoAuth() {
  return {
    isLoading: false,
    isAuthenticated: false,
    fetchAccessToken: async () => null,
  };
}

function SyncClerkUserToConvex() {
  const { isLoaded, isSignedIn, user } = useUser();
  const syncUser = useMutation(api.users.syncUserFromClerk);
  useSyncClerkUserToConvex({ isLoaded, isSignedIn, user, syncUser });

  return null;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) return <>{children}</>;

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
