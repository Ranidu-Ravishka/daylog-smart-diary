/**
 * Shared typographic rhythm (numeric only — no React).
 * Web applies these via `base-typography.css` + Satoshi; mobile maps to loaded sans (Plus Jakarta).
 */

export const daylogTypeScale = {
  h1: {
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.56,
    fontWeight: "600" as const,
  },
  h2: {
    fontSize: 24,
    lineHeight: 31,
    letterSpacing: -0.42,
    fontWeight: "600" as const,
  },
  h3: {
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: -0.24,
    fontWeight: "600" as const,
  },
  bodyLarge: {
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: 0,
    fontWeight: "400" as const,
  },
  bodySmall: {
    fontSize: 14,
    lineHeight: 23,
    letterSpacing: 0,
    fontWeight: "400" as const,
  },
  button: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
    fontWeight: "500" as const,
  },
  label: {
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0,
    fontWeight: "500" as const,
  },
  caption: {
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0,
    fontWeight: "400" as const,
  },
} as const;

export type DaylogTypeRole = keyof typeof daylogTypeScale;
