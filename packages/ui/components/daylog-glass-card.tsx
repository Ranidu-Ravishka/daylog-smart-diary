import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";

import { cn } from "../lib/cn";

export const daylogGlassSurfaces = {
  marketing:
    "rounded-2xl border border-border/50 bg-card/60 p-8 shadow-soft backdrop-blur-xl dark:bg-card/45",
  feature:
    "group h-full rounded-2xl border border-border/50 bg-card/50 p-6 shadow-sm backdrop-blur-md transition-[transform,box-shadow,border-color] duration-[var(--daylog-d-ms-sheet)] hover:-translate-y-0.5 hover:border-border hover:shadow-soft dark:bg-card/40 md:p-8",
  quote:
    "h-full rounded-2xl border border-border/50 bg-card/50 p-6 shadow-sm backdrop-blur-md dark:bg-card/40",
} as const;

export type DaylogGlassVariant = keyof typeof daylogGlassSurfaces;

export type DaylogGlassCardProps = ComponentPropsWithoutRef<"div"> & {
  variant?: DaylogGlassVariant;
};

/**
 * Frosted marketing / dashboard-adjacent surface — pairs with `@repo/theme` duration tokens.
 */
export const DaylogGlassCard = forwardRef<
  ElementRef<"div">,
  DaylogGlassCardProps
>(({ className, variant = "marketing", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(daylogGlassSurfaces[variant], className)}
    {...props}
  />
));
DaylogGlassCard.displayName = "DaylogGlassCard";
