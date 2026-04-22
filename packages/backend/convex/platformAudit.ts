export const PLATFORM_AUDIT_CATEGORIES = [
  "retention",
  "summary_quality",
  "integration_health",
  "deletion",
  "admin",
] as const;

export type PlatformAuditCategory = (typeof PLATFORM_AUDIT_CATEGORIES)[number];
