"use client";

import AdminGuard from "@/components/admin-guard";
import ContentForm from "@/components/form/contentForm";
import { api } from "@repo/backend/convex";
import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import React from "react";

export default function EditContentPage() {
  const params = useParams<{ slug?: string | string[] }>();
  const slugParam = params?.slug;
  const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam;

  const existing = useQuery(
    api.content.getContentBySlug,
    slug ? { slug } : "skip",
  );
  const updateContent = useMutation(api.content.updateContent);

  if (!slug) {
    return (
      <div className="p-6 text-sm text-foreground ">
        Missing slug parameter.
      </div>
    );
  }

  if (existing === undefined) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <AdminGuard>
      <ContentForm
        title="Edit Content"
        description={`Editing: ${slug}`}
        initialValues={{
          slug: existing.slug,
          title: existing.title,
          body: existing.body,
        }}
        slugDisabled
        submitLabel="Save Changes"
        successMessage="Content updated successfully."
        onSubmit={async (values) => {
          await updateContent({
            slug,
            title: values.title,
            body: values.body,
          });
        }}
      />
    </AdminGuard>
  );
}
