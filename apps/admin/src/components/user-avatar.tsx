"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";

type UserAvatarProps = {
  src: string | null | undefined;
  alt: string;
  fallbackLabel: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
};

const sizePx = { sm: 28, md: 32, lg: 40, xl: 80 };

export function UserAvatar({
  src,
  alt,
  fallbackLabel,
  size = "md",
  className,
}: UserAvatarProps) {
  const [failed, setFailed] = useState(false);
  const px = sizePx[size];
  const initial = (fallbackLabel.trim().charAt(0) || "?").toUpperCase();
  const showImage = Boolean(src && !failed);
  const initialText =
    size === "xl"
      ? "text-lg font-semibold"
      : size === "lg"
        ? "text-xs font-semibold"
        : "text-[0.65rem] font-semibold";

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 overflow-hidden rounded-full border border-border bg-muted ring-2 ring-background",
        className,
      )}
      style={{ width: px, height: px }}
    >
      {showImage ? (
        <Image
          src={src!}
          alt={alt}
          width={px}
          height={px}
          className="size-full object-cover"
          unoptimized
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className={cn(
            "flex size-full items-center justify-center bg-muted text-foreground",
            initialText,
          )}
        >
          {initial}
        </span>
      )}
    </span>
  );
}
