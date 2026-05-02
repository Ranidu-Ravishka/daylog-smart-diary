"use client";

import { PageContainer } from "@/components/page-container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@repo/backend/convex";
import { SignedIn, SignedOut, useUser } from "@clerk/nextjs";
import { useConvexAuth, useQuery } from "convex/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTheme } from "next-themes";
import { memo, useMemo } from "react";

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const ClerkUserProfile = dynamic(
  () => import("@clerk/nextjs").then((m) => m.UserProfile),
  {
    ssr: false,
    loading: () => (
      <Skeleton className="mx-auto h-[420px] w-full max-w-3xl rounded-2xl" />
    ),
  },
);

const ProfileContent = memo(function ProfileContent() {
  const { user, isLoaded } = useUser();
  const { isAuthenticated } = useConvexAuth();
  const { resolvedTheme } = useTheme();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const clerkAppearance = useMemo(() => {
    const dark = resolvedTheme === "dark";
    return {
      variables: {
        colorBackground: dark ? "#1E1E1E" : "#FFFFFF",
        colorInputBackground: dark ? "#1E1E1E" : "#FFFFFF",
        colorText: dark ? "#EAEAEA" : "#1A1A1A",
        colorTextSecondary: dark ? "#A0A0A0" : "#6B6B6B",
        colorNeutral: dark ? "#232323" : "#F2F2F2",
        colorPrimary: dark ? "#3F5661" : "#2F3E46",
        colorTextOnPrimaryBackground: "#FFFFFF",
      },
      elements: {
        rootBox: "w-full flex justify-center",
        card: "shadow-sm rounded-2xl w-full max-w-3xl border border-border bg-card",
        pageScrollBox: "p-4",
      },
    };
  }, [resolvedTheme]);

  if (!isLoaded) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <p className="text-sm text-muted-foreground">
        Sign in to view your profile.{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline">
          Sign in
        </Link>
      </p>
    );
  }

  const fallback =
    user.firstName?.trim() ||
    user.primaryEmailAddress?.emailAddress?.trim() ||
    "User";
  const roleLabel =
    isAdmin === true ? "Administrator" : isAdmin === false ? "Standard" : "…";

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border bg-card shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-start gap-5 border-b border-border pb-6">
          <UserAvatar
            src={user.imageUrl}
            alt={user.fullName || "Profile"}
            fallbackLabel={fallback}
            size="xl"
            className="ring-2 ring-border"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <CardTitle className="text-lg font-semibold">
              {user.fullName || fallback}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {user.primaryEmailAddress?.emailAddress}
            </p>
            <div className="flex flex-wrap gap-2 pt-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 font-medium text-foreground">
                Role: {roleLabel}
              </span>
              <span>
                Joined{" "}
                {user.createdAt ? user.createdAt.toLocaleDateString() : "—"}
              </span>
              {user.updatedAt ? (
                <span>Profile updated {user.updatedAt.toLocaleString()}</span>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <p className="mb-4 text-sm text-muted-foreground">
            Update your photo, name, and security settings with Clerk. Changes
            sync to this console after you save.
          </p>
          <div className="flex justify-center">
            <ClerkUserProfile appearance={clerkAppearance} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

function NoClerkProfile() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Set{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-foreground">
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
        </code>{" "}
        to enable authentication and profile management.
      </CardContent>
    </Card>
  );
}

export default function ProfilePage() {
  if (!hasClerk) {
    return (
      <PageContainer title="Profile" description="Your account">
        <NoClerkProfile />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Profile"
      description="Your DayLog identity and account settings."
    >
      <SignedOut>
        <p className="text-sm text-muted-foreground">
          <Link
            href="/sign-in"
            className="font-medium text-foreground underline"
          >
            Sign in
          </Link>{" "}
          to view your profile.
        </p>
      </SignedOut>
      <SignedIn>
        <ProfileContent />
      </SignedIn>
    </PageContainer>
  );
}
