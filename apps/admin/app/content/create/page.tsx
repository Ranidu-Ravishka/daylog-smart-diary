"use client";

import { useMutation } from "convex/react";
import { api } from "@repo/backend/convex";
import ContentForm from "@/components/form/contentForm";

export default function CreateContent() {
  const writeContent = useMutation(api.content.writeContent);

  return (
    <ContentForm
      title="Create Content"
      description="Add a new content entry to the Convex backend."
      submitLabel="Create Content"
      successMessage="Content created successfully."
      onSubmit={async (values) => {
        await writeContent(values);
      }}
    />
  );
}
