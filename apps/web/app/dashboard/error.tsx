"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { RouteErrorState } from "@/components/RouteErrorState";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: {
        route: "dashboard",
      },
    });
  }, [error]);

  return (
    <RouteErrorState
      title="We could not load this dashboard day."
      description="Please retry. If this keeps happening, check your network and try again."
      onRetry={reset}
    />
  );
}
