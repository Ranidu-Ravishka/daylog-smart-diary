"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { RouteErrorState } from "@/components/RouteErrorState";

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: {
        route: "dashboard/settings",
      },
    });
  }, [error]);

  return (
    <RouteErrorState
      title="We could not load settings."
      description="Please retry. If the issue continues, refresh the page and try again."
      onRetry={reset}
    />
  );
}
