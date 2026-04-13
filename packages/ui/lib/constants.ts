import {
  MEMORY_MOOD_VALUES,
  USER_SETTINGS_DEFAULTS,
} from "@repo/user-settings/lib/user-settings";

export const MOOD_EMOJI: Record<string, string> = {
  happy: "😊",
  sad: "😢",
  excited: "🎉",
  peaceful: "😌",
  loved: "❤️",
  angry: "😤",
  anxious: "😰",
  neutral: "😐",
};

export const MOODS = Object.keys(MOOD_EMOJI);

export const MEMORY_MOOD_OPTIONS = MEMORY_MOOD_VALUES;

export const FOCUS_AREAS = [
  { id: 0, label: "Mental Health", icon: "fitness" },
  { id: 1, label: "Productivity", icon: "time" },
  { id: 2, label: "Relationships", icon: "people" },
  { id: 3, label: "Fitness", icon: "trending-up" },
  { id: 4, label: "Creativity", icon: "compass" },
] as const;

export const SETTINGS_DEFAULTS = USER_SETTINGS_DEFAULTS;

export const INTEGRATION_PROVIDERS = [
  "google_calendar",
  "google_fit",
  "spotify",
  "apple_health",
] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_PROVIDER_META: Record<
  IntegrationProvider,
  {
    label: string;
    description: string;
  }
> = {
  google_calendar: {
    label: "Google Calendar",
    description: "Use calendar activity as daily context",
  },
  google_fit: {
    label: "Google Fit",
    description: "Sync steps and sleep metrics",
  },
  spotify: {
    label: "Spotify",
    description: "Include listening activity signals",
  },
  apple_health: {
    label: "Apple Health",
    description: "Upload device health metrics",
  },
};
