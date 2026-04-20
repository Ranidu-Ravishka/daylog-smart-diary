"use client";

import React, { useMemo, useState } from "react";
import { captureException, logInfo } from "@/lib/observability";

export type PreferenceFormValues = {
  focusAreas: number[];
  reminderType: "daily" | "weekly";
  dailyTime: string;
  weeklyDay: string;
  formattedTime: string;
};

type Props = {
  title?: string;
  description?: string;
  initialValues?: Partial<PreferenceFormValues>;
  ownerLabel?: string;
  submitLabel?: string;
  savingLabel?: string;
  successMessage?: string;
  onSubmit: (values: PreferenceFormValues) => Promise<void>;
};

export default function PreferenceForm({
  title = "User Preference",
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
      focusAreas: initialValues?.focusAreas ?? [],
      reminderType: initialValues?.reminderType ?? ("daily" as const),
      dailyTime: initialValues?.dailyTime ?? "",
      weeklyDay: initialValues?.weeklyDay ?? "",
      formattedTime: initialValues?.formattedTime ?? "",
    }),
    [
      initialValues?.focusAreas,
      initialValues?.reminderType,
      initialValues?.dailyTime,
      initialValues?.weeklyDay,
      initialValues?.formattedTime,
    ],
  );

  const [focusAreas, setFocusAreas] = useState(defaults.focusAreas.join(", "));
  const [reminderType, setReminderType] = useState<"daily" | "weekly">(
    defaults.reminderType,
  );
  const [dailyTime, setDailyTime] = useState(defaults.dailyTime);
  const [weeklyDay, setWeeklyDay] = useState(defaults.weeklyDay);
  const [formattedTime, setFormattedTime] = useState(defaults.formattedTime);
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

    const focusAreaCount = focusAreas
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean).length;

    const submitContext = {
      status: "started",
      formTitle: title,
      focusAreaCount,
      reminderType,
      hasDailyTime: dailyTime.trim().length > 0,
      hasWeeklyDay: weeklyDay.trim().length > 0,
      hasFormattedTime: formattedTime.trim().length > 0,
    };

    logInfo("admin_preference_write_started", submitContext);

    try {
      await onSubmit({
        focusAreas: focusAreas
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map(Number),
        reminderType,
        dailyTime: dailyTime.trim(),
        weeklyDay: weeklyDay.trim(),
        formattedTime: formattedTime.trim(),
      });

      logInfo("admin_preference_write_succeeded", {
        ...submitContext,
        status: "succeeded",
      });
      setStatus("saved");
    } catch (error) {
      captureException("admin_preference_write_failed", error, {
        ...submitContext,
        status: "failed",
      });
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save preferences.",
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
                htmlFor="focusAreas"
                className="block text-sm font-medium text-gray-700"
              >
                Focus Areas (comma-separated numbers)
              </label>
              <input
                id="focusAreas"
                type="text"
                value={focusAreas}
                onChange={(e) => {
                  setFocusAreas(e.target.value);
                  resetStatus();
                }}
                placeholder="e.g. 1, 2, 3"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label
                htmlFor="reminderType"
                className="block text-sm font-medium text-gray-700"
              >
                Reminder Type
              </label>
              <select
                id="reminderType"
                value={reminderType}
                onChange={(e) => {
                  setReminderType(e.target.value as "daily" | "weekly");
                  resetStatus();
                }}
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="dailyTime"
                className="block text-sm font-medium text-gray-700"
              >
                Daily Time
              </label>
              <input
                id="dailyTime"
                type="text"
                value={dailyTime}
                onChange={(e) => {
                  setDailyTime(e.target.value);
                  resetStatus();
                }}
                placeholder="e.g. 09:00"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label
                htmlFor="weeklyDay"
                className="block text-sm font-medium text-gray-700"
              >
                Weekly Day
              </label>
              <input
                id="weeklyDay"
                type="text"
                value={weeklyDay}
                onChange={(e) => {
                  setWeeklyDay(e.target.value);
                  resetStatus();
                }}
                placeholder="e.g. Monday"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label
                htmlFor="formattedTime"
                className="block text-sm font-medium text-gray-700"
              >
                Formatted Time
              </label>
              <input
                id="formattedTime"
                type="text"
                value={formattedTime}
                onChange={(e) => {
                  setFormattedTime(e.target.value);
                  resetStatus();
                }}
                placeholder="e.g. 9:00 AM"
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
