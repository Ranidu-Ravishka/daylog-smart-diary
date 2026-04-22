"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function safeMessage(value: string | null): string {
  if (!value) return "OAuth flow finished.";
  return value;
}

function isAllowedMobileReturnProtocol(protocol: string): boolean {
  if (protocol === "mobile:" || protocol === "exp:") {
    return true;
  }

  return protocol.startsWith("exp+") && protocol.endsWith(":");
}

function resolveMobileReturnUrl(candidate: string | null): string | null {
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if (!isAllowedMobileReturnProtocol(url.protocol.toLowerCase())) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function buildMobileDeepLink(
  baseReturnUrl: string | null,
  provider: string,
  status: string,
  message: string,
): string {
  const fallback = `mobile://oauth-complete?integrationProvider=${encodeURIComponent(provider)}&integrationStatus=${encodeURIComponent(status)}&integrationMessage=${encodeURIComponent(message)}`;

  if (!baseReturnUrl) {
    return fallback;
  }

  try {
    const url = new URL(baseReturnUrl);
    url.searchParams.set("integrationProvider", provider);
    url.searchParams.set("integrationStatus", status);
    url.searchParams.set("integrationMessage", message);
    return url.toString();
  } catch {
    return fallback;
  }
}

function OAuthCompleteContent() {
  const searchParams = useSearchParams();
  // Default to "unknown" (never "success") so missing redirect params are
  // surfaced as a failure, not silently masked as a successful connection.
  const rawStatus = searchParams.get("integrationStatus");
  const status = rawStatus === "success" ? "success" : "error";
  const message = safeMessage(searchParams.get("integrationMessage"));
  const provider = searchParams.get("integrationProvider") ?? "provider";
  const mode = searchParams.get("mode") ?? "web";
  const returnUrl = resolveMobileReturnUrl(searchParams.get("returnUrl"));
  const schemeUrl = buildMobileDeepLink(returnUrl, provider, status, message);

  useEffect(() => {
    if (mode !== "mobile") return;

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
  }, [mode, schemeUrl]);

  const isSuccess = status === "success";

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center space-y-3">
        <p className="text-sm font-medium text-foreground">
          {isSuccess ? "Integration connected" : "Connection failed"}
        </p>
        <p className="text-sm text-muted-foreground">{message}</p>

        {mode === "mobile" ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Returning to app… If nothing happens automatically, tap the button
              below.
            </p>
            <a
              href={schemeUrl}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            >
              Open DayLog App
            </a>
          </div>
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
