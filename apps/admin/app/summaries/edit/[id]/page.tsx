"use client";

import AdminGuard from "@/components/admin-guard";
import SummaryForm from "@/components/form/summaryForm";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";

export default function EditSummaryPage() {
  const params = useParams<{ id: string }>();
  const summaryId = params?.id;
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const existing = useQuery(
    api.admin.adminGetSummary,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    summaryId && isAdmin ? { summaryId: summaryId as any } : "skip",
  );
  const updateSummary = useMutation(api.admin.adminUpdateSummary);

  if (!summaryId) {
    return (
      <div className="p-6 text-sm text-red-600">
        Missing summary ID parameter.
      </div>
    );
  }

  if (existing === undefined) {
    return <div className="p-6 text-sm text-gray-600">Loading...</div>;
  }

  return (
    <AdminGuard>
      <SummaryForm
        title="Edit Day Summary"
        description={`Editing summary for: ${existing.dayKey}`}
        ownerLabel={existing.userId}
        initialValues={{
          dayKey: existing.dayKey,
          story: existing.story,
          highlights: existing.highlights,
          sourcesUsed: existing.sourcesUsed,
        }}
        submitLabel="Save Changes"
        successMessage="Summary updated successfully."
        onSubmit={async (values) => {
          await updateSummary({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            summaryId: summaryId as any,
            dayKey: values.dayKey,
            story: values.story,
            highlights: values.highlights,
            sourcesUsed: values.sourcesUsed,
          });
        }}
      />
    </AdminGuard>
  );
}
