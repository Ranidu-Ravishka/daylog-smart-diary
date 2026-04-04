"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { RouteErrorState } from "@/components/RouteErrorState";

export default function ExportError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: {
        route: "dashboard/export",
      },
    });
  }, [error]);

  return (
    <RouteErrorState
      title="We could not load export tools."
      description="Please retry. If this keeps happening, refresh and try again."
      onRetry={reset}
    />
  );
}
