"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@repo/backend/convex";
import type { Id } from "@repo/backend";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/lib/toast";

interface DeleteMemoryDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  memoryId: Id<"memories">;
  memoryTitle: string;
  onDeleteSuccess?: () => void;
}

export function DeleteMemoryDialog({
  isOpen,
  onOpenChange,
  memoryId,
  memoryTitle,
  onDeleteSuccess,
}: DeleteMemoryDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteMemory = useMutation(api.memories.deleteMemory);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteMemory({ memoryId });
      toastSuccess("Memory deleted");
      onOpenChange(false);
      onDeleteSuccess?.();
    } catch (error) {
      toastError("Failed to delete memory");
      console.error("Delete error:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Memory</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &quot;{memoryTitle}&quot;? This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
