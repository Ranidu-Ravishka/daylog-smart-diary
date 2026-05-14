import { USER_SETTINGS_DEFAULTS } from "@repo/user-settings/lib/user-settings";
import {
  INTEGRATION_COMING_SOON_BADGE_LABEL,
  INTEGRATION_COMING_SOON_HELPER_TEXT,
  INTEGRATION_PROVIDER_CATALOG,
  INTEGRATION_PROVIDER_META,
  INTEGRATION_PROVIDERS,
  INTEGRATION_PROVIDER_STATUS,
  type IntegrationProvider,
  type IntegrationProviderStatus,
} from "@repo/user-settings/lib/integration-provider-catalog";
import { MOOD_EMOJI, MOOD_LABELS, MOOD_OPTIONS, MOODS } from "./mood-options";

export { MOOD_EMOJI, MOOD_LABELS, MOOD_OPTIONS, MOODS };

export const MEMORY_MOOD_OPTIONS = MOODS;

export const FOCUS_AREAS = [
  { id: 0, label: "Mental Health", icon: "fitness" },
  { id: 1, label: "Productivity", icon: "time" },
  { id: 2, label: "Relationships", icon: "people" },
  { id: 3, label: "Fitness", icon: "trending-up" },
  { id: 4, label: "Creativity", icon: "compass" },
] as const;

export const SETTINGS_DEFAULTS = USER_SETTINGS_DEFAULTS;
export {
  INTEGRATION_COMING_SOON_BADGE_LABEL,
  INTEGRATION_COMING_SOON_HELPER_TEXT,
  INTEGRATION_PROVIDER_CATALOG,
  INTEGRATION_PROVIDER_META,
  INTEGRATION_PROVIDERS,
  INTEGRATION_PROVIDER_STATUS,
};

export type { IntegrationProvider, IntegrationProviderStatus };
