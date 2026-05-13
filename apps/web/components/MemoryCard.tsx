"use client";

import { useState } from "react";
import Image from "next/image";
import type { Id } from "@repo/backend";
import { EllipsisVertical, Trash, Edit } from "lucide-react";
import { MOOD_EMOJI, MOOD_LABELS } from "@repo/ui/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteMemoryDialog } from "./DeleteMemoryDialog";

export interface MemoryData {
  _id: Id<"memories">;
  title: string;
  description?: string;
  mood?: string;
  happenedAt: number;
  dayKey: string;
}

interface MemoryCardProps {
  memory: MemoryData;
  thumbnailUrl?: string | null;
  onEdit?: (memory: MemoryData) => void;
  onDeleteSuccess?: () => void;
}

export function MemoryCard({
  memory,
  thumbnailUrl,
  onEdit,
  onDeleteSuccess,
}: MemoryCardProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const time = new Date(memory.happenedAt);
  const h = time.getHours();
  const m = String(time.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const fmtH = h % 12 || 12;

  return (
    <>
      <Card className="transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-px hover:border-border hover:shadow-soft">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{memory.title}</p>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  {fmtH}:{m} {ampm}
                </span>
              </div>

              {memory.description && (
                <p className="mb-2 text-sm leading-relaxed text-muted-foreground">
                  {memory.description}
                </p>
              )}

              {memory.mood && (
                <Badge variant="secondary" className="inline-block">
                  {MOOD_EMOJI[memory.mood] ?? "😐"}{" "}
                  {MOOD_LABELS[memory.mood] ?? memory.mood}
                </Badge>
              )}

              {thumbnailUrl ? (
                <div className="mt-3">
                  <Image
                    src={thumbnailUrl}
                    alt={`${memory.title} media`}
                    width={220}
                    height={120}
                    className="h-24 w-auto rounded-md border object-cover"
                    unoptimized
                  />
                </div>
              ) : null}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label="Memory actions"
                >
                  <EllipsisVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[9.5rem]">
                {onEdit ? (
                  <DropdownMenuItem
                    className="gap-2"
                    onSelect={() => {
                      onEdit(memory);
                    }}
                  >
                    <Edit className="h-3.5 w-3.5" />
                    Edit
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive dark:focus:bg-destructive/20 dark:data-highlighted:bg-destructive/20"
                  onSelect={() => setIsDeleteDialogOpen(true)}
                >
                  <Trash className="h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      <DeleteMemoryDialog
        isOpen={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        memoryId={memory._id}
        memoryTitle={memory.title}
        onDeleteSuccess={onDeleteSuccess}
      />
    </>
  );
}
