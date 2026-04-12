import React, { useEffect, useRef, useState } from "react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { ClerkProvider, useAuth, useUser } from "@clerk/clerk-expo";
import { api } from "@repo/backend/convex";
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

type ConvexBootstrap = {
  client: ConvexReactClient | null;
  startupError: Error | null;
};

function resolveConvexUrlOrThrow(): { url: string; usingDevFallback: boolean } {
  const configuredConvexUrl = process.env.EXPO_PUBLIC_CONVEX_URL?.trim();

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
    `Missing ${CONVEX_URL_ENV_VAR}. Set ${CONVEX_URL_ENV_VAR} to your Convex deployment URL and restart the app.`,
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

function StartupConfigErrorScreen({ message }: { message: string }) {
  return (
    <View style={styles.configErrorContainer}>
      <Text style={styles.configErrorTitle}>Startup configuration error</Text>
      <Text style={styles.configErrorBody}>
        DayLog could not start because Convex is not configured for this build.
      </Text>
      <Text style={styles.configErrorCode}>{CONVEX_URL_ENV_VAR}</Text>
      <Text style={styles.configErrorBody}>{message}</Text>
      <Text style={styles.configErrorHint}>
        Update your app environment with a valid Convex URL and restart.
      </Text>
    </View>
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
  const startupError = convexBootstrap.startupError;
  const convexClient = convexBootstrap.client;

  if (startupError || !convexClient) {
    return (
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <StartupConfigErrorScreen
          message={
            startupError?.message ??
            "Convex client could not be initialized at startup."
          }
        />
        <StatusBar style="auto" />
      </ThemeProvider>
    );
  }

  return (
    <ClerkProvider
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
    >
      <ConvexAuthProvider client={convexClient}>
        <ThemeProvider
          value={colorScheme === "dark" ? DarkTheme : DefaultTheme}
        >
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
          <StatusBar style="auto" />
        </ThemeProvider>
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
    backgroundColor: "#fff",
    gap: 12,
  },
  configErrorTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a",
  },
  configErrorBody: {
    fontSize: 15,
    lineHeight: 22,
    color: "#334155",
  },
  configErrorCode: {
    fontSize: 14,
    fontWeight: "700",
    color: "#b91c1c",
    backgroundColor: "#fee2e2",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  configErrorHint: {
    fontSize: 13,
    lineHeight: 20,
    color: "#475569",
  },
});
