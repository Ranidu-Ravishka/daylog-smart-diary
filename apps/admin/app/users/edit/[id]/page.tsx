"use client";

import AdminGuard from "@/components/admin-guard";
import UserForm from "@/components/form/userForm";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";

export default function EditUserPage() {
  const params = useParams<{ id: string }>();
  const userId = params?.id;
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const existing = useQuery(
    api.admin.adminGetUser,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userId && isAdmin ? { userId: userId as any } : "skip",
  );
  const updateUser = useMutation(api.admin.adminUpdateUser);

  if (!userId) {
    return (
      <div className="p-6 text-sm text-red-600">Missing user ID parameter.</div>
    );
  }

  if (existing === undefined) {
    return <div className="p-6 text-sm text-gray-600">Loading...</div>;
  }

  return (
    <AdminGuard>
      <UserForm
        title="Edit User"
        description={`Editing user: ${existing.email}`}
        initialValues={{
          email: existing.email,
          firstName: existing.firstName ?? "",
          lastName: existing.lastName ?? "",
          isAdmin: existing.isAdmin ?? false,
        }}
        submitLabel="Save Changes"
        successMessage="User updated successfully."
        onSubmit={async (values) => {
          await updateUser({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            userId: userId as any,
            email: values.email,
            firstName: values.firstName,
            lastName: values.lastName,
            isAdmin: values.isAdmin,
          });
        }}
      />
    </AdminGuard>
  );
}
