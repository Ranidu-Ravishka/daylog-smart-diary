import React, { useEffect, useRef } from "react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

import {
  ConvexReactClient,
  ConvexProviderWithAuth,
  useMutation,
} from "convex/react";

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
  const syncUser = useMutation(api.users.syncUserFromClerk);
  const lastSyncedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;

    if (lastSyncedUserId.current === user.id) return;

    const primaryEmailId = user.primaryEmailAddressId;
    const emailAddresses = user.emailAddresses;

    let email: string | undefined;
    if (emailAddresses && emailAddresses.length > 0) {
      const primary = emailAddresses.find((e) =>
        primaryEmailId
          ? e.id === primaryEmailId
          : e.id === user.primaryEmailAddressId,
      );
      email = (primary ?? emailAddresses[0]).emailAddress;
    }

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
  }, [isLoaded, isSignedIn, user, syncUser]);

  return null;
}

function ConvexAuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  return (
    <ConvexProviderWithAuth
      client={convex}
      useAuth={() => ({
        isLoading: !isLoaded,
        isAuthenticated: !!isSignedIn,
        fetchAccessToken: async ({ forceRefreshToken }) => {
          return await getToken({
            template: "convex",
            skipCache: forceRefreshToken,
          });
        },
      })}
    >
      {children}
    </ConvexProviderWithAuth>
  );
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
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            <Stack.Screen name="sign-up" options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </ConvexAuthProvider>
    </ClerkProvider>
  );
}
