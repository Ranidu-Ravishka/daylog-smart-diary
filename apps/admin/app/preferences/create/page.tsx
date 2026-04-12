"use client";

import AdminGuard from "@/components/admin-guard";
import PreferenceForm from "@/components/form/preferenceForm";
import UserOwnerSelector from "@/components/user-owner-selector";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";

export default function CreatePreferencePage() {
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const createPreference = useMutation(api.admin.adminCreateUserPreference);

  const [selectedClerkUserId, setSelectedClerkUserId] = useState("");

  return (
    <AdminGuard>
      <div className="max-w-2xl mx-auto py-10 px-6">
        <UserOwnerSelector
          isAdmin={isAdmin}
          value={selectedClerkUserId}
          onChange={setSelectedClerkUserId}
          valueMode="clerkUserId"
          helperText="Required. The user whose preferences are being created."
        />

        <PreferenceForm
          title="Create User Preference"
          description="Add a new user preference record to the database."
          ownerLabel={selectedClerkUserId || undefined}
          submitLabel="Create Preference"
          successMessage="User preference created successfully."
          onSubmit={async (values) => {
            if (!selectedClerkUserId) {
              throw new Error("Please select an owner user");
            }
            await createPreference({
              clerkUserId: selectedClerkUserId,
              focusAreas: values.focusAreas,
              reminderType: values.reminderType,
              dailyTime: values.dailyTime,
              weeklyDay: values.weeklyDay,
              formattedTime: values.formattedTime,
            });
          }}
        />
      </div>
    </AdminGuard>
  );
}
