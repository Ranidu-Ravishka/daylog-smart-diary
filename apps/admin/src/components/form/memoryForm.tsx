"use client";

import React, { useMemo, useState } from "react";
import { MOOD_OPTIONS } from "@repo/ui/lib/constants";
import { captureException, logInfo } from "@/lib/observability";

export type MemoryFormValues = {
  title: string;
  description: string;
  mood: string;
  happenedAt: number;
  dayKey: string;
};

type Props = {
  title?: string;
  description?: string;
  initialValues?: Partial<MemoryFormValues>;
  ownerLabel?: string;
  submitLabel?: string;
  savingLabel?: string;
  successMessage?: string;
  onSubmit: (values: MemoryFormValues) => Promise<void>;
};

export default function MemoryForm({
  title = "Memory",
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
      title: initialValues?.title ?? "",
      description: initialValues?.description ?? "",
      mood: initialValues?.mood ?? "",
      happenedAt: initialValues?.happenedAt ?? 0,
      dayKey: initialValues?.dayKey ?? "",
    }),
    [
      initialValues?.title,
      initialValues?.description,
      initialValues?.mood,
      initialValues?.happenedAt,
      initialValues?.dayKey,
    ],
  );

  const [memTitle, setMemTitle] = useState(defaults.title);
  const [desc, setDesc] = useState(defaults.description);
  const [mood, setMood] = useState(defaults.mood);
  const [happenedAt, setHappenedAt] = useState(
    new Date(defaults.happenedAt).toISOString().slice(0, 16),
  );
  const [dayKey, setDayKey] = useState(defaults.dayKey);
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
      hasTitle: memTitle.trim().length > 0,
      hasDescription: desc.trim().length > 0,
      hasMood: mood.trim().length > 0,
      hasDayKey: dayKey.trim().length > 0,
      hasHappenedAt: happenedAt.trim().length > 0,
    };

    logInfo("admin_memory_write_started", submitContext);

    try {
      await onSubmit({
        title: memTitle.trim(),
        description: desc.trim(),
        mood: mood.trim(),
        happenedAt: new Date(happenedAt).getTime(),
        dayKey: dayKey.trim(),
      });

      logInfo("admin_memory_write_succeeded", {
        ...submitContext,
        status: "succeeded",
      });
      setStatus("saved");
    } catch (error) {
      captureException("admin_memory_write_failed", error, {
        ...submitContext,
        status: "failed",
      });
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save memory.",
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
                htmlFor="memTitle"
                className="block text-sm font-medium text-foreground"
              >
                Title
              </label>
              <input
                id="memTitle"
                type="text"
                value={memTitle}
                onChange={(e) => {
                  setMemTitle(e.target.value);
                  resetStatus();
                }}
                required
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label
                htmlFor="desc"
                className="block text-sm font-medium text-foreground"
              >
                Description
              </label>
              <textarea
                id="desc"
                value={desc}
                onChange={(e) => {
                  setDesc(e.target.value);
                  resetStatus();
                }}
                rows={4}
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label
                htmlFor="mood"
                className="block text-sm font-medium text-foreground"
              >
                Mood
              </label>
              <input
                id="mood"
                type="text"
                value={mood}
                onChange={(e) => {
                  setMood(e.target.value);
                  resetStatus();
                }}
                list="mood-options"
                placeholder="e.g. happy, sad, neutral"
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id="mood-options">
                {MOOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.emoji} {option.label}
                  </option>
                ))}
              </datalist>
            </div>

            <div>
              <label
                htmlFor="happenedAt"
                className="block text-sm font-medium text-foreground"
              >
                Happened At
              </label>
              <input
                id="happenedAt"
                type="datetime-local"
                value={happenedAt}
                onChange={(e) => {
                  setHappenedAt(e.target.value);
                  resetStatus();
                }}
                required
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label
                htmlFor="dayKey"
                className="block text-sm font-medium text-foreground"
              >
                Day Key
              </label>
              <input
                id="dayKey"
                type="text"
                value={dayKey}
                onChange={(e) => {
                  setDayKey(e.target.value);
                  resetStatus();
                }}
                placeholder="YYYY-MM-DD"
                required
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
