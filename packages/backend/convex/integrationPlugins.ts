type IntegrationConnectionMode = "oauth" | "manual";

type IntegrationSyncMode =
  | "provider_api"
  | "derived_contextual_calendar"
  | "client_push";

export type OAuthCredentialSource = "google" | "spotify";

export type OAuthTokenExchangeMode = "form_urlencoded" | "basic_json";

type IntegrationOAuthConfig = {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
  credentialSource: OAuthCredentialSource;
  authQueryParams?: Readonly<Record<string, string>>;
  tokenExchangeMode: OAuthTokenExchangeMode;
  allowTokenRefresh: boolean;
};

export type IntegrationPluginDefinition = {
  provider: string;
  connectionMode: IntegrationConnectionMode;
  syncMode: IntegrationSyncMode;
  requiresStoredToken: boolean;
  oauth?: IntegrationOAuthConfig;
};

const INTEGRATION_PLUGIN_REGISTRY = {
  google_calendar: {
    provider: "google_calendar",
    connectionMode: "oauth",
    syncMode: "provider_api",
    requiresStoredToken: true,
    oauth: {
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      credentialSource: "google",
      authQueryParams: {
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent",
      },
      tokenExchangeMode: "form_urlencoded",
      allowTokenRefresh: true,
    },
  },
  google_fit: {
    provider: "google_fit",
    connectionMode: "oauth",
    syncMode: "provider_api",
    requiresStoredToken: true,
    oauth: {
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: [
        "https://www.googleapis.com/auth/fitness.activity.read",
        "https://www.googleapis.com/auth/fitness.sleep.read",
      ],
      credentialSource: "google",
      authQueryParams: {
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent",
      },
      tokenExchangeMode: "form_urlencoded",
      allowTokenRefresh: true,
    },
  },
  gmail_summary: {
    provider: "gmail_summary",
    connectionMode: "oauth",
    syncMode: "provider_api",
    requiresStoredToken: true,
    oauth: {
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      credentialSource: "google",
      authQueryParams: {
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent",
      },
      tokenExchangeMode: "form_urlencoded",
      allowTokenRefresh: true,
    },
  },
  spotify: {
    provider: "spotify",
    connectionMode: "oauth",
    syncMode: "provider_api",
    requiresStoredToken: true,
    oauth: {
      authorizationUrl: "https://accounts.spotify.com/authorize",
      tokenUrl: "https://accounts.spotify.com/api/token",
      scopes: [
        "user-read-recently-played",
        "user-top-read",
        "user-read-playback-state",
      ],
      credentialSource: "spotify",
      authQueryParams: {
        show_dialog: "true",
      },
      tokenExchangeMode: "form_urlencoded",
      allowTokenRefresh: true,
    },
  },
  apple_health: {
    provider: "apple_health",
    connectionMode: "manual",
    syncMode: "client_push",
    requiresStoredToken: false,
  },
  apple_calendar: {
    provider: "apple_calendar",
    connectionMode: "manual",
    syncMode: "derived_contextual_calendar",
    requiresStoredToken: false,
  },
} as const satisfies Record<string, IntegrationPluginDefinition>;

export type IntegrationPluginProvider =
  keyof typeof INTEGRATION_PLUGIN_REGISTRY;

export const integrationPluginProviders = Object.keys(
  INTEGRATION_PLUGIN_REGISTRY,
) as IntegrationPluginProvider[];

export const oauthIntegrationPluginProviders =
  integrationPluginProviders.filter(
    (provider): provider is IntegrationPluginProvider => {
      const plugin = INTEGRATION_PLUGIN_REGISTRY[provider];
      return "oauth" in plugin;
    },
  );

export const oauthRefreshPluginProviders =
  oauthIntegrationPluginProviders.filter(
    (provider): provider is IntegrationPluginProvider => {
      const plugin = INTEGRATION_PLUGIN_REGISTRY[provider];
      return "oauth" in plugin && plugin.oauth.allowTokenRefresh;
    },
  );

export function getIntegrationPlugin(
  provider: string,
): IntegrationPluginDefinition | null {
  return INTEGRATION_PLUGIN_REGISTRY[
    provider as IntegrationPluginProvider
  ] as IntegrationPluginDefinition | null;
}

export function getRequiredIntegrationPlugin(provider: string) {
  const plugin = getIntegrationPlugin(provider);
  if (!plugin) {
    throw new Error(`Unsupported integration provider "${provider}".`);
  }

  return plugin;
}

export function isOAuthIntegrationProvider(provider: string): boolean {
  const plugin = getIntegrationPlugin(provider);
  return Boolean(plugin?.oauth);
}

export function getOAuthCredentialEnvNames(source: OAuthCredentialSource): {
  clientIdEnv: string;
  clientSecretEnv: string;
} {
  if (source === "spotify") {
    return {
      clientIdEnv: "SPOTIFY_CLIENT_ID",
      clientSecretEnv: "SPOTIFY_CLIENT_SECRET",
    };
  }

  return {
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  };
}
