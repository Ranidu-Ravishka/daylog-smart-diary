"use client";

import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ReactNode, useState } from "react";
import Link from "next/link";

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
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();

  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  // ── Auth still loading ──────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-500">Checking authentication…</p>
      </div>
    );
  }

  // ── Not signed in ───────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 max-w-md text-center">
          <h2 className="text-lg font-semibold text-gray-900">Not signed in</h2>
          <p className="mt-2 text-sm text-gray-600">
            Please sign in to access the admin panel.
          </p>
          <Link
            href="/sign-in"
            className="mt-4 inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            Sign In
          </Link>
        </div>
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

  // ── Not an admin ────────────────────────────────────────
  if (!isAdmin) {
    return <NotAdminScreen />;
  }

  // ── Admin confirmed ✓ ───────────────────────────────────
  return <>{children}</>;
}

// ──────────────────────────────────────────────────────────
// Fallback screen shown when user exists but is not admin.
// Includes a "Bootstrap" button that calls bootstrapMakeMeAdmin
// (only works if the Clerk user ID is in the server env var
// ADMIN_BOOTSTRAP_CLERK_USER_IDS).
// ──────────────────────────────────────────────────────────
function NotAdminScreen() {
  const bootstrap = useMutation(api.users.bootstrapMakeMeAdmin);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleBootstrap = async () => {
    setStatus("loading");
    try {
      await bootstrap();
      setStatus("success");
      // Convex reactivity will automatically re-run isCurrentUserAdmin
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Bootstrap failed");
    }
  };

  if (status === "success") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white border border-green-200 rounded-xl shadow-sm p-8 max-w-md text-center">
          <h2 className="text-lg font-semibold text-green-700">
            Admin access granted!
          </h2>
          <p className="mt-2 text-sm text-gray-600">Reloading data…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 max-w-md text-center">
        <h2 className="text-lg font-semibold text-gray-900">
          Admin access required
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Your account does not have admin privileges. If you are the first user
          setting up the project, click the button below to bootstrap yourself
          as admin.
        </p>
        <p className="mt-2 text-xs text-gray-400">
          (Requires your Clerk user ID in the Convex environment variable{" "}
          <code className="bg-gray-100 px-1 rounded">
            ADMIN_BOOTSTRAP_CLERK_USER_IDS
          </code>
          )
        </p>

        <button
          onClick={handleBootstrap}
          disabled={status === "loading"}
          className="mt-5 inline-flex items-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
        >
          {status === "loading" ? "Bootstrapping…" : "Bootstrap as Admin"}
        </button>

        {status === "error" && (
          <p className="mt-3 text-sm text-red-600">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
