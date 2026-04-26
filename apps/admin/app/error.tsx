"use client";

import { useEffect } from "react";
import { captureException } from "@/lib/observability";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException("admin_route_render_failed", error, {
      status: "failed",
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We could not render this admin view. Try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 inline-flex items-center rounded-xl bg-foreground px-3 py-2 text-sm font-semibold text-background shadow-sm transition hover:bg-foreground/90"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
