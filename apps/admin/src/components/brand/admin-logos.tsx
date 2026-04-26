"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  collapsed?: boolean;
};

export function AdminLogo({ className, collapsed }: LogoProps) {
  if (collapsed) {
    return (
      <Image
        src="/daylog-admin-mark.svg"
        alt="DayLog Admin"
        width={40}
        height={40}
        priority
        className={cn("size-9 dark:invert", className)}
      />
    );
  }

  return (
    <Image
      src="/daylog-admin-logo.svg"
      alt="DayLog Admin"
      width={200}
      height={40}
      priority
      className={cn("h-8 w-auto max-w-[148px] dark:invert", className)}
    />
  );
}
