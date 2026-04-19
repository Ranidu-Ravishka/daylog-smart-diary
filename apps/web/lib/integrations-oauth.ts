type OAuthCredentialSource = "google" | "spotify";

export type OAuthTokenExchangeMode = "form_urlencoded" | "basic_json";

type OAuthProviderBaseConfig = {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
  credentialSource: OAuthCredentialSource;
  authQueryParams?: Readonly<Record<string, string>>;
  tokenExchangeMode: OAuthTokenExchangeMode;
};

type OAuthProviderConfig = {
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  credentialSource: OAuthCredentialSource;
  authQueryParams?: Readonly<Record<string, string>>;
  tokenExchangeMode: OAuthTokenExchangeMode;
};

const OAUTH_PROVIDER_CONFIGS = {
  google_calendar: {
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
  },
  google_fit: {
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
  },
  gmail_summary: {
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
  },
  spotify: {
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
  },
} as const satisfies Record<string, OAuthProviderBaseConfig>;

export type OAuthProvider = keyof typeof OAUTH_PROVIDER_CONFIGS;

export const OAUTH_PROVIDERS: OAuthProvider[] = Object.keys(
  OAUTH_PROVIDER_CONFIGS,
) as OAuthProvider[];

function getOAuthCredentialEnvNames(source: OAuthCredentialSource): {
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

function isPlaceholderCredential(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;

  if (
    normalized === "changeme" ||
    normalized === "replace-me" ||
    normalized === "replace_this" ||
    normalized === "replace-this"
  ) {
    return true;
  }

  return (
    normalized.startsWith("your_") ||
    normalized.startsWith("your-") ||
    normalized.includes("placeholder") ||
    normalized.includes("example") ||
    normalized.includes("<")
  );
}

function readOAuthCredential(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) return "";
  if (isPlaceholderCredential(value)) return "";
  return value;
}

export function isOAuthProvider(provider: string): provider is OAuthProvider {
  return OAUTH_PROVIDERS.includes(provider as OAuthProvider);
}

export function getOAuthProviderConfig(
  provider: OAuthProvider,
): OAuthProviderConfig {
  const base = OAUTH_PROVIDER_CONFIGS[provider];
  const { clientIdEnv, clientSecretEnv } = getOAuthCredentialEnvNames(
    base.credentialSource,
  );

  return {
    authorizationUrl: base.authorizationUrl,
    tokenUrl: base.tokenUrl,
    clientId: readOAuthCredential(clientIdEnv),
    clientSecret: readOAuthCredential(clientSecretEnv),
    scopes: [...base.scopes],
    credentialSource: base.credentialSource,
    authQueryParams:
      "authQueryParams" in base ? base.authQueryParams : undefined,
    tokenExchangeMode: base.tokenExchangeMode,
  };
}

export function getAppBaseUrl(requestOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured && configured.trim().length > 0) {
    return configured.replace(/\/$/, "");
  }
  return requestOrigin.replace(/\/$/, "");
}

export function safeReturnPath(candidate: string | null): string {
  if (!candidate || !candidate.startsWith("/")) {
    return "/dashboard/settings";
  }
  if (candidate.startsWith("//")) {
    return "/dashboard/settings";
  }
  return candidate;
}
