"use client";

import React, { useMemo, useState } from "react";

export type SummaryFormValues = {
  dayKey: string;
  story: string;
  highlights: string[];
  sourcesUsed: string[];
};

type Props = {
  title?: string;
  description?: string;
  initialValues?: Partial<SummaryFormValues>;
  ownerLabel?: string;
  submitLabel?: string;
  savingLabel?: string;
  successMessage?: string;
  onSubmit: (values: SummaryFormValues) => Promise<void>;
};

export default function SummaryForm({
  title = "Day Summary",
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
      dayKey: initialValues?.dayKey ?? "",
      story: initialValues?.story ?? "",
      highlights: initialValues?.highlights ?? [],
      sourcesUsed: initialValues?.sourcesUsed ?? [],
    }),
    [
      initialValues?.dayKey,
      initialValues?.story,
      initialValues?.highlights,
      initialValues?.sourcesUsed,
    ],
  );

  const [dayKey, setDayKey] = useState(defaults.dayKey);
  const [story, setStory] = useState(defaults.story);
  const [highlights, setHighlights] = useState(defaults.highlights.join("\n"));
  const [sourcesUsed, setSourcesUsed] = useState(
    defaults.sourcesUsed.join(", "),
  );
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

    try {
      await onSubmit({
        dayKey: dayKey.trim(),
        story: story.trim(),
        highlights: highlights
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        sourcesUsed: sourcesUsed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setStatus("saved");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save summary.",
      );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-3xl mx-auto px-6">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
            {description ? (
              <p className="text-sm text-gray-500 mt-1">{description}</p>
            ) : null}
            {ownerLabel ? (
              <p className="text-xs text-gray-400 mt-1">Owner: {ownerLabel}</p>
            ) : null}
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="dayKey"
                className="block text-sm font-medium text-gray-700"
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
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label
                htmlFor="story"
                className="block text-sm font-medium text-gray-700"
              >
                Story
              </label>
              <textarea
                id="story"
                value={story}
                onChange={(e) => {
                  setStory(e.target.value);
                  resetStatus();
                }}
                rows={6}
                required
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label
                htmlFor="highlights"
                className="block text-sm font-medium text-gray-700"
              >
                Highlights (one per line)
              </label>
              <textarea
                id="highlights"
                value={highlights}
                onChange={(e) => {
                  setHighlights(e.target.value);
                  resetStatus();
                }}
                rows={4}
                placeholder="Each line becomes a separate highlight"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label
                htmlFor="sourcesUsed"
                className="block text-sm font-medium text-gray-700"
              >
                Sources Used (comma-separated)
              </label>
              <input
                id="sourcesUsed"
                type="text"
                value={sourcesUsed}
                onChange={(e) => {
                  setSourcesUsed(e.target.value);
                  resetStatus();
                }}
                placeholder="e.g. calendar, health, photos"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={status === "saving"}
                className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {status === "saving" ? savingLabel : submitLabel}
              </button>
              {status === "saved" && (
                <span className="text-sm text-green-600">{successMessage}</span>
              )}
              {status === "error" && (
                <span className="text-sm text-red-600">
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
