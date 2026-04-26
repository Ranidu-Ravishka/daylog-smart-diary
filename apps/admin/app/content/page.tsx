"use client";

import AdminGuard from "@/components/admin-guard";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@repo/backend/convex";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { ColumnDef } from "@tanstack/react-table";
import { FileText } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

const CONTENT_PAGE_SIZE = 50;

type ContentRow = {
  _id: string;
  _creationTime: number;
  slug: string;
  title: string;
};

type ContentPageResponse = {
  items: ContentRow[];
  nextCursor: string | null;
};

function mergeContentRows(
  primary: ContentRow[],
  secondary: ContentRow[],
): ContentRow[] {
  const seen = new Set<string>();
  const merged: ContentRow[] = [];

  for (const row of [...primary, ...secondary]) {
    if (seen.has(row._id)) {
      continue;
    }

    seen.add(row._id);
    merged.push(row);
  }

  return merged;
}

export default function ContentPage() {
  const convex = useConvex();
  const [extraContentRows, setExtraContentRows] = useState<ContentRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const contentResponse = useQuery(api.content.getContent, {
    limit: CONTENT_PAGE_SIZE,
  }) as ContentPageResponse | undefined;

  const contentRows = useMemo(
    () => mergeContentRows(contentResponse?.items ?? [], extraContentRows),
    [contentResponse?.items, extraContentRows],
  );

  const effectiveNextCursor = nextCursor ?? contentResponse?.nextCursor ?? null;

  const deleteContent = useMutation(api.content.deleteContent);

  const loadMoreContent = async () => {
    if (!effectiveNextCursor || isLoadingMore) {
      return;
    }

    setLoadMoreError(null);
    setIsLoadingMore(true);

    try {
      const page = (await convex.query(api.content.getContent, {
        limit: CONTENT_PAGE_SIZE,
        cursor: effectiveNextCursor,
      })) as ContentPageResponse;

      setExtraContentRows((previous) => mergeContentRows(previous, page.items));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadMoreError(
        error instanceof Error ? error.message : "Failed to load more content.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleDeleteContent = useCallback(
    async (row: ContentRow) => {
      if (!window.confirm("Are you sure you want to delete this content?")) {
        return;
      }

      await deleteContent({ slug: row.slug });
      setExtraContentRows((previous) =>
        previous.filter((existing) => existing._id !== row._id),
      );
    },
    [deleteContent],
  );

  const columns = useMemo<ColumnDef<ContentRow>[]>(
    () => [
      {
        accessorKey: "slug",
        header: "Slug",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-foreground ">
            {row.original.slug}
          </span>
        ),
      },
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => (
          <span className="text-foreground ">{row.original.title}</span>
        ),
      },
      {
        accessorKey: "_creationTime",
        header: "Created",
        cell: ({ row }) => (
          <span className="text-muted-foreground ">
            {new Date(row.original._creationTime).toLocaleString()}
          </span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" asChild>
              <Link href={`/content/edit/${row.original.slug}`}>Edit</Link>
            </Button>
            <Button
              type="button"
              variant="outlineDestructive"
              size="sm"
              onClick={() => {
                void handleDeleteContent(row.original);
              }}
            >
              Delete
            </Button>
          </div>
        ),
      },
    ],
    [handleDeleteContent],
  );

  const loadingInitial =
    contentResponse === undefined && contentRows.length === 0;

  return (
    <AdminGuard>
      <PageContainer
        title="Content"
        description={
          <>
            All rows from the Convex{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs ">
              content
            </code>{" "}
            table.
          </>
        }
        action={
          <Button variant="primary" asChild>
            <Link href="/content/create">Create content</Link>
          </Button>
        }
      >
        {loadingInitial ? (
          <Skeleton className="h-48 w-full rounded-2xl" />
        ) : contentRows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No content yet"
            description="Create your first content entry to see it listed here."
            action={
              <Button variant="primary" asChild>
                <Link href="/content/create">Create content</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            {loadMoreError ? (
              <div className="rounded-xl border border-border bg-muted px-4 py-3 text-sm text-foreground ">
                {loadMoreError}
              </div>
            ) : null}
            <DataTable columns={columns} data={contentRows} />
            {effectiveNextCursor ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3  ">
                <span className="text-xs text-muted-foreground ">
                  Showing {contentRows.length} items
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isLoadingMore}
                  onClick={() => void loadMoreContent()}
                >
                  {isLoadingMore ? "Loading more…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </PageContainer>
    </AdminGuard>
  );
}
