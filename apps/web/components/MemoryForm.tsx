"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@repo/backend/convex";
import type { Id } from "../../../packages/backend/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastError, toastSuccess } from "@/lib/toast";

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

const MOODS = Object.keys(MOOD_EMOJI);

interface MemoryFormProps {
  dayKey: string;
  memoryId?: Id<"memories">;
  initialData?: {
    title: string;
    description?: string;
    mood?: string;
    happenedAt: number;
  };
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function MemoryForm({
  dayKey,
  memoryId,
  initialData,
  onSuccess,
  onCancel,
}: MemoryFormProps) {
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [description, setDescription] = useState(
    initialData?.description ?? "",
  );
  const [mood, setMood] = useState(initialData?.mood ?? "neutral");
  const [time, setTime] = useState(() => {
    if (initialData?.happenedAt) {
      const date = new Date(initialData.happenedAt);
      const h = String(date.getHours()).padStart(2, "0");
      const m = String(date.getMinutes()).padStart(2, "0");
      return `${h}:${m}`;
    }
    const now = new Date();
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMemory = useMutation(api.memories.createMemory);
  const updateMemory = useMutation(api.memories.updateMemory);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!title.trim()) {
      newErrors.title = "Title is required";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setIsLoading(true);
    try {
      // Parse time to get timestamp for the selected day
      const timeParts = time.split(":").map(Number);
      const dateParts = dayKey.split("-").map(Number);

      const hours = timeParts[0] ?? 0;
      const minutes = timeParts[1] ?? 0;
      const year = dateParts[0] ?? new Date().getFullYear();
      const month = dateParts[1] ?? 1;
      const day = dateParts[2] ?? 1;

      if (
        isNaN(hours) ||
        isNaN(minutes) ||
        isNaN(year) ||
        isNaN(month) ||
        isNaN(day)
      ) {
        toastError("Invalid date or time format");
        return;
      }

      const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
      const happenedAt = date.getTime();

      if (memoryId) {
        // Edit mode
        await updateMemory({
          memoryId,
          title: title.trim(),
          description: description.trim() || undefined,
          mood: mood !== "neutral" ? mood : undefined,
          happenedAt,
          dayKey,
        });
        toastSuccess("Memory updated");
      } else {
        // Create mode
        await createMemory({
          title: title.trim(),
          description: description.trim() || undefined,
          mood: mood !== "neutral" ? mood : undefined,
          happenedAt,
          dayKey,
        });
        toastSuccess("Memory created");
        // Reset form
        setTitle("");
        setDescription("");
        setMood("neutral");
        const now = new Date();
        const h = String(now.getHours()).padStart(2, "0");
        const m = String(now.getMinutes()).padStart(2, "0");
        setTime(`${h}:${m}`);
      }

      onSuccess?.();
    } catch (error) {
      toastError(
        memoryId ? "Failed to update memory" : "Failed to create memory",
      );
      console.error("Memory operation error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>{memoryId ? "Edit Memory" : "Create Memory"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="What happened?"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) {
                  setErrors({ ...errors, title: "" });
                }
              }}
              disabled={isLoading}
              className={errors.title ? "border-red-500" : ""}
            />
            {errors.title && (
              <p className="text-sm text-red-500">{errors.title}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <textarea
              id="description"
              placeholder="Add more details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-24"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Mood */}
            <div className="space-y-2">
              <Label htmlFor="mood">Mood</Label>
              <Select value={mood} onValueChange={setMood} disabled={isLoading}>
                <SelectTrigger id="mood">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {MOOD_EMOJI[m]} {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Time */}
            <div className="space-y-2">
              <Label htmlFor="time">Time</Label>
              <Input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : memoryId ? "Update" : "Create"}
            </Button>
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isLoading}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
