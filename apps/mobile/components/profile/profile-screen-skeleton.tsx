import React from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Spacing } from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton-loader";
import { createProfileStyles } from "@/components/profile/profile-styles";

export function ProfileScreenSkeleton() {
  const { colors: c } = useAppTheme();
  const styles = React.useMemo(() => createProfileStyles(c), [c]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.scroll}>
        <Skeleton
          width={100}
          height={24}
          style={{ marginLeft: Spacing.xl, marginBottom: Spacing.xl }}
        />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={1} />
        <SkeletonCard lines={4} />
      </View>
    </SafeAreaView>
  );
}
