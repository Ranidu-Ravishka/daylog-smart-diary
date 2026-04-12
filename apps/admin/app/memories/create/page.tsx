"use client";

import AdminGuard from "@/components/admin-guard";
import MemoryForm from "@/components/form/memoryForm";
import UserOwnerSelector from "@/components/user-owner-selector";
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
  const createMemory = useMutation(api.admin.adminCreateMemory);

  const [selectedUserId, setSelectedUserId] = useState<UserId | "">("");

  return (
    <AdminGuard>
      <div className="max-w-2xl mx-auto py-10 px-6">
        <UserOwnerSelector
          isAdmin={isAdmin}
          value={selectedUserId}
          onChange={(nextValue) =>
            setSelectedUserId(nextValue ? toEntityId<"user">(nextValue) : "")
          }
          valueMode="userId"
          helperText="Required. The user who owns this memory."
        />

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
