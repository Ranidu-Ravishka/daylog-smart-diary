import { Tabs, Redirect } from "expo-router";
import React from "react";

import { useAuth } from "@clerk/clerk-expo";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { isSignedIn } = useAuth();

  if (!isSignedIn) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: Colors[colorScheme ?? "light"].tint,
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
          borderTopWidth: 0.5,
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
  );
}
