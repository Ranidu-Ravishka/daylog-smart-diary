/**
 * Framework-agnostic DayLog motion language (Framer Motion, CSS, Reanimated, RN Animated).
 * Prefer soft timing — avoid aggressive springs and bouncy physics.
 */

/** Primary UI easing — calm deceleration (matches Framer `ease` arrays). */
export const DAYLOG_EASE = [0.22, 1, 0.36, 1] as const;

export type DaylogEasing = typeof DAYLOG_EASE;

/** Durations in milliseconds — Reanimated layout / RN `Animated` / gesture feedback / CSS. */
export const daylogDurationMs = {
  instant: 0,
  quick: 170,
  standard: 220,
  emphasized: 320,
  /** Theme / navigation bridge (e.g. light↔dark shell cross-fade). */
  themeTransition: 260,
  page: 400,
  /** Sidebar width, dialog transform — maps to `--daylog-d-ms-layout`. */
  layout: 200,
  /** Nav row hover / compact link color — maps to `--daylog-d-ms-link`. */
  link: 150,
  /** Sheet slide — maps to `--daylog-d-ms-sheet`. */
  sheet: 300,
  /** Modal scale/fade — maps to `--daylog-d-ms-dialog`. */
  dialog: 200,
} as const;

/** Durations in seconds — Framer Motion `transition.duration`. */
export const daylogDurationS = {
  fadeEntrance: 0.55,
  hoverMicro: 0.18,
  layoutSoft: 0.28,
  sheet: 0.32,
} as const;

/** Stagger offsets (ms) — auth / list reveals. */
export const daylogStaggerMs = {
  none: 0,
  sm: 60,
  md: 120,
} as const;

/**
 * Backward-compatible token object used by the mobile app (Reanimated presets).
 * @deprecated Prefer `daylogDurationMs` / `daylogStaggerMs` in new code.
 */
export const MotionTokens = {
  duration: {
    quick: daylogDurationMs.quick,
    standard: daylogDurationMs.standard,
    themeTransition: daylogDurationMs.themeTransition,
  },
  delay: {
    none: daylogStaggerMs.none,
    staggerSm: daylogStaggerMs.sm,
    staggerMd: daylogStaggerMs.md,
  },
} as const;

/** Gentle springs for `withSpring` — low stiffness, adequate damping (no elastic bounce). */
export const daylogSpringGentle = {
  stiffness: 260,
  damping: 32,
  mass: 1,
} as const;

export const daylogSpringSoft = {
  stiffness: 200,
  damping: 26,
  mass: 1,
} as const;

/**
 * Framer Motion shared layout / highlight pill — calm, not snappy.
 * Use with `layoutId` highlights (e.g. admin sidebar active row).
 */
export const daylogFramerSpringSharedLayout = {
  type: "spring" as const,
  ...daylogSpringGentle,
};

/** Marketing ambient orbs — long, even breathing (Framer Motion). */
export const daylogAmbientOrbEase = "easeInOut" as const;

export const daylogAmbientOrbs = {
  primary: {
    duration: 14,
    repeat: Infinity,
    ease: daylogAmbientOrbEase,
  },
  secondary: {
    duration: 18,
    repeat: Infinity,
    ease: daylogAmbientOrbEase,
    delay: 1,
  },
  tertiary: {
    duration: 20,
    repeat: Infinity,
    ease: daylogAmbientOrbEase,
  },
} as const;

export function daylogFadeTransition(delay = 0) {
  return {
    duration: daylogDurationS.fadeEntrance,
    delay,
    ease: [...DAYLOG_EASE] as [number, number, number, number],
  };
}
