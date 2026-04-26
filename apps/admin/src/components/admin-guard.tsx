"use client";

import { api } from "@repo/backend/convex";
import { useConvexAuth, useQuery } from "convex/react";
import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { logWarn } from "@/lib/observability";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Wraps any admin-only page.
 *
 * Renders children ONLY when the signed-in user has `isAdmin: true`.
 * Otherwise shows an appropriate status message:
 *  – "Checking authentication…" while Clerk loads
 *  – "Not signed in" if unauthenticated
 *  – "You need admin access" + optional bootstrap button
 */
export default function AdminGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();

  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      logWarn("admin_guard_redirected_to_sign_in", {
        status: "unauthorized",
        route: pathname,
      });
      router.replace("/sign-in");
    }
  }, [authLoading, isAuthenticated, pathname, router]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && isAdmin === false) {
      logWarn("admin_guard_redirected_to_unauthorized", {
        status: "forbidden",
        route: pathname,
      });
      router.replace("/unauthorized");
    }
  }, [authLoading, isAuthenticated, isAdmin, pathname, router]);

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] flex-col gap-6 p-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isAdmin === undefined) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-6">
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-4 w-56" />
        <p className="text-sm text-muted-foreground ">
          Verifying admin access…
        </p>
      </div>
    );
  }

  if (!isAuthenticated || isAdmin === false) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-6">
        <Skeleton className="h-4 w-40" />
        <p className="text-sm text-muted-foreground ">Redirecting…</p>
      </div>
    );
  }

  return <>{children}</>;
}
