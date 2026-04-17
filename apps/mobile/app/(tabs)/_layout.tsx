import { Tabs, Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "@clerk/clerk-expo";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@repo/backend/convex";
import { normalizeUserSettings } from "@repo/user-settings/lib/user-settings";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useAppTheme } from "@/components/theme-provider";
import { AppLockProvider } from "@/components/security/app-lock-provider";
import { useForegroundTasks } from "@/hooks/tab-orchestration/use-foreground-tasks";
import { useIntegrationSync } from "@/hooks/tab-orchestration/use-integration-sync";
import { useLocationTracking } from "@/hooks/tab-orchestration/use-location-tracking";
import { useOfflineQueue } from "@/hooks/tab-orchestration/use-offline-queue";

export default function TabLayout() {
  const { colors: theme } = useAppTheme();
  const { isLoaded, isSignedIn, sessionId, userId } = useAuth();
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const launchPreferences = useQuery(
    api.userPreferences.getMyUserPreferences,
    isAuthenticated ? {} : "skip",
  );
  const locationTrackingRuntimeConfig = useQuery(
    api.integrations.getMyLocationTrackingRuntimeConfig,
    isAuthenticated ? {} : "skip",
  );
  const isPreferencesLoading =
    isAuthenticated &&
    (launchPreferences === undefined ||
      locationTrackingRuntimeConfig === undefined);
  const launchUserSettings = React.useMemo(
    () => normalizeUserSettings(launchPreferences),
    [launchPreferences],
  );
  const locationTrackingEnabled = launchUserSettings.locationTrackingEnabled;
  const backgroundLocationTrackingEnabled =
    launchUserSettings.backgroundLocationTrackingEnabled;

  useOfflineQueue({
    isAuthenticated,
  });

  useForegroundTasks({
    isAuthenticated,
    launchPreferences,
  });

  useIntegrationSync({
    isAuthenticated,
    hasLaunchPreferencesRecord: launchPreferences != null,
    locationTrackingRuntimeConfig,
    fitnessTrackingEnabled: launchUserSettings.fitnessTrackingEnabled,
    calendarContextEnabled:
      launchUserSettings.calendarNotificationsTrackingEnabled,
    callSummaryEnabled: launchUserSettings.callLogsTrackingEnabled,
    moodAssistanceEnabled:
      launchUserSettings.moodDetectionFaceRecognitionEnabled,
  });

  useLocationTracking({
    isLoaded,
    isSignedIn,
    sessionId,
    userId,
    isAuthenticated,
    hasLoadedLaunchPreferences: launchPreferences !== undefined,
    locationTrackingEnabled,
    backgroundLocationTrackingEnabled,
    locationTrackingRuntimeConfig,
  });

  if (
    !isLoaded ||
    isConvexAuthLoading ||
    isPreferencesLoading ||
    (isSignedIn && !isAuthenticated)
  ) {
    return (
      <View
        style={[styles.loadingContainer, { backgroundColor: theme.background }]}
      >
        <ActivityIndicator color={theme.tint} size="large" />
      </View>
    );
  }

  if (!isSignedIn) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <ErrorBoundary>
      <AppLockProvider>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarButton: HapticTab,
            tabBarActiveTintColor: theme.tint,
            tabBarInactiveTintColor: theme.tabIconDefault,
            tabBarLabelPosition: "below-icon",
            tabBarItemStyle: {
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
            },
            tabBarIconStyle: {
              marginBottom: -3,
            },
            tabBarLabelStyle: {
              marginTop: 4,
              fontSize: 11,
              fontWeight: "500",
            },
            tabBarStyle: {
              height: 68,
              paddingTop: 6,
              paddingBottom: 6,
              backgroundColor: theme.surface,
              borderTopWidth: 0.5,
              borderTopColor: theme.divider,
            },
          }}
        >
          {/* 🔒 Hidden Quick Setup */}
          <Tabs.Screen
            name="quick-setup"
            options={{
              title: "Quick Setup",
              tabBarStyle: { display: "none" },
              tabBarButton: () => null,
            }}
          />

          <Tabs.Screen
            name="index"
            options={{
              title: "Home",
              tabBarIcon: ({ color }) => (
                <IconSymbol name="house.fill" size={26} color={color} />
              ),
            }}
          />

          <Tabs.Screen
            name="insights"
            options={{
              title: "Insights",
              tabBarIcon: ({ color }) => (
                <IconSymbol name="chart.bar.fill" size={26} color={color} />
              ),
            }}
          />

          <Tabs.Screen
            name="add-memory"
            options={{
              title: "Add",
              tabBarIcon: ({ color }) => (
                <IconSymbol name="plus.circle.fill" size={30} color={color} />
              ),
            }}
          />

          <Tabs.Screen
            name="memory"
            options={{
              title: "Memory",
              tabBarIcon: ({ color }) => (
                <IconSymbol name="book.fill" size={26} color={color} />
              ),
            }}
          />

          <Tabs.Screen
            name="profile"
            options={{
              title: "Profile",
              tabBarIcon: ({ color }) => (
                <IconSymbol name="person.fill" size={26} color={color} />
              ),
            }}
          />
        </Tabs>
      </AppLockProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
