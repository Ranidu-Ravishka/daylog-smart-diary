type OAuthProvider = "google_calendar" | "google_fit" | "spotify";

type OAuthProviderConfig = {
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  tokenAudience?: string;
};

export const OAUTH_PROVIDERS: OAuthProvider[] = [
  "google_calendar",
  "google_fit",
  "spotify",
];

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
  switch (provider) {
    case "google_calendar": {
      const clientId = readOAuthCredential("GOOGLE_CLIENT_ID");
      const clientSecret = readOAuthCredential("GOOGLE_CLIENT_SECRET");
      return {
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        clientId,
        clientSecret,
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      };
    }
    case "google_fit": {
      const clientId = readOAuthCredential("GOOGLE_CLIENT_ID");
      const clientSecret = readOAuthCredential("GOOGLE_CLIENT_SECRET");
      return {
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        clientId,
        clientSecret,
        scopes: [
          "https://www.googleapis.com/auth/fitness.activity.read",
          "https://www.googleapis.com/auth/fitness.sleep.read",
        ],
      };
    }
    case "spotify": {
      const clientId = readOAuthCredential("SPOTIFY_CLIENT_ID");
      const clientSecret = readOAuthCredential("SPOTIFY_CLIENT_SECRET");
      return {
        authorizationUrl: "https://accounts.spotify.com/authorize",
        tokenUrl: "https://accounts.spotify.com/api/token",
        clientId,
        clientSecret,
        scopes: [
          "user-read-recently-played",
          "user-top-read",
          "user-read-playback-state",
        ],
        tokenAudience: "spotify",
      };
    }
    default:
      throw new Error("Unsupported OAuth provider");
  }
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
