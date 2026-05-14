/**
 * Cross-platform DayLog color + layout rhythm (no React Native imports).
 * Hex values align with `packages/theme/css/palette.css` HSL tokens.
 */

export const daylogSpacing = {
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

/** Aligns to `--radius: 0.875rem` (14px) and Tailwind radius scale */
export const daylogRadius = {
  sm: 8,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
} as const;

/** Semantic colors shared by light and dark (hex / rgba strings). */
export type DaylogSemanticColors = {
  background: string;
  surface: string;
  surfaceSecondary: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  inverseText: string;
  tint: string;
  tintLight: string;
  tintMuted: string;
  oauthGoogle: string;
  oauthApple: string;
  border: string;
  divider: string;
  icon: string;
  tabIconDefault: string;
  tabIconSelected: string;
  success: string;
  error: string;
  errorLight: string;
  warning: string;
  warningLight: string;
  cardShadow: string;
  skeleton: string;
  inputBg: string;
  overlay: string;
};

const light: DaylogSemanticColors = {
  background: "#FAF9FC",
  surface: "#F3F1F7",
  surfaceSecondary: "#FFFFFF",
  text: "#242A33",
  textSecondary: "#5E6674",
  textTertiary: "#949DAA",
  inverseText: "#FFFFFF",
  tint: "#5C5289",
  tintLight: "#EBE8F2",
  tintMuted: "#DDE2EB",
  oauthGoogle: "#242A33",
  oauthApple: "#242A33",
  border: "#DDE2EB",
  divider: "#EDEBF2",
  icon: "#5E6674",
  tabIconDefault: "#949DAA",
  tabIconSelected: "#5C5289",
  success: "#3D8A6A",
  error: "#C45C4F",
  errorLight: "#F7EBE9",
  warning: "#B8893A",
  warningLight: "#F8F1E4",
  cardShadow: "rgba(36, 42, 51, 0.08)",
  skeleton: "#DDE2EB",
  inputBg: "#FFFFFF",
  overlay: "rgba(24, 28, 36, 0.42)",
};

const dark: DaylogSemanticColors = {
  background: "#181B22",
  surface: "#1E232D",
  surfaceSecondary: "#252A35",
  text: "#E8E6EA",
  textSecondary: "#A8AEB9",
  textTertiary: "#7E8694",
  inverseText: "#181B22",
  tint: "#B8A9E8",
  tintLight: "#2A2F3A",
  tintMuted: "#343A48",
  oauthGoogle: "#E8E6EA",
  oauthApple: "#E8E6EA",
  border: "#343A48",
  divider: "#2A2F3A",
  icon: "#A8AEB9",
  tabIconDefault: "#7E8694",
  tabIconSelected: "#9EBBD4",
  success: "#5BA884",
  error: "#D88478",
  errorLight: "#3A2624",
  warning: "#C9A85E",
  warningLight: "#3A3424",
  cardShadow: "rgba(0, 0, 0, 0.35)",
  skeleton: "#343A48",
  inputBg: "#1E232D",
  overlay: "rgba(8, 10, 14, 0.65)",
};

export const daylogColors: {
  light: DaylogSemanticColors;
  dark: DaylogSemanticColors;
} = {
  light,
  dark,
};

export type DaylogColorMode = keyof typeof daylogColors;
