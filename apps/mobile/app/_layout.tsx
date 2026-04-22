import React, { useEffect, useRef, useState } from "react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { ClerkProvider, useAuth, useUser } from "@clerk/clerk-expo";
import { api } from "@repo/backend/convex";
import { Colors } from "@/constants/theme";
import { AppThemeProvider, useAppTheme } from "@/components/theme-provider";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  captureException,
  initCrashReporting,
  logWarn,
} from "@/lib/observability";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

initCrashReporting();

const DEV_FALLBACK_CONVEX_URL = "http://localhost:4334";
const CONVEX_URL_ENV_VAR = "EXPO_PUBLIC_CONVEX_URL";
const CONVEX_URL_ENV_ALIASES = ["NEXT_PUBLIC_CONVEX_URL", "CONVEX_URL"];
const CONVEX_URL_CONFIG_KEY = "expo.extra.convexUrl";
const CLERK_PUBLISHABLE_KEY_ENV_VAR = "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY";

type ConvexBootstrap = {
  client: ConvexReactClient | null;
  startupError: Error | null;
};

type ClerkBootstrap = {
  publishableKey: string | null;
  startupError: Error | null;
};

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveConvexUrlOrThrow(): { url: string; usingDevFallback: boolean } {
  const configuredConvexUrl =
    toOptionalString(process.env.EXPO_PUBLIC_CONVEX_URL) ||
    toOptionalString(Constants.expoConfig?.extra?.convexUrl) ||
    toOptionalString(process.env.NEXT_PUBLIC_CONVEX_URL) ||
    toOptionalString(process.env.CONVEX_URL);

  if (configuredConvexUrl) {
    return {
      url: configuredConvexUrl,
      usingDevFallback: false,
    };
  }

  if (__DEV__) {
    return {
      url: DEV_FALLBACK_CONVEX_URL,
      usingDevFallback: true,
    };
  }

  throw new Error(
    `Missing Convex URL configuration. Set ${CONVEX_URL_ENV_VAR} (or ${CONVEX_URL_ENV_ALIASES.join(", ")}) or ${CONVEX_URL_CONFIG_KEY} to your Convex deployment URL and restart the app.`,
  );
}

function bootstrapConvexClient(): ConvexBootstrap {
  try {
    const resolved = resolveConvexUrlOrThrow();

    if (resolved.usingDevFallback) {
      logWarn("mobile_startup_missing_convex_url_using_dev_fallback", {
        envName: CONVEX_URL_ENV_VAR,
        fallbackUrl: DEV_FALLBACK_CONVEX_URL,
      });
    }

    return {
      client: new ConvexReactClient(resolved.url),
      startupError: null,
    };
  } catch (error) {
    const startupError =
      error instanceof Error
        ? error
        : new Error("Unexpected startup misconfiguration.");

    captureException("mobile_startup_convex_bootstrap_failed", startupError, {
      envName: CONVEX_URL_ENV_VAR,
    });

    return {
      client: null,
      startupError,
    };
  }
}

const convexBootstrap = bootstrapConvexClient();

function resolveClerkPublishableKeyOrThrow(): string {
  const publishableKey = toOptionalString(
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );

  if (!publishableKey) {
    throw new Error(
      `Missing Clerk publishable key. Set ${CLERK_PUBLISHABLE_KEY_ENV_VAR} and restart the app.`,
    );
  }

  return publishableKey;
}

function bootstrapClerkKey(): ClerkBootstrap {
  try {
    return {
      publishableKey: resolveClerkPublishableKeyOrThrow(),
      startupError: null,
    };
  } catch (error) {
    const startupError =
      error instanceof Error
        ? error
        : new Error("Unexpected Clerk startup misconfiguration.");

    captureException("mobile_startup_clerk_bootstrap_failed", startupError, {
      envName: CLERK_PUBLISHABLE_KEY_ENV_VAR,
    });

    return {
      publishableKey: null,
      startupError,
    };
  }
}

const clerkBootstrap = bootstrapClerkKey();

export const unstable_settings = {
  anchor: "(tabs)",
};

function SyncClerkUserToConvex() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { isAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const syncUser = useMutation(api.users.syncUserFromClerk);
  const lastSyncedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    if (isConvexAuthLoading || !isAuthenticated) return;
    if (lastSyncedUserId.current === user.id) return;

    const primaryEmailId = user.primaryEmailAddressId;
    const emailAddresses = user.emailAddresses;

    const email =
      emailAddresses && emailAddresses.length > 0
        ? (
            emailAddresses.find((e) =>
              primaryEmailId ? e.id === primaryEmailId : false,
            ) ?? emailAddresses[0]
          )?.emailAddress
        : undefined;

    if (!email) return;

    syncUser({
      clerkUserId: user.id,
      email,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
      imageUrl: user.imageUrl ?? undefined,
    }).catch((error) => {
      captureException("mobile_sync_user_to_convex_failed", error, {
        clerkUserId: user.id,
      });
    });

    lastSyncedUserId.current = user.id;
  }, [
    isLoaded,
    isSignedIn,
    user,
    syncUser,
    isAuthenticated,
    isConvexAuthLoading,
  ]);

  return null;
}

function ConvexAuthProvider({
  children,
  client,
}: {
  children: React.ReactNode;
  client: ConvexReactClient;
}) {
  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}

function StartupConfigErrorScreen({
  message,
  isDark,
}: {
  message: string;
  isDark: boolean;
}) {
  const theme = Colors[isDark ? "dark" : "light"];

  return (
    <View
      style={[
        styles.configErrorContainer,
        { backgroundColor: theme.background },
      ]}
    >
      <Text style={[styles.configErrorTitle, { color: theme.text }]}>
        Startup configuration error
      </Text>
      <Text style={[styles.configErrorBody, { color: theme.textSecondary }]}>
        DayLog could not start because Convex is not configured for this build.
      </Text>
      <Text
        style={[
          styles.configErrorCode,
          {
            color: theme.error,
            backgroundColor: theme.errorLight,
          },
        ]}
      >
        {CONVEX_URL_ENV_VAR}
      </Text>
      <Text style={[styles.configErrorBody, { color: theme.textSecondary }]}>
        {message}
      </Text>
      <Text style={[styles.configErrorHint, { color: theme.textTertiary }]}>
        Update your app environment with a valid Convex URL and restart.
      </Text>
    </View>
  );
}

function AppThemedShell({ children }: { children: React.ReactNode }) {
  const { isDark } = useAppTheme();

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      {children}
      <StatusBar style={isDark ? "light" : "dark"} />
    </ThemeProvider>
  );
}

function RootAuthBoundary({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { isLoaded, isSignedIn } = useAuth();
  const [isRouteReady, setIsRouteReady] = useState(false);

  const isAuthRoute = segments[0] === "(auth)";

  useEffect(() => {
    if (!isLoaded) {
      setIsRouteReady(false);
      return;
    }

    if (!isSignedIn) {
      if (!isAuthRoute) {
        setIsRouteReady(false);
        router.replace("/sign-in");
        return;
      }

      setIsRouteReady(true);
      return;
    }

    if (isAuthRoute) {
      setIsRouteReady(false);
      router.replace("/(tabs)");
      return;
    }

    setIsRouteReady(true);
  }, [isLoaded, isSignedIn, isAuthRoute, router]);

  if (!isLoaded || !isRouteReady) {
    return (
      <View style={styles.authLoadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const startupError =
    convexBootstrap.startupError ?? clerkBootstrap.startupError;
  const convexClient = convexBootstrap.client;
  const clerkPublishableKey = clerkBootstrap.publishableKey;

  if (startupError || !convexClient || !clerkPublishableKey) {
    const isDark = colorScheme === "dark";

    return (
      <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
        <StartupConfigErrorScreen
          isDark={isDark}
          message={
            startupError?.message ??
            "Convex client could not be initialized at startup."
          }
        />
        <StatusBar style={isDark ? "light" : "dark"} />
      </ThemeProvider>
    );
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ConvexAuthProvider client={convexClient}>
        <AppThemeProvider>
          <AppThemedShell>
            <SyncClerkUserToConvex />
            <RootAuthBoundary>
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="oauth-complete"
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="(auth)/sign-in"
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="(auth)/sign-up"
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="(auth)/forgot-password"
                  options={{ headerShown: false }}
                />
              </Stack>
            </RootAuthBoundary>
          </AppThemedShell>
        </AppThemeProvider>
      </ConvexAuthProvider>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  authLoadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  configErrorContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "center",
    gap: 12,
  },
  configErrorTitle: {
    fontSize: 24,
    fontWeight: "700",
  },
  configErrorBody: {
    fontSize: 15,
    lineHeight: 22,
  },
  configErrorCode: {
    fontSize: 14,
    fontWeight: "700",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  configErrorHint: {
    fontSize: 13,
    lineHeight: 20,
  },
});
