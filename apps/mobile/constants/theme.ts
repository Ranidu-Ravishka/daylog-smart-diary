import { Platform, TextStyle } from "react-native";

const palette = {
  white: "#FFFFFF",
  softBlack: "#1A1A1A",
  neutralBg: "#F8F8F7",
  neutralSurface: "#F2F2F2",
  neutralMuted: "#EEEEEE",
  neutralBorder: "#E3E3E3",
  neutralInputBorder: "#DADADA",
  neutralTextSecondary: "#6B6B6B",
  neutralTextTertiary: "#A0A0A0",
  brandPrimary: "#2F3E46",
  brandSage: "#84A98C",
  brandGold: "#C6A96B",
  success: "#7FB77E",
  warning: "#E9C46A",
  error: "#E76F51",
  info: "#4A90E2",
  darkBg: "#121212",
  darkSurface: "#1E1E1E",
  darkSurfaceSecondary: "#232323",
  darkBorder: "#2F2F2F",
  darkText: "#EAEAEA",
  darkTextSecondary: "#ABABAB",
  darkTextTertiary: "#949494",
};

export const Colors = {
  light: {
    background: palette.neutralBg,
    surface: palette.neutralSurface,
    surfaceSecondary: palette.white,
    text: palette.softBlack,
    textSecondary: palette.neutralTextSecondary,
    textTertiary: palette.neutralTextTertiary,
    inverseText: palette.white,
    tint: palette.brandPrimary,
    tintLight: palette.neutralMuted,
    tintMuted: palette.neutralBorder,
    oauthGoogle: palette.softBlack,
    oauthApple: palette.softBlack,
    border: palette.neutralBorder,
    divider: palette.neutralMuted,
    icon: palette.neutralTextSecondary,
    tabIconDefault: palette.neutralTextTertiary,
    tabIconSelected: palette.brandPrimary,
    success: palette.success,
    error: palette.error,
    errorLight: "#FBEDEA",
    warning: palette.warning,
    warningLight: "#FBF4E1",
    cardShadow: "rgba(0,0,0,0.04)",
    skeleton: palette.neutralBorder,
    inputBg: palette.white,
    overlay: "rgba(0,0,0,0.45)",
  },
  dark: {
    background: palette.darkBg,
    surface: palette.darkSurface,
    surfaceSecondary: palette.darkSurfaceSecondary,
    text: palette.darkText,
    textSecondary: palette.darkTextSecondary,
    textTertiary: palette.darkTextTertiary,
    inverseText: palette.softBlack,
    tint: "#3F5661",
    tintLight: "#2A2E31",
    tintMuted: "#384043",
    oauthGoogle: palette.darkText,
    oauthApple: palette.darkText,
    border: palette.darkBorder,
    divider: "#2D2D2D",
    icon: palette.darkTextSecondary,
    tabIconDefault: palette.darkTextTertiary,
    tabIconSelected: "#91B49A",
    success: "#89C287",
    error: "#EF8268",
    errorLight: "#3A2420",
    warning: "#F0CE7F",
    warningLight: "#3A321F",
    cardShadow: "rgba(0,0,0,0.38)",
    skeleton: "#343434",
    inputBg: palette.darkSurface,
    overlay: "rgba(0,0,0,0.72)",
  },
};

export type ThemeColors = (typeof Colors)["light"];

// ── Spacing scale (4-point grid) ────────────────────────────
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
} as const;

// ── Border radii ────────────────────────────────────────────
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
} as const;

// ── Typography ──────────────────────────────────────────────
export const Typography: Record<string, TextStyle> = {
  h1: {
    fontFamily: "Inter_700Bold",
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.32,
  },
  h2: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 24,
    lineHeight: 33,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  h3: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 20,
    lineHeight: 30,
    fontWeight: "600",
    letterSpacing: -0.16,
  },
  bodyLarge: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    lineHeight: 25,
    fontWeight: "400",
  },
  bodySmall: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 22,
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
    fontFamily: "Inter_700Bold",
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.32,
  },
  title1: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 24,
    lineHeight: 33,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  title2: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 20,
    lineHeight: 30,
    fontWeight: "600",
    letterSpacing: -0.16,
  },
  title3: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 20,
    lineHeight: 30,
    fontWeight: "600",
  },
  body: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    lineHeight: 25,
    fontWeight: "400",
  },
  bodyMedium: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    lineHeight: 25,
    fontWeight: "500",
  },
  callout: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 22,
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

// ── Shadows ─────────────────────────────────────────────────
export const Shadows = {
  sm: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  lg: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
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
