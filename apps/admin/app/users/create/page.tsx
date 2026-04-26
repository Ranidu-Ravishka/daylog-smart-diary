"use client";

import AdminGuard from "@/components/admin-guard";
import UserForm from "@/components/form/userForm";
import { api } from "@repo/backend/convex";
import { useMutation } from "convex/react";
import { useState } from "react";

export default function CreateUserPage() {
  const createUser = useMutation(api.admin.adminCreateUser);
  const [clerkUserId, setClerkUserId] = useState("");

  return (
    <AdminGuard>
      <div className="max-w-2xl mx-auto py-10 px-6">
        <div className="mb-6">
          <label className="block text-sm font-medium text-foreground mb-1">
            Clerk User ID
          </label>
          <input
            type="text"
            value={clerkUserId}
            onChange={(e) => setClerkUserId(e.target.value)}
            placeholder="e.g. user_2abc123..."
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring "
          />
          <p className="text-xs text-muted-foreground mt-1">
            Required. The Clerk user identifier to associate with this user
            record.
          </p>
        </div>

        <UserForm
          title="Create User"
          description="Add a new user record to the database."
          submitLabel="Create User"
          successMessage="User created successfully."
          onSubmit={async (values) => {
            if (!clerkUserId.trim()) {
              throw new Error("Clerk User ID is required");
            }
            await createUser({
              clerkUserId: clerkUserId.trim(),
              email: values.email,
              firstName: values.firstName || undefined,
              lastName: values.lastName || undefined,
              isAdmin: values.isAdmin,
            });
          }}
        />
      </div>
    </AdminGuard>
  );
}
