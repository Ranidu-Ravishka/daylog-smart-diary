import {
  getDayKeyForTimestamp,
  getResolvedTimeZone,
} from "@repo/ui/lib/day-window";
import type { ProfileSectionMeta } from "@/components/profile/types";

/** Tab chips for the profile / settings screen. */
export const PROFILE_SECTIONS: ProfileSectionMeta[] = [
  {
    key: "overview",
    title: "Overview",
    subtitle: "Account, theme, and status",
    icon: "person-circle-outline",
  },
  {
    key: "privacy",
    title: "Privacy",
    subtitle: "Permissions and life context",
    icon: "shield-checkmark-outline",
  },
  {
    key: "notifications",
    title: "Notifications",
    subtitle: "Reminders and quiet hours",
    icon: "notifications-outline",
  },
  {
    key: "integrations",
    title: "Integrations",
    subtitle: "Connect apps and services",
    icon: "git-network-outline",
  },
  {
    key: "account",
    title: "Account",
    subtitle: "Export data and sign out",
    icon: "key-outline",
  },
];

/** OAuth-capable integration providers (must match web `OAUTH_PROVIDERS`). */
const OAUTH_INTEGRATION_PROVIDERS = [
  "google_calendar",
  "google_fit",
  "gmail_summary",
  "spotify",
] as const;

export function isOAuthProvider(
  provider: string,
): provider is (typeof OAUTH_INTEGRATION_PROVIDERS)[number] {
  return (OAUTH_INTEGRATION_PROVIDERS as readonly string[]).includes(provider);
}

export function getTodayDayKey(): string {
  return getDayKeyForTimestamp(Date.now(), getResolvedTimeZone());
}

/** Parse `HH:mm` (24h) into a `Date` on the current local calendar day. */
export function parseTimeToDate(time24: string): Date {
  const [hRaw, mRaw] = time24.split(":");
  const h = Number.parseInt(hRaw ?? "0", 10);
  const m = Number.parseInt(mRaw ?? "0", 10);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

/** Format a `Date` as `HH:mm` in local time. */
export function formatDateTo24h(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Snap local time to the nearest quarter hour. */
export function snapToQuarterHour(date: Date): Date {
  const d = new Date(date);
  const minutes = d.getMinutes();
  const snapped = Math.round(minutes / 15) * 15;
  d.setMinutes(snapped, 0, 0);
  return d;
}

/** Display `HH:mm` 24h string as 12h with AM/PM. */
export function format24hTo12h(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  const h24 = Number.parseInt(hStr ?? "0", 10);
  const minutePart = (mStr ?? "00").padStart(2, "0").slice(0, 2);
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${minutePart} ${period}`;
}
