"use client";

import AdminGuard from "@/components/admin-guard";
import PreferenceForm from "@/components/form/preferenceForm";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";

export default function CreatePreferencePage() {
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const users = useQuery(api.admin.listAllUsers, isAdmin ? {} : "skip");
  const createPreference = useMutation(api.admin.adminCreateUserPreference);

  const [selectedClerkUserId, setSelectedClerkUserId] = useState("");

  return (
    <AdminGuard>
      <div className="max-w-2xl mx-auto py-10 px-6">
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Owner (User)
          </label>
          <select
            value={selectedClerkUserId}
            onChange={(e) => setSelectedClerkUserId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Select a user…</option>
            {users?.map((u) => (
              <option key={u._id} value={u.clerkUserId}>
                {u.email} ({u.clerkUserId})
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Required. The user whose preferences are being created.
          </p>
        </div>

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
