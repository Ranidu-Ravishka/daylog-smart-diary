"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@repo/backend/convex";
import { Star } from "lucide-react";
import { captureException } from "@/lib/observability";
import { toastError, toastSuccess } from "@/lib/toast";

interface DayRatingProps {
  dayKey: string;
  initialRating: number | null;
  onRatingChange?: (newRating: number) => void;
}

export function DayRating({
  dayKey,
  initialRating,
  onRatingChange,
}: DayRatingProps) {
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const updateDayRating = useMutation(api.days.updateDayRating);

  const currentRating = initialRating ?? 0;
  const displayRating = hoverRating ?? currentRating;

  const handleRatingClick = async (rating: number) => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      await updateDayRating({ dayKey, rating });
      onRatingChange?.(rating);
      toastSuccess("Day rating updated");
    } catch (error) {
      toastError("Failed to update rating");
      captureException("web_day_rating_update_failed", error, {
        dayKey,
        rating,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="flex gap-0.5 cursor-pointer"
        onMouseLeave={() => setHoverRating(null)}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => handleRatingClick(star)}
            onMouseEnter={() => setHoverRating(star)}
            disabled={isLoading}
            className="transition-transform hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={`Rate ${star} stars`}
          >
            <Star
              className={`h-5 w-5 ${
                star <= displayRating
                  ? "fill-yellow-400 text-yellow-400"
                  : "text-muted-foreground"
              } transition-colors`}
            />
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {displayRating > 0 ? `${displayRating} of 5` : "Rate this day"}
      </p>
    </div>
  );
}
