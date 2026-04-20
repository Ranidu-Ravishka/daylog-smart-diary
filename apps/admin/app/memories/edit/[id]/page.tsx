"use client";

import AdminGuard from "@/components/admin-guard";
import MemoryForm from "@/components/form/memoryForm";
import { idQueryArg, toEntityId } from "@/lib/admin-ids";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";

export default function EditMemoryPage() {
  const params = useParams<{ id: string }>();
  const memoryId = params?.id ? toEntityId<"memories">(params.id) : undefined;
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const existing = useQuery(
    api.admin.adminGetMemory,
    idQueryArg(memoryId, isAdmin, "memoryId"),
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

  if (existing === null) {
    return <div className="p-6 text-sm text-red-600">Memory not found.</div>;
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
            memoryId,
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
