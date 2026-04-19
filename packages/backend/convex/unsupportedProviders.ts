export const UNSUPPORTED_PROVIDERS = ["slack", "strava", "todoist"] as const;

export type UnsupportedProvider = (typeof UNSUPPORTED_PROVIDERS)[number];

const unsupportedProviderSet = new Set<string>(UNSUPPORTED_PROVIDERS);

export function isUnsupportedProvider(provider: string): boolean {
  return unsupportedProviderSet.has(provider.trim().toLowerCase());
}
