"use client";

import AdminGuard from "@/components/admin-guard";
import DayForm from "@/components/form/dayForm";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";

export default function EditDayPage() {
  const params = useParams<{ id: string }>();
  const dayId = params?.id;
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const existing = useQuery(
    api.admin.adminGetDay,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dayId && isAdmin ? { dayId: dayId as any } : "skip",
  );
  const updateDay = useMutation(api.admin.adminUpdateDay);

  if (!dayId) {
    return (
      <div className="p-6 text-sm text-red-600">Missing day ID parameter.</div>
    );
  }

  if (existing === undefined) {
    return <div className="p-6 text-sm text-gray-600">Loading...</div>;
  }

  return (
    <AdminGuard>
      <DayForm
        title="Edit Day"
        description={`Editing day: ${existing.dayKey}`}
        ownerLabel={existing.userId}
        initialValues={{
          dayKey: existing.dayKey,
          rating: existing.rating,
          manualNotes: existing.manualNotes ?? [],
          peopleTags: existing.peopleTags ?? [],
        }}
        submitLabel="Save Changes"
        successMessage="Day updated successfully."
        onSubmit={async (values) => {
          await updateDay({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            dayId: dayId as any,
            dayKey: values.dayKey,
            rating: values.rating,
            manualNotes: values.manualNotes,
            peopleTags: values.peopleTags,
          });
        }}
      />
    </AdminGuard>
  );
}
