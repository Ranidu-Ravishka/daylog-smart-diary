import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";

import { cn } from "../lib/cn";

const maxWidthClass = {
  sm: "max-w-3xl",
  md: "max-w-4xl",
  lg: "max-w-6xl",
  xl: "max-w-7xl",
} as const;

export type DaylogContentMaxProps = ComponentPropsWithoutRef<"div"> & {
  maxWidth?: keyof typeof maxWidthClass;
};

/**
 * Centered content column — matches repeated `mx-auto max-w-*` marketing / legal shells.
 */
export const DaylogContentMax = forwardRef<
  ElementRef<"div">,
  DaylogContentMaxProps
>(({ className, maxWidth = "lg", ...props }, ref) => (
  <div
    ref={ref}
    className={cn("mx-auto w-full", maxWidthClass[maxWidth], className)}
    {...props}
  />
));
DaylogContentMax.displayName = "DaylogContentMax";
