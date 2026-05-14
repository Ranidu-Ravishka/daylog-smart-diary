import {
  daylogColors,
  daylogRadius,
  daylogSpacing,
  type DaylogSemanticColors,
} from "@repo/theme/native";
import { daylogTypeScale } from "@repo/theme/typography";
import { Platform, TextStyle } from "react-native";

export const Colors: {
  light: DaylogSemanticColors;
  dark: DaylogSemanticColors;
} = {
  light: { ...daylogColors.light },
  dark: { ...daylogColors.dark },
};

export type ThemeColors = DaylogSemanticColors;

export const Spacing = daylogSpacing;
export const Radius = daylogRadius;

/**
 * Plus Jakarta Sans — premium geometric sans aligned with web Satoshi pairing
 * (loaded in `app/_layout.tsx` via `useFonts`).
 */
const sans = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
} as const;

function textStyle(
  role: keyof typeof daylogTypeScale,
  face: keyof typeof sans,
): TextStyle {
  const s = daylogTypeScale[role];
  return {
    fontFamily: sans[face],
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    fontWeight: s.fontWeight,
  };
}

/** Matches `@repo/theme/typography` + web `base-typography.css` rhythm. */
export const Typography: Record<string, TextStyle> = {
  h1: textStyle("h1", "semibold"),
  h2: textStyle("h2", "semibold"),
  h3: textStyle("h3", "semibold"),
  bodyLarge: textStyle("bodyLarge", "regular"),
  bodySmall: textStyle("bodySmall", "regular"),
  button: textStyle("button", "medium"),
  label: textStyle("label", "medium"),
  caption: textStyle("caption", "regular"),
  largeTitle: textStyle("h1", "semibold"),
  title1: textStyle("h2", "semibold"),
  title2: textStyle("h3", "semibold"),
  title3: textStyle("h3", "semibold"),
  body: textStyle("bodyLarge", "regular"),
  bodyMedium: {
    fontFamily: sans.medium,
    fontSize: daylogTypeScale.bodyLarge.fontSize,
    lineHeight: daylogTypeScale.bodyLarge.lineHeight,
    letterSpacing: daylogTypeScale.bodyLarge.letterSpacing,
    fontWeight: "500",
  },
  callout: textStyle("bodySmall", "regular"),
  caption1: textStyle("label", "medium"),
  caption2: textStyle("caption", "regular"),
};

export const Shadows = {
  sm: {
    shadowColor: "#181B22",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: "#181B22",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  lg: {
    shadowColor: "#181B22",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 22,
    elevation: 5,
  },
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: sans.regular,
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: sans.regular,
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
});
