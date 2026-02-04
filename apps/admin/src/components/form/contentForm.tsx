"use client";

import React, { useMemo, useState } from "react";

export type ContentFormValues = {
  slug: string;
  title: string;
  body: string;
};

type Props = {
  title?: string;
  description?: string;
  initialValues?: Partial<ContentFormValues>;
  slugDisabled?: boolean;
  submitLabel?: string;
  savingLabel?: string;
  successMessage?: string;
  onSubmit: (values: ContentFormValues) => Promise<void>;
};

export default function ContentForm({
  title = "Content",
  description,
  initialValues,
  slugDisabled = false,
  submitLabel = "Save",
  savingLabel = "Saving...",
  successMessage = "Saved successfully.",
  onSubmit,
}: Props) {
  const defaults = useMemo(
    () => ({
      slug: initialValues?.slug ?? "",
      title: initialValues?.title ?? "",
      body: initialValues?.body ?? "",
    }),
    [initialValues?.slug, initialValues?.title, initialValues?.body],
  );

  const [slug, setSlug] = useState(defaults.slug);
  const [contentTitle, setContentTitle] = useState(defaults.title);
  const [body, setBody] = useState(defaults.body);
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
        slug: slug.trim(),
        title: contentTitle.trim(),
        body: body.trim(),
      });
      setStatus("saved");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save content.",
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
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="slug"
                className="block text-sm font-medium text-gray-700"
              >
                Slug
              </label>
              <input
                id="slug"
                name="slug"
                type="text"
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value);
                  resetStatus();
                }}
                placeholder="e.g. daily-reflection"
                required
                disabled={slugDisabled}
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>

            <div>
              <label
                htmlFor="title"
                className="block text-sm font-medium text-gray-700"
              >
                Title
              </label>
              <input
                id="title"
                name="title"
                type="text"
                value={contentTitle}
                onChange={(event) => {
                  setContentTitle(event.target.value);
                  resetStatus();
                }}
                placeholder="Add a descriptive title"
                required
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label
                htmlFor="body"
                className="block text-sm font-medium text-gray-700"
              >
                Body
              </label>
              <textarea
                id="body"
                name="body"
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  resetStatus();
                }}
                placeholder="Write the content body here..."
                rows={8}
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
