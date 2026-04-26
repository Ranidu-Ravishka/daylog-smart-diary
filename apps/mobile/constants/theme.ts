import { Platform, TextStyle } from "react-native";

const palette = {
  white: "#FFFFFF",
  black: "#000000",
  gray25: "#FCFCFC",
  gray50: "#F7F7F7",
  gray100: "#F1F1F1",
  gray150: "#E8E8E8",
  gray200: "#E0E0E0",
  gray300: "#C8C8C8",
  gray400: "#A8A8A8",
  gray500: "#7D7D7D",
  gray600: "#5B5B5B",
  gray700: "#3A3A3A",
  gray800: "#242424",
  gray900: "#121212",
  dark0: "#000000",
  dark50: "#060606",
  dark100: "#0E0E0E",
  dark200: "#141414",
  dark300: "#1C1C1C",
  dark400: "#2A2A2A",
};

export const Colors = {
  light: {
    background: palette.gray25,
    surface: palette.white,
    surfaceSecondary: palette.gray50,
    text: palette.black,
    textSecondary: palette.gray600,
    textTertiary: palette.gray500,
    inverseText: palette.white,
    tint: palette.black,
    tintLight: palette.gray100,
    tintMuted: palette.gray150,
    oauthGoogle: palette.black,
    oauthApple: palette.black,
    border: palette.gray200,
    divider: palette.gray150,
    icon: palette.gray600,
    tabIconDefault: palette.gray400,
    tabIconSelected: palette.black,
    success: palette.gray700,
    error: palette.black,
    errorLight: palette.gray100,
    warning: palette.gray700,
    warningLight: palette.gray100,
    cardShadow: "rgba(0,0,0,0.10)",
    skeleton: palette.gray200,
    inputBg: palette.gray100,
    overlay: "rgba(0,0,0,0.45)",
  },
  dark: {
    background: palette.dark50,
    surface: palette.dark200,
    surfaceSecondary: palette.dark300,
    text: palette.white,
    textSecondary: palette.gray400,
    textTertiary: palette.gray500,
    inverseText: palette.black,
    tint: palette.white,
    tintLight: palette.gray800,
    tintMuted: palette.gray700,
    oauthGoogle: palette.white,
    oauthApple: palette.white,
    border: palette.dark400,
    divider: palette.dark300,
    icon: palette.gray500,
    tabIconDefault: palette.gray500,
    tabIconSelected: palette.white,
    success: palette.gray300,
    error: palette.white,
    errorLight: palette.gray800,
    warning: palette.gray300,
    warningLight: palette.gray800,
    cardShadow: "rgba(0,0,0,0.65)",
    skeleton: palette.dark300,
    inputBg: palette.dark300,
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
  largeTitle: {
    fontSize: 30,
    fontWeight: "700",
    lineHeight: 38,
    letterSpacing: -0.4,
  },
  title1: {
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 32,
    letterSpacing: -0.3,
  },
  title2: {
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  title3: { fontSize: 17, fontWeight: "600", lineHeight: 24 },
  body: { fontSize: 16, fontWeight: "400", lineHeight: 24 },
  bodyMedium: { fontSize: 16, fontWeight: "500", lineHeight: 24 },
  callout: { fontSize: 14, fontWeight: "400", lineHeight: 22 },
  caption1: { fontSize: 12, fontWeight: "500", lineHeight: 18 },
  caption2: { fontSize: 11, fontWeight: "400", lineHeight: 14 },
};

// ── Shadows ─────────────────────────────────────────────────
export const Shadows = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 5,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
});
