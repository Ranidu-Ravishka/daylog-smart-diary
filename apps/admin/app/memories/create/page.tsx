"use client";

import AdminGuard from "@/components/admin-guard";
import MemoryForm from "@/components/form/memoryForm";
import { toEntityId, type UserId } from "@/lib/admin-ids";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";

export default function CreateMemoryPage() {
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const users = useQuery(api.admin.listAllUsers, isAdmin ? {} : "skip");
  const createMemory = useMutation(api.admin.adminCreateMemory);

  const [selectedUserId, setSelectedUserId] = useState<UserId | "">("");

  return (
    <AdminGuard>
      <div className="max-w-2xl mx-auto py-10 px-6">
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Owner (User)
          </label>
          <select
            value={selectedUserId}
            onChange={(e) =>
              setSelectedUserId(
                e.target.value ? toEntityId<"user">(e.target.value) : "",
              )
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Select a user…</option>
            {users?.map((u) => (
              <option key={u._id} value={u._id}>
                {u.email} ({u._id})
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Required. The user who owns this memory.
          </p>
        </div>

        <MemoryForm
          title="Create Memory"
          description="Add a new memory record to the database."
          ownerLabel={selectedUserId || undefined}
          submitLabel="Create Memory"
          successMessage="Memory created successfully."
          onSubmit={async (values) => {
            if (!selectedUserId) {
              throw new Error("Please select an owner user");
            }
            await createMemory({
              userId: selectedUserId,
              title: values.title,
              description: values.description || undefined,
              mood: values.mood || undefined,
              happenedAt: values.happenedAt,
              dayKey: values.dayKey,
            });
          }}
        />
      </div>
    </AdminGuard>
  );
}
