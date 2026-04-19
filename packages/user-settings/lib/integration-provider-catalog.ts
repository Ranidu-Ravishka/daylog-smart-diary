export type IntegrationProviderStatus = "available" | "coming_soon";

export type IntegrationProviderDefinition = {
  label: string;
  description: string;
  status: IntegrationProviderStatus;
  helperText?: string;
};

export const INTEGRATION_COMING_SOON_BADGE_LABEL = "Coming Soon";

export const INTEGRATION_COMING_SOON_HELPER_TEXT =
  "This integration is currently under development and will be available soon.";

export const INTEGRATION_PROVIDER_CATALOG = {
  google_calendar: {
    label: "Google Calendar",
    description: "Use calendar activity as daily context",
    status: "available",
  },
  google_fit: {
    label: "Google Fit",
    description: "Sync steps and sleep metrics",
    status: "available",
  },
  gmail_summary: {
    label: "Gmail Summary",
    description: "Summarize inbox activity signals",
    status: "available",
  },
  spotify: {
    label: "Spotify",
    description: "Include listening activity signals",
    status: "available",
  },
  apple_health: {
    label: "Apple Health",
    description: "Upload device health metrics",
    status: "available",
  },
  apple_calendar: {
    label: "Apple Calendar",
    description: "Capture calendar context from Apple devices",
    status: "available",
  },
  notion: {
    label: "Notion",
    description: "Bring notes and workspace updates into context",
    status: "coming_soon",
    helperText: INTEGRATION_COMING_SOON_HELPER_TEXT,
  },
  microsoft_teams: {
    label: "Microsoft Teams",
    description: "Capture Teams meetings and collaboration activity",
    status: "coming_soon",
    helperText: INTEGRATION_COMING_SOON_HELPER_TEXT,
  },
  microsoft_outlook: {
    label: "Microsoft Outlook",
    description: "Sync Outlook calendar events into daily context",
    status: "coming_soon",
    helperText: INTEGRATION_COMING_SOON_HELPER_TEXT,
  },
} as const satisfies Record<string, IntegrationProviderDefinition>;

export type IntegrationProvider = keyof typeof INTEGRATION_PROVIDER_CATALOG;

const providerCatalogEntries = Object.entries(
  INTEGRATION_PROVIDER_CATALOG,
) as Array<
  [
    IntegrationProvider,
    (typeof INTEGRATION_PROVIDER_CATALOG)[IntegrationProvider],
  ]
>;

export const INTEGRATION_PROVIDERS = providerCatalogEntries.map(
  ([provider]) => provider,
);

export const INTEGRATION_PROVIDER_META = Object.fromEntries(
  providerCatalogEntries.map(([provider, definition]) => [
    provider,
    {
      label: definition.label,
      description: definition.description,
      helperText:
        "helperText" in definition ? definition.helperText : undefined,
    },
  ]),
) as Record<
  IntegrationProvider,
  {
    label: string;
    description: string;
    helperText?: string;
  }
>;

export const INTEGRATION_PROVIDER_STATUS = Object.fromEntries(
  providerCatalogEntries.map(([provider, definition]) => [
    provider,
    definition.status,
  ]),
) as Record<IntegrationProvider, IntegrationProviderStatus>;

export const AVAILABLE_INTEGRATION_PROVIDERS = providerCatalogEntries
  .filter(([, definition]) => definition.status === "available")
  .map(([provider]) => provider) as IntegrationProvider[];

const integrationProviderSet = new Set<string>(INTEGRATION_PROVIDERS);

export function getIntegrationProviderDefinition(
  provider: string,
): IntegrationProviderDefinition | undefined {
  const definition =
    INTEGRATION_PROVIDER_CATALOG[provider as IntegrationProvider];
  if (!definition) {
    return undefined;
  }

  return {
    label: definition.label,
    description: definition.description,
    status: definition.status,
    helperText: "helperText" in definition ? definition.helperText : undefined,
  };
}

export function isKnownIntegrationProvider(
  provider: string,
): provider is IntegrationProvider {
  return integrationProviderSet.has(provider);
}

export function isIntegrationProviderComingSoon(provider: string): boolean {
  return getIntegrationProviderDefinition(provider)?.status === "coming_soon";
}
