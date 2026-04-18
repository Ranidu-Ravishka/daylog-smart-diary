"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { useConvex, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

const CONTENT_PAGE_SIZE = 50;

type ContentRow = {
  _id: string;
  _creationTime: number;
  slug: string;
  title: string;
};

type ContentPageResponse = {
  items: ContentRow[];
  nextCursor: string | null;
};

function mergeContentRows(
  primary: ContentRow[],
  secondary: ContentRow[],
): ContentRow[] {
  const seen = new Set<string>();
  const merged: ContentRow[] = [];

  for (const row of [...primary, ...secondary]) {
    if (seen.has(row._id)) {
      continue;
    }

    seen.add(row._id);
    merged.push(row);
  }

  return merged;
}

export default function ContentPage() {
  const convex = useConvex();
  const [extraContentRows, setExtraContentRows] = useState<ContentRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const contentResponse = useQuery(api.content.getContent, {
    limit: CONTENT_PAGE_SIZE,
  }) as ContentPageResponse | undefined;

  const contentRows = useMemo(
    () => mergeContentRows(contentResponse?.items ?? [], extraContentRows),
    [contentResponse?.items, extraContentRows],
  );

  const effectiveNextCursor = nextCursor ?? contentResponse?.nextCursor ?? null;

  const deleteContent = useMutation(api.content.deleteContent);

  const loadMoreContent = async () => {
    if (!effectiveNextCursor || isLoadingMore) {
      return;
    }

    setLoadMoreError(null);
    setIsLoadingMore(true);

    try {
      const page = (await convex.query(api.content.getContent, {
        limit: CONTENT_PAGE_SIZE,
        cursor: effectiveNextCursor,
      })) as ContentPageResponse;

      setExtraContentRows((previous) => mergeContentRows(previous, page.items));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadMoreError(
        error instanceof Error ? error.message : "Failed to load more content.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleDeleteContent = async (row: ContentRow) => {
    if (!window.confirm("Are you sure you want to delete this content?")) {
      return;
    }

    await deleteContent({ slug: row.slug });
    setExtraContentRows((previous) =>
      previous.filter((existing) => existing._id !== row._id),
    );
  };

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Content</h1>
              <p className="text-sm text-gray-500 mt-1">
                All rows from the Convex <code>content</code> table.
              </p>
            </div>

            <Link
              href="/content/create"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Create Content
            </Link>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {contentResponse === undefined && contentRows.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">Loading...</div>
            ) : contentRows.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">No content yet.</div>
            ) : (
              <div className="overflow-auto">
                {loadMoreError && (
                  <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {loadMoreError}
                  </div>
                )}

                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">Slug</th>
                      <th className="text-left font-medium px-4 py-3">Title</th>
                      <th className="text-left font-medium px-4 py-3">
                        Created
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {contentRows.map((row) => (
                      <tr key={row._id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-800">
                          {row.slug}
                        </td>
                        <td className="px-4 py-3 text-gray-900">{row.title}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {new Date(row._creationTime).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/content/edit/${row.slug}`}
                            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => {
                              void handleDeleteContent(row);
                            }}
                            className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 ml-2"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {effectiveNextCursor && (
                  <div className="flex items-center justify-between border-t border-gray-100 p-4">
                    <span className="text-xs text-gray-500">
                      Showing {contentRows.length} items
                    </span>
                    <button
                      onClick={() => {
                        void loadMoreContent();
                      }}
                      disabled={isLoadingMore}
                      className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isLoadingMore ? "Loading more..." : "Load more content"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
