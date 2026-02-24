"use client";

import AdminGuard from "@/components/admin-guard";
import IntegrationForm from "@/components/form/integrationForm";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";

export default function EditIntegrationPage() {
  const params = useParams<{ id: string }>();
  const integrationId = params?.id;
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const existing = useQuery(
    api.admin.adminGetIntegration,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    integrationId && isAdmin ? { integrationId: integrationId as any } : "skip",
  );
  const updateIntegration = useMutation(api.admin.adminUpdateIntegration);

  if (!integrationId) {
    return (
      <div className="p-6 text-sm text-red-600">
        Missing integration ID parameter.
      </div>
    );
  }

  if (existing === undefined) {
    return <div className="p-6 text-sm text-gray-600">Loading...</div>;
  }

  return (
    <AdminGuard>
      <IntegrationForm
        title="Edit Integration"
        description={`Editing: ${existing.provider}`}
        ownerLabel={existing.userId}
        initialValues={{
          provider: existing.provider,
          status: existing.status,
          scopes: existing.scopes ?? [],
          tokenRef: existing.tokenRef ?? "",
        }}
        submitLabel="Save Changes"
        successMessage="Integration updated successfully."
        onSubmit={async (values) => {
          await updateIntegration({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            integrationId: integrationId as any,
            provider: values.provider,
            status: values.status,
            scopes: values.scopes,
            tokenRef: values.tokenRef,
          });
        }}
      />
    </AdminGuard>
  );
}
