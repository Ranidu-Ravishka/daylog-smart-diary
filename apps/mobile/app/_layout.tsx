import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

import { ConvexReactClient, ConvexProviderWithAuth } from "convex/react";

import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
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
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            <Stack.Screen name="sign-up" options={{ headerShown: false }} />
            <Stack.Screen
              name="modal"
              options={{ presentation: "modal", title: "Modal" }}
            />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </ConvexAuthProvider>
    </ClerkProvider>
  );
}
