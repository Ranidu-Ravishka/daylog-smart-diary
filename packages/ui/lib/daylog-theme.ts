/**
 * Canonical DayLog design tokens for packages that already depend on `@repo/ui`.
 * Re-exports `@repo/theme` — prefer importing from `@repo/ui/theme` for a single surface.
 */
export * from "@repo/theme/native";
export * from "@repo/theme/motion";
export * from "@repo/theme/typography";
export {
  DaylogContentMax,
  type DaylogContentMaxProps,
} from "../components/daylog-content-max";
export {
  DaylogGlassCard,
  daylogGlassSurfaces,
  type DaylogGlassCardProps,
  type DaylogGlassVariant,
} from "../components/daylog-glass-card";
