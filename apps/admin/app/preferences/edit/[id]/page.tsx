"use client";

import AdminGuard from "@/components/admin-guard";
import PreferenceForm from "@/components/form/preferenceForm";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";

export default function EditPreferencePage() {
  const params = useParams<{ id: string }>();
  const preferenceId = params?.id;
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const existing = useQuery(
    api.admin.adminGetUserPreference,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    preferenceId && isAdmin ? { preferenceId: preferenceId as any } : "skip",
  );
  const updatePreference = useMutation(api.admin.adminUpdateUserPreference);

  if (!preferenceId) {
    return (
      <div className="p-6 text-sm text-red-600">
        Missing preference ID parameter.
      </div>
    );
  }

  if (existing === undefined) {
    return <div className="p-6 text-sm text-gray-600">Loading...</div>;
  }

  return (
    <AdminGuard>
      <PreferenceForm
        title="Edit User Preference"
        description={`Editing preferences for: ${existing.clerkUserId}`}
        ownerLabel={existing.clerkUserId}
        initialValues={{
          focusAreas: existing.focusAreas,
          reminderType: existing.reminderType,
          dailyTime: existing.dailyTime,
          weeklyDay: existing.weeklyDay,
          formattedTime: existing.formattedTime,
        }}
        submitLabel="Save Changes"
        successMessage="Preferences updated successfully."
        onSubmit={async (values) => {
          await updatePreference({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            preferenceId: preferenceId as any,
            focusAreas: values.focusAreas,
            reminderType: values.reminderType,
            dailyTime: values.dailyTime,
            weeklyDay: values.weeklyDay,
            formattedTime: values.formattedTime,
          });
        }}
      />
    </AdminGuard>
  );
}
