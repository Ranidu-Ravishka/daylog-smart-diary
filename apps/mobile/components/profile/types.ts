import type { ComponentProps } from "react";
import type { GenericId } from "convex/values";
import { Ionicons } from "@expo/vector-icons";

export type IoniconName = ComponentProps<typeof Ionicons>["name"];

export type ProfileSectionKey =
  | "overview"
  | "privacy"
  | "notifications"
  | "integrations"
  | "account";

export type ProfileSectionMeta = {
  key: ProfileSectionKey;
  title: string;
  subtitle: string;
  icon: IoniconName;
};

export type IntegrationDoc = {
  _id: GenericId<"integrations">;
  provider: string;
  status: "connected" | "disconnected" | "error";
  lastSyncAt?: number;
  lastError?: string;
};

export type IntegrationSyncRunDoc = {
  provider: string;
  dayKey: string;
  status: "in_progress" | "success" | "error";
  updatedAt: number;
  lastError?: string;
};

export type ProviderPendingAction = Record<
  string,
  "connect" | "disconnect" | "sync" | undefined
>;

export type IntegrationFeedback = {
  type: "success" | "error";
  message: string;
} | null;

export type AboutLink = {
  title: string;
  icon: IoniconName;
  path: string;
};

export type PreferencesSnapshot = {
  reminderType: "daily" | "weekly";
  formattedTime: string;
  focusAreas?: number[];
  theme?: string;
  defaultMemoryMood?: string;
  locationPermissionStatus?: string;
  locationLastUpdatedAt?: number;
  locationLastArea?: string;
};

export type ReminderRuntimeSnapshot = {
  permissionStatus?: string;
  deliveryEnabled?: boolean;
  scheduledCount?: number;
  error?: string;
};

export type OutboxLastSyncResult = {
  status: string;
  updatedAt: number;
  message: string;
} | null;

export type DeletionState =
  | "requested"
  | "processing"
  | "failed"
  | "completed"
  | null;
