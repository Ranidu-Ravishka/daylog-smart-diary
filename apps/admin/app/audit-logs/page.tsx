"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useQuery } from "convex/react";

export default function AuditLogsPage() {
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const logs = useQuery(
    api.admin.listAuditLogs,
    isAdmin ? { limit: 200 } : "skip",
  );

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Audit Logs
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Recent entries from the <code>auditLogs</code> table
                (read-only).
              </p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {logs === undefined ? (
              <div className="p-6 text-sm text-gray-600">Loading...</div>
            ) : logs.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">
                No audit logs yet.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">
                        Action
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Target
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Actor (User ID)
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Timestamp
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {logs.map((row) => (
                      <tr key={row._id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900">
                          {row.action}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {row.target ?? "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-800">
                          {row.actorUserId}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {new Date(row.at).toLocaleString()}
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
