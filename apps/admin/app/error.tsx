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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          We could not render this admin view. Try again.
        </p>
        <button
          onClick={reset}
          className="mt-4 inline-flex items-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
