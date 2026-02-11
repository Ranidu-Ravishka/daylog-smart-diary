"use client";

import { SignOutButton, useAuth } from "@clerk/nextjs";

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function NoAuthUnauthorized() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-lg w-full rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Unauthorized</h1>
        <p className="mt-2 text-sm text-gray-600">
          Auth is not configured for this deployment.
        </p>
      </div>
    </div>
  );
}

function ClerkUnauthorized() {
  const { userId } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-lg w-full rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Unauthorized</h1>
        <p className="mt-2 text-sm text-gray-600">
          Your account is signed in, but it is not allowed to access the admin
          app.
        </p>

        <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
          <div className="font-medium">Clerk User ID</div>
          <div className="mt-1 font-mono break-all">{userId ?? "—"}</div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <a
            href="/auth/callback"
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            Re-check access
          </a>
          <SignOutButton>
            <button className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm transition hover:bg-gray-50">
              Sign out
            </button>
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}

export default function UnauthorizedPage() {
  return hasClerk ? <ClerkUnauthorized /> : <NoAuthUnauthorized />;
}
