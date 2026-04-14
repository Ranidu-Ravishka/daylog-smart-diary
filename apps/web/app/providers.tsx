"use client";

import { ConvexReactClient, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ReactNode } from "react";
import { ClerkProvider, useAuth, useUser } from "@clerk/nextjs";
import { api } from "@repo/backend/convex";
import { useSyncClerkUserToConvex } from "@repo/ui/hooks/use-sync-clerk";
import { ToastProvider } from "@/components/ToastProvider";
import { captureException } from "@/lib/observability";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

function SyncClerkUserToConvex() {
  const { isLoaded, isSignedIn, user } = useUser();
  const syncUser = useMutation(api.users.syncUserFromClerk);
  useSyncClerkUserToConvex({
    isLoaded,
    isSignedIn,
    user,
    syncUser,
    onSyncError: (error, context) => {
      captureException("web_sync_user_to_convex_failed", error, {
        status: "failed",
        clerkUserId: context.clerkUserId,
        userId: context.clerkUserId,
      });
    },
  });

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
