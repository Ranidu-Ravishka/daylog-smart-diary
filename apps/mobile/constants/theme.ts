import { Platform, TextStyle } from "react-native";

// ── Color palette ───────────────────────────────────────────
const palette = {
  // Neutrals
  white: "#FFFFFF",
  gray50: "#F8F9FA",
  gray100: "#F1F3F5",
  gray200: "#E9ECEF",
  gray300: "#DEE2E6",
  gray400: "#ADB5BD",
  gray500: "#868E96",
  gray600: "#6C757D",
  gray700: "#495057",
  gray800: "#343A40",
  gray900: "#212529",
  black: "#000000",

  // Primary – soft indigo
  indigo50: "#EEF2FF",
  indigo100: "#E0E7FF",
  indigo200: "#C7D2FE",
  indigo400: "#818CF8",
  indigo500: "#6366F1",
  indigo600: "#4F46E5",

  // Accent – warm amber for highlights
  amber50: "#FFFBEB",
  amber100: "#FEF3C7",
  amber400: "#FBBF24",
  amber500: "#F59E0B",

  // Semantic
  green500: "#22C55E",
  red400: "#F87171",
  red500: "#EF4444",

  // Dark mode surfaces
  dark0: "#000000",
  dark50: "#0A0A0A",
  dark100: "#141414",
  dark200: "#1C1C1E",
  dark300: "#2C2C2E",
  dark400: "#3A3A3C",
};

export const Colors = {
  light: {
    // Surfaces
    background: palette.gray50,
    surface: palette.white,
    surfaceSecondary: palette.gray100,
    // Text
    text: palette.gray900,
    textSecondary: palette.gray600,
    textTertiary: palette.gray400,
    // Accent
    tint: palette.indigo500,
    tintLight: palette.indigo50,
    tintMuted: palette.indigo100,
    // UI
    border: palette.gray200,
    divider: palette.gray100,
    icon: palette.gray500,
    tabIconDefault: palette.gray400,
    tabIconSelected: palette.indigo500,
    // Semantic
    success: palette.green500,
    error: palette.red500,
    errorLight: "#FEF2F2",
    warning: palette.amber500,
    warningLight: palette.amber50,
    // Components
    cardShadow: "rgba(0,0,0,0.04)",
    skeleton: palette.gray200,
    inputBg: palette.gray100,
    overlay: "rgba(0,0,0,0.4)",
  },
  dark: {
    background: palette.dark50,
    surface: palette.dark200,
    surfaceSecondary: palette.dark300,
    text: palette.gray50,
    textSecondary: palette.gray400,
    textTertiary: palette.gray600,
    tint: palette.indigo400,
    tintLight: "rgba(99,102,241,0.12)",
    tintMuted: "rgba(99,102,241,0.18)",
    border: palette.dark400,
    divider: palette.dark300,
    icon: palette.gray500,
    tabIconDefault: palette.gray600,
    tabIconSelected: palette.indigo400,
    success: palette.green500,
    error: palette.red400,
    errorLight: "rgba(239,68,68,0.12)",
    warning: palette.amber400,
    warningLight: "rgba(245,158,11,0.12)",
    cardShadow: "rgba(0,0,0,0.3)",
    skeleton: palette.dark300,
    inputBg: palette.dark300,
    overlay: "rgba(0,0,0,0.6)",
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
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
    letterSpacing: -0.3,
  },
  title1: {
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  title2: { fontSize: 18, fontWeight: "600", lineHeight: 24 },
  title3: { fontSize: 16, fontWeight: "600", lineHeight: 22 },
  body: { fontSize: 15, fontWeight: "400", lineHeight: 22 },
  bodyMedium: { fontSize: 15, fontWeight: "500", lineHeight: 22 },
  callout: { fontSize: 14, fontWeight: "400", lineHeight: 20 },
  caption1: { fontSize: 12, fontWeight: "500", lineHeight: 16 },
  caption2: { fontSize: 11, fontWeight: "400", lineHeight: 14 },
};

// ── Shadows ─────────────────────────────────────────────────
export const Shadows = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 5,
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
