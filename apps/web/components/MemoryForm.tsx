"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { makeFunctionReference } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { api } from "@repo/backend/convex";
import { MOOD_OPTIONS } from "@repo/ui/lib/constants";
import type { Id } from "@repo/backend";
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
import { captureException, logInfo } from "@/lib/observability";
import { toastError, toastSuccess } from "@/lib/toast";

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const DEFAULT_MAX_MEDIA_PER_MEMORY = 8;
const DEFAULT_MAX_MEDIA_BYTES_PER_FILE = 10 * 1024 * 1024;

const myMemoryPlanLimitsRef = makeFunctionReference<"query">(
  "memories:getMyMemoryPlanLimits",
);

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)}KB`;
  }

  const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  return `${mb}MB`;
}

type SelectedMediaFile = {
  id: string;
  file: File;
  previewUrl: string;
  uploading: boolean;
  error: boolean;
};

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
  const [selectedFiles, setSelectedFiles] = useState<SelectedMediaFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlsRef = useRef<Set<string>>(new Set());

  const createMemory = useMutation(api.memories.createMemory);
  const updateMemory = useMutation(api.memories.updateMemory);
  const createUploadUrl = useMutation(
    api.memories.generateMemoryMediaUploadUrl,
  );
  const addMemoryMedia = useMutation(api.memories.addMemoryMedia);
  const memoryPlanLimits = useQuery(myMemoryPlanLimitsRef, {}) as
    | {
        planTier: string;
        maxMediaPerMemory: number;
        maxMediaBytesPerFile: number;
      }
    | undefined;

  const maxMediaPerMemory =
    memoryPlanLimits?.maxMediaPerMemory ?? DEFAULT_MAX_MEDIA_PER_MEMORY;
  const maxMediaBytesPerFile =
    memoryPlanLimits?.maxMediaBytesPerFile ?? DEFAULT_MAX_MEDIA_BYTES_PER_FILE;

  useEffect(() => {
    const previewUrls = previewUrlsRef.current;

    return () => {
      for (const previewUrl of previewUrls) {
        URL.revokeObjectURL(previewUrl);
      }
      previewUrls.clear();
    };
  }, []);

  const selectedFileCount = useMemo(
    () => selectedFiles.length,
    [selectedFiles],
  );

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!title.trim()) {
      newErrors.title = "Title is required";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const accepted: SelectedMediaFile[] = [];
    let skippedUnsupported = 0;
    let skippedOversize = 0;
    let skippedPlanLimit = 0;
    const remainingSlots = Math.max(
      maxMediaPerMemory - selectedFiles.length,
      0,
    );

    for (const file of files) {
      if (accepted.length >= remainingSlots) {
        skippedPlanLimit += 1;
        continue;
      }

      if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
        skippedUnsupported += 1;
        continue;
      }

      if (file.size > maxMediaBytesPerFile) {
        skippedOversize += 1;
        continue;
      }

      accepted.push({
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        uploading: false,
        error: false,
      });

      previewUrlsRef.current.add(accepted[accepted.length - 1]!.previewUrl);
    }

    if (accepted.length > 0) {
      setSelectedFiles((prev) => [...prev, ...accepted]);
    }

    if (skippedUnsupported > 0) {
      toastError(
        `${skippedUnsupported} file(s) skipped. Supported types: JPG, PNG, WEBP, GIF, HEIC/HEIF.`,
      );
    }

    if (skippedOversize > 0) {
      toastError(
        `${skippedOversize} file(s) skipped. Max size is ${formatFileSize(maxMediaBytesPerFile)} per file on your current plan.`,
      );
    }

    if (skippedPlanLimit > 0) {
      toastError(
        `${skippedPlanLimit} file(s) skipped. Your current plan allows up to ${maxMediaPerMemory} media file(s) per memory.`,
      );
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeSelectedFile = (fileId: string) => {
    setSelectedFiles((prev) => {
      const target = prev.find((file) => file.id === fileId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((file) => file.id !== fileId);
    });
  };

  const uploadFileToConvex = async (
    file: File,
    memoryId: Id<"memories">,
  ): Promise<boolean> => {
    try {
      const { uploadUrl } = await createUploadUrl({});
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`);
      }

      const uploadResult = (await uploadResponse.json()) as {
        storageId?: string;
      };

      if (!uploadResult.storageId) {
        throw new Error("Upload succeeded but no storageId was returned");
      }

      await addMemoryMedia({
        memoryId,
        storageId: uploadResult.storageId,
        type: "image",
      });

      return true;
    } catch (error) {
      captureException("web_memory_image_upload_failed", error, {
        memoryId,
        fileName: file.name,
      });
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    const mode = memoryId ? "edit" : "create";
    logInfo("web_memory_submit_started", {
      status: "started",
      dayKey,
      mode,
      selectedImageCount: selectedFiles.length,
    });

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
      let targetMemoryId: Id<"memories">;
      let failedUploads = 0;

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
        targetMemoryId = memoryId;
        toastSuccess("Memory updated");
      } else {
        // Create mode
        const createdMemory = await createMemory({
          title: title.trim(),
          description: description.trim() || undefined,
          mood: mood !== "neutral" ? mood : undefined,
          happenedAt,
          dayKey,
        });

        if (!createdMemory?._id) {
          throw new Error("Memory created without id");
        }

        targetMemoryId = createdMemory._id;

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

      if (selectedFiles.length > 0) {
        for (let index = 0; index < selectedFiles.length; index++) {
          const selectedFile = selectedFiles[index];
          if (!selectedFile) continue;

          setSelectedFiles((prev) =>
            prev.map((item) =>
              item.id === selectedFile.id
                ? { ...item, uploading: true, error: false }
                : item,
            ),
          );

          const success = await uploadFileToConvex(
            selectedFile.file,
            targetMemoryId,
          );

          if (!success) {
            failedUploads += 1;
          }

          setSelectedFiles((prev) =>
            prev.map((item) =>
              item.id === selectedFile.id
                ? { ...item, uploading: false, error: !success }
                : item,
            ),
          );
        }

        if (failedUploads > 0) {
          toastError(
            `${failedUploads} media file(s) failed to upload. You can retry by editing the memory.`,
          );
        } else {
          toastSuccess("Media uploaded");
          for (const selectedFile of selectedFiles) {
            URL.revokeObjectURL(selectedFile.previewUrl);
            previewUrlsRef.current.delete(selectedFile.previewUrl);
          }
          setSelectedFiles([]);
        }
      }

      logInfo("web_memory_submit_succeeded", {
        status: "succeeded",
        dayKey,
        mode,
        memoryId: targetMemoryId,
        selectedImageCount: selectedFiles.length,
        failedUploads,
      });

      onSuccess?.();
    } catch (error) {
      toastError(
        memoryId ? "Failed to update memory" : "Failed to create memory",
      );
      captureException("web_memory_submit_failed", error, {
        status: "failed",
        mode,
        dayKey,
        selectedImageCount: selectedFiles.length,
      });
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

          {/* Media */}
          <div className="space-y-2">
            <Label htmlFor="media">Photos (optional)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="media"
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
                multiple
                onChange={handleFileSelect}
                disabled={isLoading}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Plan limits: up to {maxMediaPerMemory} file(s) per memory, max{" "}
              {formatFileSize(maxMediaBytesPerFile)} per file.
            </p>
            {selectedFileCount > 0 && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {selectedFiles.map((selectedFile) => (
                  <div
                    key={selectedFile.id}
                    className="relative rounded-md border bg-muted/20 p-1"
                  >
                    <Image
                      src={selectedFile.previewUrl}
                      alt={selectedFile.file.name}
                      width={160}
                      height={80}
                      className="h-20 w-full rounded object-cover"
                      unoptimized
                    />
                    {!isLoading && !selectedFile.uploading && (
                      <button
                        type="button"
                        aria-label="Remove selected file"
                        className="absolute right-1 top-1 rounded bg-black/60 px-1 text-xs text-white"
                        onClick={() => removeSelectedFile(selectedFile.id)}
                      >
                        ×
                      </button>
                    )}
                    <div className="mt-1 text-[10px] text-muted-foreground truncate">
                      {selectedFile.file.name}
                    </div>
                    {selectedFile.uploading && (
                      <div className="text-[10px] text-muted-foreground">
                        Uploading...
                      </div>
                    )}
                    {selectedFile.error && (
                      <div className="text-[10px] text-destructive">
                        Upload failed
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
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
                  {MOOD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.emoji} {option.label}
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
