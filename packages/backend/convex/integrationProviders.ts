const CONNECTABLE_INTEGRATION_PROVIDERS = [
  "google_calendar",
  "google_fit",
  "spotify",
  "apple_health",
] as const;

const CONTEXTUAL_DAILY_DATA_PROVIDERS = ["location"] as const;

const DAILY_DATA_PROVIDERS = [
  ...CONNECTABLE_INTEGRATION_PROVIDERS,
  ...CONTEXTUAL_DAILY_DATA_PROVIDERS,
] as const;

const OAUTH_REFRESH_PROVIDERS = [
  "google_calendar",
  "google_fit",
  "spotify",
] as const;

export type IntegrationProvider =
  (typeof CONNECTABLE_INTEGRATION_PROVIDERS)[number];

export type DailyDataProvider = (typeof DAILY_DATA_PROVIDERS)[number];

export type OAuthRefreshProvider = (typeof OAUTH_REFRESH_PROVIDERS)[number];

export const integrationProviderList = [...CONNECTABLE_INTEGRATION_PROVIDERS];
export const dailyDataProviderList = [...DAILY_DATA_PROVIDERS];
export const oauthRefreshProviderList = [...OAUTH_REFRESH_PROVIDERS];

const integrationProviderSet = new Set<string>(integrationProviderList);
const dailyDataProviderSet = new Set<string>(dailyDataProviderList);
const oauthRefreshProviderSet = new Set<string>(oauthRefreshProviderList);

export function sanitizeProviderInput(provider: string): string {
  return provider.trim().toLowerCase();
}

function formatAllowedProviders(providers: readonly string[]): string {
  return providers.join(", ");
}

export function assertIntegrationProvider(
  provider: string,
): IntegrationProvider {
  const normalized = sanitizeProviderInput(provider);
  if (!integrationProviderSet.has(normalized)) {
    throw new Error(
      `Unsupported integration provider "${provider}". Allowed values: ${formatAllowedProviders(integrationProviderList)}.`,
    );
  }

  return normalized as IntegrationProvider;
}

export function assertDailyDataProvider(provider: string): DailyDataProvider {
  const normalized = sanitizeProviderInput(provider);
  if (!dailyDataProviderSet.has(normalized)) {
    throw new Error(
      `Unsupported daily data provider "${provider}". Allowed values: ${formatAllowedProviders(dailyDataProviderList)}.`,
    );
  }

  return normalized as DailyDataProvider;
}

export function asIntegrationProvider(
  provider: string,
): IntegrationProvider | null {
  const normalized = sanitizeProviderInput(provider);
  if (!integrationProviderSet.has(normalized)) return null;
  return normalized as IntegrationProvider;
}

export function asOAuthRefreshProvider(
  provider: string,
): OAuthRefreshProvider | null {
  const normalized = sanitizeProviderInput(provider);
  if (!oauthRefreshProviderSet.has(normalized)) return null;
  return normalized as OAuthRefreshProvider;
}
