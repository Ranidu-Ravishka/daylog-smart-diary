"use client";

import { useState } from "react";
import type { Id } from "../../../packages/backend/convex/_generated/dataModel";
import { EllipsisVertical, Trash, Edit } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteMemoryDialog } from "./DeleteMemoryDialog";

const MOOD_EMOJI: Record<string, string> = {
  happy: "😊",
  sad: "😢",
  excited: "🎉",
  peaceful: "😌",
  loved: "❤️",
  angry: "😤",
  anxious: "😰",
  neutral: "😐",
};

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
  onEdit?: (memory: MemoryData) => void;
  onDeleteSuccess?: () => void;
}

export function MemoryCard({
  memory,
  onEdit,
  onDeleteSuccess,
}: MemoryCardProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const time = new Date(memory.happenedAt);
  const h = time.getHours();
  const m = String(time.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const fmtH = h % 12 || 12;

  return (
    <>
      <Card className="transition-colors hover:bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-medium">{memory.title}</p>
                <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                  {fmtH}:{m} {ampm}
                </span>
              </div>

              {memory.description && (
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                  {memory.description}
                </p>
              )}

              {memory.mood && (
                <Badge variant="secondary" className="inline-block">
                  {MOOD_EMOJI[memory.mood] ?? "😐"} {memory.mood}
                </Badge>
              )}
            </div>

            {/* Action Menu */}
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowMenu(!showMenu)}
                aria-label="Actions"
              >
                <EllipsisVertical className="h-4 w-4" />
              </Button>

              {showMenu && (
                <div className="absolute right-0 top-full mt-1 bg-background border border-border rounded-md shadow-md z-10">
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start rounded-none px-3 py-2 h-auto text-sm font-normal hover:bg-muted"
                      onClick={() => {
                        onEdit(memory);
                        setShowMenu(false);
                      }}
                    >
                      <Edit className="h-3 w-3 mr-2" />
                      Edit
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start rounded-none px-3 py-2 h-auto text-sm font-normal text-red-500 hover:bg-red-50 hover:text-red-600"
                    onClick={() => {
                      setIsDeleteDialogOpen(true);
                      setShowMenu(false);
                    }}
                  >
                    <Trash className="h-3 w-3 mr-2" />
                    Delete
                  </Button>
                </div>
              )}
            </div>
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
