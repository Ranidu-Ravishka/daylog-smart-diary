"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";

export default function IntegrationsPage() {
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const integrations = useQuery(
    api.admin.listAllIntegrations,
    isAdmin ? {} : "skip",
  );
  const deleteIntegration = useMutation(api.admin.adminDeleteIntegration);

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Integrations
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                All rows from the <code>integrations</code> table.
              </p>
            </div>

            <Link
              href="/integrations/create"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Create Integration
            </Link>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {integrations === undefined ? (
              <div className="p-6 text-sm text-gray-600">Loading...</div>
            ) : integrations.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">
                No integrations yet.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">
                        Provider
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Status
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Scopes
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Last Sync
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {integrations.map((row) => (
                      <tr key={row._id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900">
                          {row.provider}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              row.status === "connected"
                                ? "bg-green-100 text-green-700"
                                : row.status === "error"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          {row.scopes?.join(", ") ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {row.lastSyncAt
                            ? new Date(row.lastSyncAt).toLocaleString()
                            : "Never"}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/integrations/edit/${row._id}`}
                            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Are you sure you want to delete this integration?",
                                )
                              ) {
                                deleteIntegration({
                                  integrationId: row._id,
                                });
                              }
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
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
