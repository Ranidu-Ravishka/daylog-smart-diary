"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";

export default function UsersPage() {
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const users = useQuery(api.admin.listAllUsers, isAdmin ? {} : "skip");
  const deleteUser = useMutation(api.admin.adminDeleteUser);

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Users</h1>
              <p className="text-sm text-gray-500 mt-1">
                All rows from the <code>user</code> table.
              </p>
            </div>

            <Link
              href="/users/create"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Create User
            </Link>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {users === undefined ? (
              <div className="p-6 text-sm text-gray-600">Loading...</div>
            ) : users.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">No users yet.</div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">User</th>
                      <th className="text-left font-medium px-4 py-3">
                        First Name
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Last Name
                      </th>
                      <th className="text-left font-medium px-4 py-3">Admin</th>
                      <th className="text-left font-medium px-4 py-3">
                        Created
                      </th>
                      <th className="text-left font-medium px-4 py-3">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {users.map((row) => (
                      <tr key={row._id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="text-sm text-gray-900">
                            {row.email}
                          </div>
                          <div className="font-mono text-xs text-gray-500">
                            {row.clerkUserId}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-900">
                          {row.firstName ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-900">
                          {row.lastName ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {row.isAdmin ? "Yes" : "No"}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {new Date(row._creationTime).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/users/edit/${row._id}`}
                            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Are you sure you want to delete this user?",
                                )
                              ) {
                                deleteUser({ userId: row._id });
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
