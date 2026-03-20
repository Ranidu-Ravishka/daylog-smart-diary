"use client";

import { api } from "@repo/backend/convex";
import { useConvexAuth, useQuery } from "convex/react";
import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";

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
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();

  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/sign-in");
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && isAdmin === false) {
      router.replace("/unauthorized");
    }
  }, [authLoading, isAuthenticated, isAdmin, router]);

  // ── Auth still loading ──────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-500">Checking authentication…</p>
      </div>
    );
  }

  // ── Waiting for admin status query ──────────────────────
  if (isAdmin === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-500">Verifying admin access…</p>
      </div>
    );
  }

  if (!isAuthenticated || isAdmin === false) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-500">Redirecting…</p>
      </div>
    );
  }

  // ── Admin confirmed ✓ ───────────────────────────────────
  return <>{children}</>;
}
