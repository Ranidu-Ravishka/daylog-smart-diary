"use client";

import React, { useMemo, useState } from "react";
import { captureException, logInfo } from "@/lib/observability";

export type UserFormValues = {
  email: string;
  firstName: string;
  lastName: string;
  isAdmin: boolean;
};

type Props = {
  title?: string;
  description?: string;
  initialValues?: Partial<UserFormValues>;
  submitLabel?: string;
  savingLabel?: string;
  successMessage?: string;
  onSubmit: (values: UserFormValues) => Promise<void>;
};

export default function UserForm({
  title = "User",
  description,
  initialValues,
  submitLabel = "Save",
  savingLabel = "Saving...",
  successMessage = "Saved successfully.",
  onSubmit,
}: Props) {
  const defaults = useMemo(
    () => ({
      email: initialValues?.email ?? "",
      firstName: initialValues?.firstName ?? "",
      lastName: initialValues?.lastName ?? "",
      isAdmin: initialValues?.isAdmin ?? false,
    }),
    [
      initialValues?.email,
      initialValues?.firstName,
      initialValues?.lastName,
      initialValues?.isAdmin,
    ],
  );

  const [email, setEmail] = useState(defaults.email);
  const [firstName, setFirstName] = useState(defaults.firstName);
  const [lastName, setLastName] = useState(defaults.lastName);
  const [isAdmin, setIsAdmin] = useState(defaults.isAdmin);
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

    const submitContext = {
      status: "started",
      formTitle: title,
      hasEmail: email.trim().length > 0,
      hasFirstName: firstName.trim().length > 0,
      hasLastName: lastName.trim().length > 0,
      isAdmin,
    };

    logInfo("admin_user_write_started", submitContext);

    try {
      await onSubmit({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        isAdmin,
      });

      logInfo("admin_user_write_succeeded", {
        ...submitContext,
        status: "succeeded",
      });
      setStatus("saved");
    } catch (error) {
      captureException("admin_user_write_failed", error, {
        ...submitContext,
        status: "failed",
      });
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save user.",
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
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-foreground"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  resetStatus();
                }}
                required
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label
                htmlFor="firstName"
                className="block text-sm font-medium text-foreground"
              >
                First Name
              </label>
              <input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  resetStatus();
                }}
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label
                htmlFor="lastName"
                className="block text-sm font-medium text-foreground"
              >
                Last Name
              </label>
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  resetStatus();
                }}
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex items-center gap-3">
              <input
                id="isAdmin"
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => {
                  setIsAdmin(e.target.checked);
                  resetStatus();
                }}
                className="h-4 w-4 rounded border-border text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <label
                htmlFor="isAdmin"
                className="text-sm font-medium text-foreground"
              >
                Admin
              </label>
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
