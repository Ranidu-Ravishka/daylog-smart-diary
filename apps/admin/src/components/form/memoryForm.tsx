"use client";

import React, { useMemo, useState } from "react";

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

    try {
      await onSubmit({
        title: memTitle.trim(),
        description: desc.trim(),
        mood: mood.trim(),
        happenedAt: new Date(happenedAt).getTime(),
        dayKey: dayKey.trim(),
      });
      setStatus("saved");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save memory.",
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
                htmlFor="memTitle"
                className="block text-sm font-medium text-gray-700"
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
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label
                htmlFor="desc"
                className="block text-sm font-medium text-gray-700"
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
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label
                htmlFor="mood"
                className="block text-sm font-medium text-gray-700"
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
                placeholder="e.g. happy, sad, neutral"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label
                htmlFor="happenedAt"
                className="block text-sm font-medium text-gray-700"
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
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

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
