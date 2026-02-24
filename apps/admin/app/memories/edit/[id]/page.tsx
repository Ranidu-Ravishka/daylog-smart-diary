"use client";

import AdminGuard from "@/components/admin-guard";
import MemoryForm from "@/components/form/memoryForm";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";

export default function EditMemoryPage() {
  const params = useParams<{ id: string }>();
  const memoryId = params?.id;
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const existing = useQuery(
    api.admin.adminGetMemory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    memoryId && isAdmin ? { memoryId: memoryId as any } : "skip",
  );
  const updateMemory = useMutation(api.admin.adminUpdateMemory);

  if (!memoryId) {
    return (
      <div className="p-6 text-sm text-red-600">
        Missing memory ID parameter.
      </div>
    );
  }

  if (existing === undefined) {
    return <div className="p-6 text-sm text-gray-600">Loading...</div>;
  }

  return (
    <AdminGuard>
      <MemoryForm
        title="Edit Memory"
        description={`Editing: ${existing.title}`}
        ownerLabel={existing.userId}
        initialValues={{
          title: existing.title,
          description: existing.description ?? "",
          mood: existing.mood ?? "",
          happenedAt: existing.happenedAt,
          dayKey: existing.dayKey,
        }}
        submitLabel="Save Changes"
        successMessage="Memory updated successfully."
        onSubmit={async (values) => {
          await updateMemory({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            memoryId: memoryId as any,
            title: values.title,
            description: values.description,
            mood: values.mood,
            happenedAt: values.happenedAt,
            dayKey: values.dayKey,
          });
        }}
      />
    </AdminGuard>
  );
}
