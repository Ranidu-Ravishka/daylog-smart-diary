import React, { useEffect, useRef, useState } from "react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { ClerkProvider, useAuth, useUser } from "@clerk/clerk-expo";
import { api } from "@repo/backend/convex";
import { useColorScheme } from "@/hooks/use-color-scheme";

const defaultConvexUrl = "http://localhost:4334";
const configuredConvexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!configuredConvexUrl && !__DEV__) {
  console.error("Missing EXPO_PUBLIC_CONVEX_URL in production build.");
}

const convex = new ConvexReactClient(configuredConvexUrl ?? defaultConvexUrl);

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
      console.error("Failed to sync user to Convex", error);
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

function ConvexAuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
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

  return (
    <ClerkProvider
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
    >
      <ConvexAuthProvider>
        <ThemeProvider
          value={colorScheme === "dark" ? DarkTheme : DefaultTheme}
        >
          <SyncClerkUserToConvex />
          <RootAuthBoundary>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
});
