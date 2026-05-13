import {
  daylogColors,
  daylogRadius,
  daylogSpacing,
  type DaylogSemanticColors,
} from "@repo/theme/native";
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

/** Matches web `base-typography` scale (Inter on mobile; web uses Satoshi). */
export const Typography: Record<string, TextStyle> = {
  h1: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "600",
    letterSpacing: -0.56,
  },
  h2: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 24,
    lineHeight: 31,
    fontWeight: "600",
    letterSpacing: -0.42,
  },
  h3: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 19,
    lineHeight: 26,
    fontWeight: "600",
    letterSpacing: -0.24,
  },
  bodyLarge: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    lineHeight: 26,
    fontWeight: "400",
  },
  bodySmall: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 23,
    fontWeight: "400",
  },
  button: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
  },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "500",
  },
  caption: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "400",
  },
  largeTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "600",
    letterSpacing: -0.56,
  },
  title1: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 24,
    lineHeight: 31,
    fontWeight: "600",
    letterSpacing: -0.42,
  },
  title2: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 19,
    lineHeight: 26,
    fontWeight: "600",
    letterSpacing: -0.24,
  },
  title3: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 19,
    lineHeight: 26,
    fontWeight: "600",
  },
  body: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    lineHeight: 26,
    fontWeight: "400",
  },
  bodyMedium: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    lineHeight: 26,
    fontWeight: "500",
  },
  callout: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 23,
    fontWeight: "400",
  },
  caption1: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "500",
  },
  caption2: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "400",
  },
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
    sans: "Inter_400Regular",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "Inter_400Regular",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
});
