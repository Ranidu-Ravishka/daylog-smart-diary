"use client";

import {
  ConvexProviderWithAuth,
  ConvexReactClient,
  useMutation,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ReactNode, useEffect } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { api } from "@repo/backend/convex";
import { useSyncClerkUserToConvex } from "@repo/ui/hooks/use-sync-clerk";
import {
  captureException,
  clearSentryUserContext,
  setSentryUserContext,
} from "@/lib/observability";
import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";

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
  useSyncClerkUserToConvex({
    isLoaded,
    isSignedIn,
    user,
    syncUser,
    onSyncError: (error, context) => {
      captureException("admin_sync_user_to_convex_failed", error, {
        status: "failed",
        clerkUserId: context.clerkUserId,
        userId: context.clerkUserId,
      });
    },
  });

  return null;
}

function SyncSentryUserContext() {
  const { isLoaded, isSignedIn, user } = useUser();

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!isSignedIn || !user) {
      clearSentryUserContext();
      return;
    }

    setSentryUserContext({
      clerkUserId: user.id,
    });
  }, [isLoaded, isSignedIn, user]);

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
      <SyncSentryUserContext />
      <SyncClerkUserToConvex />
      {children}
    </ConvexProviderWithClerk>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
