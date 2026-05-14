import { useAuth } from "@clerk/clerk-expo";
import {
  useAction,
  useConvex,
  useMutation,
  useQuery,
  useConvexAuth,
} from "convex/react";
import { useState } from "react";
import type { GenericId } from "convex/values";
import { api } from "@repo/backend/convex";
import type {
  IntegrationDoc,
  IntegrationHealthSnapshot,
  IntegrationSyncRunDoc,
} from "@/components/profile/types";
import { getTodayDayKey } from "@/lib/profile-screen-helpers";

/**
 * Convex queries, mutations, and account-deletion poll state for the profile
 * settings screen. Keeps API wiring in one place without changing behavior.
 */
export function useProfileConvexResources() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const todayDayKey = getTodayDayKey();
  const canUseIntegrationApis = isLoaded && isSignedIn && isAuthenticated;

  const [deletionPollToken, setDeletionPollToken] = useState(0);
  const [trackedDeletionJobId, setTrackedDeletionJobId] = useState<
    GenericId<"userDeletionJobs"> | undefined
  >(undefined);

  const supportedProviders = useQuery(
    api.integrations.listSupportedProviders,
    canUseIntegrationApis ? {} : "skip",
  );
  const integrations = useQuery(
    api.integrations.listMyIntegrations,
    canUseIntegrationApis ? {} : "skip",
  ) as IntegrationDoc[] | undefined;
  const integrationHealthSnapshots = useQuery(
    api.integrationHealth.listMyIntegrationHealth,
    isAuthenticated ? {} : "skip",
  ) as IntegrationHealthSnapshot[] | undefined;
  const syncRuns = useQuery(
    api.integrations.listMyIntegrationSyncRunsForDay,
    canUseIntegrationApis ? { dayKey: todayDayKey } : "skip",
  ) as IntegrationSyncRunDoc[] | undefined;
  const preferences = useQuery(
    api.userPreferences.getMyUserPreferences,
    isAuthenticated ? {} : "skip",
  );
  const locationTrackingRuntimeConfig = useQuery(
    api.integrations.getMyLocationTrackingRuntimeConfig,
    canUseIntegrationApis ? {} : "skip",
  );
  const convexClient = useConvex();
  const connectIntegration = useMutation(api.integrations.connectIntegration);
  const beginOAuthMobileHandoff = useMutation(
    api.integrations.beginOAuthMobileHandoff,
  );
  const disconnectIntegration = useMutation(
    api.integrations.disconnectIntegration,
  );
  const syncUserPreferences = useMutation(
    api.userPreferences.syncMyUserPreferences,
  );
  const syncMyIntegrationForDay = useAction(
    api.integrations.syncMyIntegrationForDay,
  );
  const syncAppleHealthDailyData = useMutation(
    api.integrations.syncAppleHealthDailyData,
  );
  const upsertMyIntegrationDailyData = useMutation(
    api.integrations.upsertMyIntegrationDailyData,
  );
  const updateMyLocationTrackingState = useMutation(
    api.userPreferences.updateMyLocationTrackingState,
  );
  const requestAccountDeletion = useMutation(api.users.requestAccountDeletion);
  const accountDeletionStatus = useQuery(
    api.users.getMyAccountDeletionStatus,
    isAuthenticated
      ? { pollToken: deletionPollToken, jobId: trackedDeletionJobId }
      : "skip",
  );
  const currentProfile = useQuery(
    api.users.getMyProfile,
    isAuthenticated ? {} : "skip",
  );
  const generateProfileImageUploadUrl = useMutation(
    api.users.generateProfileImageUploadUrl,
  );
  const setProfileImageFromUpload = useMutation(
    api.users.setProfileImageFromUpload,
  );
  const setProfileImageFromProvider = useMutation(
    api.users.setProfileImageFromProvider,
  );
  const clearManualProfileImage = useMutation(
    api.users.clearManualProfileImage,
  );

  return {
    isAuthLoading,
    isAuthenticated,
    todayDayKey,
    canUseIntegrationApis,
    deletionPollToken,
    setDeletionPollToken,
    trackedDeletionJobId,
    setTrackedDeletionJobId,
    supportedProviders,
    integrations,
    integrationHealthSnapshots,
    syncRuns,
    preferences,
    locationTrackingRuntimeConfig,
    convexClient,
    connectIntegration,
    beginOAuthMobileHandoff,
    disconnectIntegration,
    syncUserPreferences,
    syncMyIntegrationForDay,
    syncAppleHealthDailyData,
    upsertMyIntegrationDailyData,
    updateMyLocationTrackingState,
    requestAccountDeletion,
    accountDeletionStatus,
    currentProfile,
    generateProfileImageUploadUrl,
    setProfileImageFromUpload,
    setProfileImageFromProvider,
    clearManualProfileImage,
  };
}
