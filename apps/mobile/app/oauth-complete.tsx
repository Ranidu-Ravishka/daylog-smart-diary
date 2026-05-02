import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { Href } from "expo-router";
import { useLocalSearchParams, Redirect } from "expo-router";
import { Typography, type ThemeColors } from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";

export default function OAuthCompleteRoute() {
  const { colors: c } = useAppTheme();
  const styles = useMemo(() => createStyles(c), [c]);
  const params = useLocalSearchParams<{
    integrationProvider?: string;
    integrationStatus?: string;
    integrationMessage?: string;
  }>();
  const redirectHref = `/(tabs)/profile?integrationProvider=${encodeURIComponent(
    params.integrationProvider ?? "provider",
  )}&integrationStatus=${encodeURIComponent(
    params.integrationStatus ?? "unknown",
  )}&integrationMessage=${encodeURIComponent(
    params.integrationMessage ??
      "OAuth flow completed but the provider did not report a status.",
  )}`;

  return (
    <>
      <Redirect href={redirectHref as Href} />
      <View style={styles.container}>
        <ActivityIndicator size="large" color={c.tint} />
        <Text style={styles.text}>Returning to DayLog…</Text>
      </View>
    </>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      backgroundColor: c.background,
    },
    text: {
      ...Typography.callout,
      color: c.textSecondary,
    },
  });
}
