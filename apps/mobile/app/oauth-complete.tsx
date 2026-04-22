import { useEffect, useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Typography, type ThemeColors } from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";

export default function OAuthCompleteRoute() {
  const { colors: c } = useAppTheme();
  const styles = useMemo(() => createStyles(c), [c]);
  const router = useRouter();
  const params = useLocalSearchParams<{
    integrationProvider?: string;
    integrationStatus?: string;
    integrationMessage?: string;
  }>();

  useEffect(() => {
    const timeout = setTimeout(() => {
      // NOTE: Default to "unknown" (never "success") when the redirect omits
      // the status field. The profile screen treats anything other than an
      // explicit "success" as a failure. Fabricating "success" here would
      // mask broken upstream redirects and produce ghost integrations.
      router.replace({
        pathname: "/(tabs)/profile",
        params: {
          integrationProvider: params.integrationProvider ?? "provider",
          integrationStatus: params.integrationStatus ?? "unknown",
          integrationMessage:
            params.integrationMessage ??
            "OAuth flow completed but the provider did not report a status.",
        },
      });
    }, 120);

    return () => clearTimeout(timeout);
  }, [
    params.integrationMessage,
    params.integrationProvider,
    params.integrationStatus,
    router,
  ]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={c.tint} />
      <Text style={styles.text}>Returning to DayLog…</Text>
    </View>
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
