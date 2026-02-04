"use client";

import { api } from "@repo/backend/convex";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";

export default function ContentPage() {
  const content = useQuery(api.content.getContent, {});
  const deleteContent = useMutation(api.content.deleteContent);

  return (
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
          {content === undefined ? (
            <div className="p-6 text-sm text-gray-600">Loading...</div>
          ) : content.length === 0 ? (
            <div className="p-6 text-sm text-gray-600">No content yet.</div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Slug</th>
                    <th className="text-left font-medium px-4 py-3">Title</th>
                    <th className="text-left font-medium px-4 py-3">Created</th>
                    <th className="text-left font-medium px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {content.map((row) => (
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
                          onClick={() => deleteContent({ slug: row.slug })}
                          className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 ml-2"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
