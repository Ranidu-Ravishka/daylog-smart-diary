import { Redirect } from "expo-router";
import { useProfileScreen } from "@/hooks/useProfileScreen";
import { ProfileScreenLayout } from "@/components/profile/profile-screen-layout";
import { ProfileScreenSkeleton } from "@/components/profile/profile-screen-skeleton";

export default function ProfileSettingsScreen() {
  const vm = useProfileScreen();

  if (vm.postIntegrationRedirect) {
    return <Redirect href="/(tabs)/profile" />;
  }

  if (vm.isLoading) {
    return <ProfileScreenSkeleton />;
  }

  const { postIntegrationRedirect: _r, isLoading: _l, ...layoutProps } = vm;
  return <ProfileScreenLayout {...layoutProps} />;
}
