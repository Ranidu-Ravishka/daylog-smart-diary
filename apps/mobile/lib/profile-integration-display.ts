import type { IoniconName } from "@/components/profile/types";

/** Static integration icon map for the profile integrations list (presentational). */
export const PROFILE_INTEGRATION_ICONS: Record<string, IoniconName> = {
  apple_health: "heart",
  apple_calendar: "calendar",
  google_calendar: "calendar",
  gmail_summary: "mail",
  spotify: "musical-notes",
  google_fit: "fitness",
  notion: "document-text",
  microsoft_teams: "people",
  microsoft_outlook: "mail-open",
};

/** Static integration display names (presentational). */
export const PROFILE_INTEGRATION_NAMES: Record<string, string> = {
  apple_health: "Apple Health",
  apple_calendar: "Apple Calendar",
  google_calendar: "Google Calendar",
  gmail_summary: "Gmail Summary",
  spotify: "Spotify",
  google_fit: "Google Fit",
  notion: "Notion",
  microsoft_teams: "Microsoft Teams",
  microsoft_outlook: "Microsoft Outlook",
};
