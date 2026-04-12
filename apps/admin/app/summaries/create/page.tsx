"use client";

import AdminGuard from "@/components/admin-guard";
import SummaryForm from "@/components/form/summaryForm";
import UserOwnerSelector from "@/components/user-owner-selector";
import { toEntityId, type UserId } from "@/lib/admin-ids";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";

export default function CreateSummaryPage() {
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const createSummary = useMutation(api.admin.adminCreateSummary);

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
          helperText="Required. The user who owns this day summary."
        />

        <SummaryForm
          title="Create Day Summary"
          description="Add a new day summary record to the database."
          ownerLabel={selectedUserId || undefined}
          submitLabel="Create Summary"
          successMessage="Day summary created successfully."
          onSubmit={async (values) => {
            if (!selectedUserId) {
              throw new Error("Please select an owner user");
            }
            await createSummary({
              userId: selectedUserId,
              dayKey: values.dayKey,
              story: values.story,
              highlights: values.highlights,
              sourcesUsed: values.sourcesUsed,
            });
          }}
        />
      </div>
    </AdminGuard>
  );
}
