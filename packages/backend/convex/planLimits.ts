export type UserPlanTier = "free" | "pro" | "team" | "enterprise";

type MemoryPlanLimits = {
  maxTitleLength: number;
  maxDescriptionLength: number;
  maxMediaPerMemory: number;
  maxMediaBytesPerFile: number;
};

type UserPlanLimits = {
  memory: MemoryPlanLimits;
};

const MB = 1024 * 1024;

const PLAN_LIMITS: Record<UserPlanTier, UserPlanLimits> = {
  free: {
    memory: {
      maxTitleLength: 120,
      maxDescriptionLength: 1600,
      maxMediaPerMemory: 8,
      maxMediaBytesPerFile: 10 * MB,
    },
  },
  pro: {
    memory: {
      maxTitleLength: 180,
      maxDescriptionLength: 4000,
      maxMediaPerMemory: 24,
      maxMediaBytesPerFile: 25 * MB,
    },
  },
  team: {
    memory: {
      maxTitleLength: 240,
      maxDescriptionLength: 8000,
      maxMediaPerMemory: 48,
      maxMediaBytesPerFile: 50 * MB,
    },
  },
  enterprise: {
    memory: {
      maxTitleLength: 300,
      maxDescriptionLength: 16000,
      maxMediaPerMemory: 100,
      maxMediaBytesPerFile: 100 * MB,
    },
  },
};

export function normalizeUserPlanTier(
  planTier: string | undefined,
): UserPlanTier {
  if (planTier === "pro") return "pro";
  if (planTier === "team") return "team";
  if (planTier === "enterprise") return "enterprise";
  return "free";
}

export function getPlanLimitsForTier(
  planTier: string | undefined,
): UserPlanLimits {
  const normalized = normalizeUserPlanTier(planTier);
  return PLAN_LIMITS[normalized];
}
