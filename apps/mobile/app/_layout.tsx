import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  type Theme as NavigationTheme,
} from "@react-navigation/native";
import Constants from "expo-constants";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { Redirect, Stack, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  ConvexReactClient,
  useConvexAuth,
  useMutation,
  useQuery,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { ClerkProvider, useAuth, useUser } from "@clerk/clerk-expo";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { api } from "@repo/backend/convex";
import { MotionTokens } from "@/constants/motion";
import { Colors, Typography } from "@/constants/theme";
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
void SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: "(tabs)",
};

const ACCOUNT_DELETION_STATUS_QUERY_ARGS = { pollToken: 0 } as const;

function SyncClerkUserToConvex() {
  const { isLoaded, isSignedIn, sessionId } = useAuth();
  const { user } = useUser();
  const { isAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const syncUser = useMutation(api.users.syncUserFromClerk);
  const lastSyncedIdentity = useRef<string | null>(null);

  const syncPayload = useMemo(() => {
    if (!isLoaded || !isSignedIn || !user) {
      return null;
    }

    if (isConvexAuthLoading || !isAuthenticated) {
      return null;
    }

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

    if (!email) {
      return null;
    }

    return {
      syncIdentity: `${user.id}:${sessionId ?? "no-session"}`,
      payload: {
        clerkUserId: user.id,
        email,
        firstName: user.firstName ?? undefined,
        lastName: user.lastName ?? undefined,
        imageUrl: user.imageUrl ?? undefined,
      },
    };
  }, [
    isAuthenticated,
    isConvexAuthLoading,
    isLoaded,
    isSignedIn,
    sessionId,
    user,
  ]);

  useEffect(() => {
    if (!syncPayload) {
      return;
    }

    if (lastSyncedIdentity.current === syncPayload.syncIdentity) {
      return;
    }

    lastSyncedIdentity.current = syncPayload.syncIdentity;

    syncUser(syncPayload.payload).catch((error) => {
      captureException("mobile_sync_user_to_convex_failed", error, {
        clerkUserId: syncPayload.payload.clerkUserId,
      });
    });
  }, [syncPayload, syncUser]);

  return null;
}

function AuthBootstrapProblemScreen({
  title,
  message,
  buttonLabel,
  onButtonPress,
}: {
  title: string;
  message: string;
  buttonLabel: string;
  onButtonPress: () => void | Promise<void>;
}) {
  const { colors } = useAppTheme();

  return (
    <View
      style={[
        styles.bootstrapProblemContainer,
        { backgroundColor: colors.background },
      ]}
    >
      <Text style={[styles.bootstrapProblemTitle, { color: colors.text }]}>
        {title}
      </Text>
      <Text
        style={[styles.bootstrapProblemBody, { color: colors.textSecondary }]}
      >
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onButtonPress}
        style={({ pressed }) => [
          styles.bootstrapProblemButton,
          {
            backgroundColor: colors.tint,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={styles.bootstrapProblemButtonText}>{buttonLabel}</Text>
      </Pressable>
    </View>
  );
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
  const { isDark, colors } = useAppTheme();
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const previousBackground = useRef(colors.background);
  const [overlayColor, setOverlayColor] = useState(colors.background);

  useEffect(() => {
    const nextOverlayColor = previousBackground.current;

    setOverlayColor((currentOverlayColor) =>
      currentOverlayColor === nextOverlayColor
        ? currentOverlayColor
        : nextOverlayColor,
    );
    previousBackground.current = colors.background;
    overlayOpacity.setValue(1);
    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: MotionTokens.duration.themeTransition,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [colors.background, overlayOpacity]);

  const navigationTheme = useMemo<NavigationTheme>(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        primary: colors.tint,
        notification: colors.tint,
      },
    }),
    [
      colors.background,
      colors.border,
      colors.surface,
      colors.text,
      colors.tint,
      isDark,
    ],
  );

  return (
    <ThemeProvider value={navigationTheme}>
      <View
        style={[
          styles.themedShellContainer,
          { backgroundColor: colors.background },
        ]}
      >
        {children}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: overlayColor, opacity: overlayOpacity },
          ]}
        />
      </View>
      <StatusBar style={isDark ? "light" : "dark"} />
    </ThemeProvider>
  );
}

function RootAuthBoundary({ children }: { children: React.ReactNode }) {
  const segments = useSegments();
  const { isLoaded, isSignedIn, signOut, userId } = useAuth();
  const { isAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const canQueryAccountDeletion =
    isLoaded && isSignedIn && isAuthenticated && !isConvexAuthLoading;
  const accountDeletionQueryArgs = canQueryAccountDeletion
    ? ACCOUNT_DELETION_STATUS_QUERY_ARGS
    : "skip";
  const accountDeletionStatus = useQuery(
    api.users.getMyAccountDeletionStatus,
    accountDeletionQueryArgs,
  );
  const accountDeletionAccountStatus = accountDeletionStatus?.accountStatus;
  const ensureUserExists = useMutation(api.users.ensureUserExists);
  const [bootstrapState, setBootstrapState] = useState<
    "loading" | "ready" | "blocked" | "error"
  >("loading");
  const ensuredUserKey = useRef<string | null>(null);

  const isAuthRoute = segments[0] === "(auth)";
  const updateBootstrapState = useCallback(
    (nextState: "loading" | "ready" | "blocked" | "error") => {
      setBootstrapState((currentState) =>
        currentState === nextState ? currentState : nextState,
      );
    },
    [],
  );

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      return;
    }

    if (isConvexAuthLoading || !isAuthenticated) {
      updateBootstrapState("loading");
      return;
    }

    if (accountDeletionAccountStatus === undefined) {
      updateBootstrapState("loading");
      return;
    }

    const shouldHardBlockDeletionUi =
      accountDeletionStatus?.inProgress === true ||
      accountDeletionStatus?.retryable === true ||
      (accountDeletionAccountStatus === "deletion_requested" &&
        accountDeletionStatus?.canDeleteClerkAccount !== true);

    if (shouldHardBlockDeletionUi) {
      updateBootstrapState("blocked");
      return;
    }

    const bootstrapKey = userId ?? "signed-in";
    if (ensuredUserKey.current === bootstrapKey) {
      updateBootstrapState("ready");
      return;
    }

    let isCancelled = false;
    ensuredUserKey.current = bootstrapKey;
    updateBootstrapState("loading");

    void ensureUserExists()
      .then((result) => {
        if (isCancelled) {
          return;
        }

        if (result.blocked) {
          updateBootstrapState("blocked");
          return;
        }

        updateBootstrapState("ready");
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        captureException("mobile_ensure_user_exists_failed", error, {
          clerkUserId: userId ?? undefined,
        });
        updateBootstrapState("error");
      });

    return () => {
      isCancelled = true;
    };
  }, [
    ensureUserExists,
    isAuthenticated,
    isConvexAuthLoading,
    isLoaded,
    isSignedIn,
    accountDeletionAccountStatus,
    accountDeletionStatus?.canDeleteClerkAccount,
    accountDeletionStatus?.inProgress,
    accountDeletionStatus?.retryable,
    userId,
    updateBootstrapState,
  ]);

  if (!isLoaded) {
    return null;
  }

  if (!isSignedIn && !isAuthRoute) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (isSignedIn && isAuthRoute) {
    // Send onboarding through quick-setup; that screen redirects home when prefs exist.
    // Avoid imperative /quick-setup from auth screens (races with this redirect and can
    // dispatch a nested REPLACE to "(tabs)" before the tab navigator is mounted).
    return <Redirect href="/(tabs)/quick-setup" />;
  }

  if (!isSignedIn) {
    return <>{children}</>;
  }

  if (bootstrapState === "loading") {
    return (
      <View style={styles.authLoadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (bootstrapState === "blocked") {
    return (
      <AuthBootstrapProblemScreen
        title="Account deletion in progress"
        message="This account is being removed. Sign out to continue with another account."
        buttonLabel="Sign out"
        onButtonPress={async () => {
          await signOut();
        }}
      />
    );
  }

  if (bootstrapState === "error") {
    return (
      <AuthBootstrapProblemScreen
        title="Unable to finish account bootstrap"
        message="DayLog could not prepare your user record yet. Try signing out and back in."
        buttonLabel="Sign out"
        onButtonPress={async () => {
          await signOut();
        }}
      />
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const startupError =
    convexBootstrap.startupError ?? clerkBootstrap.startupError;
  const convexClient = convexBootstrap.client;
  const clerkPublishableKey = clerkBootstrap.publishableKey;

  useEffect(() => {
    if (fontsLoaded) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

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
    ...Typography.h2,
  },
  configErrorBody: {
    ...Typography.bodySmall,
  },
  configErrorCode: {
    ...Typography.label,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  configErrorHint: {
    ...Typography.caption,
  },
  bootstrapProblemContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  bootstrapProblemTitle: {
    ...Typography.h3,
    textAlign: "center",
  },
  bootstrapProblemBody: {
    ...Typography.bodySmall,
    textAlign: "center",
    maxWidth: 320,
  },
  bootstrapProblemButton: {
    marginTop: 8,
    minWidth: 140,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: "center",
  },
  bootstrapProblemButtonText: {
    color: Colors.light.inverseText,
    ...Typography.button,
  },
  themedShellContainer: {
    flex: 1,
  },
});
