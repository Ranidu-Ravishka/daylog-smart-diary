"use client";

import { SignOutButton, useAuth } from "@clerk/nextjs";

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function UnauthorizedWithoutClerk() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">Unauthorized</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Auth is not configured for this environment.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <a
            href="/auth/callback"
            className="inline-flex items-center rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-sm transition hover:bg-foreground/90"
          >
            Re-check access
          </a>
        </div>
      </div>
    </div>
  );
}

function UnauthorizedWithClerk() {
  const { userId } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">Unauthorized</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account is signed in, but it is not allowed to access the admin
          app.
        </p>

        <div className="mt-4 rounded-lg border border-border bg-muted p-3 text-xs text-foreground">
          <div className="font-medium">Clerk User ID</div>
          <div className="mt-1 font-mono break-all">{userId ?? "—"}</div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href="/auth/callback"
            className="inline-flex items-center rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-sm transition hover:bg-foreground/90"
          >
            Re-check access
          </a>
          <SignOutButton>
            <button
              type="button"
              className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted"
            >
              Sign out
            </button>
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}

export default function UnauthorizedPage() {
  if (!hasClerk) {
    return <UnauthorizedWithoutClerk />;
  }

  return <UnauthorizedWithClerk />;
}
