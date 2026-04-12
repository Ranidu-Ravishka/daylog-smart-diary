"use client";

import AdminGuard from "@/components/admin-guard";
import IntegrationForm from "@/components/form/integrationForm";
import UserOwnerSelector from "@/components/user-owner-selector";
import { toEntityId, type UserId } from "@/lib/admin-ids";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";

export default function CreateIntegrationPage() {
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const createIntegration = useMutation(api.admin.adminCreateIntegration);

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
          helperText="Required. The user who owns this integration."
        />

        <IntegrationForm
          title="Create Integration"
          description="Add a new integration record to the database."
          ownerLabel={selectedUserId || undefined}
          submitLabel="Create Integration"
          successMessage="Integration created successfully."
          onSubmit={async (values) => {
            if (!selectedUserId) {
              throw new Error("Please select an owner user");
            }
            await createIntegration({
              userId: selectedUserId,
              provider: values.provider,
              status: values.status,
              scopes: values.scopes.length > 0 ? values.scopes : undefined,
              tokenRef: values.tokenRef || undefined,
            });
          }}
        />
      </div>
    </AdminGuard>
  );
}
