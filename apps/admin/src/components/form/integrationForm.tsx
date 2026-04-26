"use client";

import React, { useMemo, useState } from "react";
import { captureException, logInfo } from "@/lib/observability";

export type IntegrationFormValues = {
  provider: string;
  status: "connected" | "disconnected" | "error";
  scopes: string[];
  tokenRef: string;
};

type Props = {
  title?: string;
  description?: string;
  initialValues?: Partial<IntegrationFormValues>;
  ownerLabel?: string;
  submitLabel?: string;
  savingLabel?: string;
  successMessage?: string;
  onSubmit: (values: IntegrationFormValues) => Promise<void>;
};

export default function IntegrationForm({
  title = "Integration",
  description,
  initialValues,
  ownerLabel,
  submitLabel = "Save",
  savingLabel = "Saving...",
  successMessage = "Saved successfully.",
  onSubmit,
}: Props) {
  const defaults = useMemo(
    () => ({
      provider: initialValues?.provider ?? "",
      status: initialValues?.status ?? ("connected" as const),
      scopes: initialValues?.scopes ?? [],
      tokenRef: initialValues?.tokenRef ?? "",
    }),
    [
      initialValues?.provider,
      initialValues?.status,
      initialValues?.scopes,
      initialValues?.tokenRef,
    ],
  );

  const [provider, setProvider] = useState(defaults.provider);
  const [intStatus, setIntStatus] = useState<
    "connected" | "disconnected" | "error"
  >(defaults.status);
  const [scopes, setScopes] = useState(defaults.scopes.join(", "));
  const [tokenRef, setTokenRef] = useState(defaults.tokenRef);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetStatus = () => {
    if (status !== "idle") {
      setStatus("idle");
      setErrorMessage(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage(null);

    const scopesCount = scopes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean).length;

    const submitContext = {
      status: "started",
      formTitle: title,
      provider: provider.trim().toLowerCase(),
      integrationStatus: intStatus,
      scopesCount,
      hasTokenRef: tokenRef.trim().length > 0,
    };

    logInfo("admin_integration_write_started", submitContext);

    try {
      await onSubmit({
        provider: provider.trim(),
        status: intStatus,
        scopes: scopes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        tokenRef: tokenRef.trim(),
      });

      logInfo("admin_integration_write_succeeded", {
        ...submitContext,
        status: "succeeded",
      });
      setStatus("saved");
    } catch (error) {
      captureException("admin_integration_write_failed", error, {
        ...submitContext,
        status: "failed",
      });
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save integration.",
      );
    }
  };

  return (
    <div className="w-full">
      <div className="max-w-3xl mx-auto px-6">
        <div className="bg-card border border-border rounded-xl shadow-sm p-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            {description ? (
              <p className="text-sm text-muted-foreground mt-1">
                {description}
              </p>
            ) : null}
            {ownerLabel ? (
              <p className="text-xs text-muted-foreground mt-1">
                Owner: {ownerLabel}
              </p>
            ) : null}
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="provider"
                className="block text-sm font-medium text-foreground"
              >
                Provider
              </label>
              <input
                id="provider"
                type="text"
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  resetStatus();
                }}
                required
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label
                htmlFor="intStatus"
                className="block text-sm font-medium text-foreground"
              >
                Status
              </label>
              <select
                id="intStatus"
                value={intStatus}
                onChange={(e) => {
                  setIntStatus(
                    e.target.value as "connected" | "disconnected" | "error",
                  );
                  resetStatus();
                }}
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="connected">Connected</option>
                <option value="disconnected">Disconnected</option>
                <option value="error">Error</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="scopes"
                className="block text-sm font-medium text-foreground"
              >
                Scopes (comma-separated)
              </label>
              <input
                id="scopes"
                type="text"
                value={scopes}
                onChange={(e) => {
                  setScopes(e.target.value);
                  resetStatus();
                }}
                placeholder="e.g. read, write"
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label
                htmlFor="tokenRef"
                className="block text-sm font-medium text-foreground"
              >
                Token Ref
              </label>
              <input
                id="tokenRef"
                type="text"
                value={tokenRef}
                onChange={(e) => {
                  setTokenRef(e.target.value);
                  resetStatus();
                }}
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={status === "saving"}
                className="inline-flex items-center rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-sm transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === "saving" ? savingLabel : submitLabel}
              </button>
              {status === "saved" && (
                <span className="text-sm text-muted-foreground">
                  {successMessage}
                </span>
              )}
              {status === "error" && (
                <span className="text-sm text-foreground">
                  {errorMessage ?? "Something went wrong."}
                </span>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
