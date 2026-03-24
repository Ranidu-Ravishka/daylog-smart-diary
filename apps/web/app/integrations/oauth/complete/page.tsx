"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function safeMessage(value: string | null): string {
  if (!value) return "OAuth flow finished.";
  return value;
}

function OAuthCompleteContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get("integrationStatus") ?? "success";
  const message = safeMessage(searchParams.get("integrationMessage"));
  const provider = searchParams.get("integrationProvider") ?? "provider";
  const mode = searchParams.get("mode") ?? "web";

  useEffect(() => {
    if (mode !== "mobile") return;

    const schemeUrl = `mobile://oauth-complete?integrationProvider=${encodeURIComponent(provider)}&integrationStatus=${encodeURIComponent(status)}&integrationMessage=${encodeURIComponent(message)}`;

    const attemptOpen = setTimeout(() => {
      window.location.href = schemeUrl;
    }, 120);

    const attemptClose = setTimeout(() => {
      try {
        window.close();
      } catch {
        // no-op
      }
    }, 900);

    return () => {
      clearTimeout(attemptOpen);
      clearTimeout(attemptClose);
    };
  }, [message, mode, provider, status]);

  const isSuccess = status === "success";

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center space-y-3">
        <p className="text-sm font-medium text-foreground">
          {isSuccess ? "Integration connected" : "Connection failed"}
        </p>
        <p className="text-sm text-muted-foreground">{message}</p>

        {mode === "mobile" ? (
          <p className="text-xs text-muted-foreground">
            Returning to app… If nothing happens, close this browser and return
            to DayLog.
          </p>
        ) : (
          <a
            href="/dashboard/settings"
            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
          >
            Back to settings
          </a>
        )}
      </div>
    </main>
  );
}

export default function OAuthCompletePage() {
  return (
    <Suspense fallback={null}>
      <OAuthCompleteContent />
    </Suspense>
  );
}
