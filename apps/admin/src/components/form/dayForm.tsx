"use client";

import React, { useMemo, useState } from "react";

export type DayFormValues = {
  dayKey: string;
  rating: number | undefined;
  manualNotes: string[];
  peopleTags: string[];
};

type Props = {
  title?: string;
  description?: string;
  initialValues?: Partial<DayFormValues>;
  ownerLabel?: string;
  submitLabel?: string;
  savingLabel?: string;
  successMessage?: string;
  onSubmit: (values: DayFormValues) => Promise<void>;
};

export default function DayForm({
  title = "Day",
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
      rating: initialValues?.rating,
      manualNotes: initialValues?.manualNotes ?? [],
      peopleTags: initialValues?.peopleTags ?? [],
    }),
    [
      initialValues?.dayKey,
      initialValues?.rating,
      initialValues?.manualNotes,
      initialValues?.peopleTags,
    ],
  );

  const [dayKey, setDayKey] = useState(defaults.dayKey);
  const [rating, setRating] = useState(
    defaults.rating !== undefined ? String(defaults.rating) : "",
  );
  const [manualNotes, setManualNotes] = useState(
    defaults.manualNotes.join("\n"),
  );
  const [peopleTags, setPeopleTags] = useState(defaults.peopleTags.join(", "));
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
        rating: rating.trim() ? Number(rating) : undefined,
        manualNotes: manualNotes
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        peopleTags: peopleTags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setStatus("saved");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save day.",
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
                htmlFor="rating"
                className="block text-sm font-medium text-gray-700"
              >
                Rating (1-5)
              </label>
              <input
                id="rating"
                type="number"
                min={1}
                max={5}
                value={rating}
                onChange={(e) => {
                  setRating(e.target.value);
                  resetStatus();
                }}
                placeholder="Optional"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label
                htmlFor="manualNotes"
                className="block text-sm font-medium text-gray-700"
              >
                Manual Notes (one per line)
              </label>
              <textarea
                id="manualNotes"
                value={manualNotes}
                onChange={(e) => {
                  setManualNotes(e.target.value);
                  resetStatus();
                }}
                rows={4}
                placeholder="Each line becomes a separate note"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label
                htmlFor="peopleTags"
                className="block text-sm font-medium text-gray-700"
              >
                People Tags (comma-separated)
              </label>
              <input
                id="peopleTags"
                type="text"
                value={peopleTags}
                onChange={(e) => {
                  setPeopleTags(e.target.value);
                  resetStatus();
                }}
                placeholder="e.g. Alice, Bob"
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
