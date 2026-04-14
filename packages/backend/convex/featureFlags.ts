import { v } from "convex/values";
import { type Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireAdmin, requireUser } from "./authz";

export const FEATURE_FLAG_KEYS = [
  "aiSummaryEnabled",
  "backgroundTrackingEnabled",
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

const featureFlagKeyValidator = v.union(
  v.literal("aiSummaryEnabled"),
  v.literal("backgroundTrackingEnabled"),
);

export const FEATURE_FLAG_ENVIRONMENTS = [
  "development",
  "staging",
  "production",
] as const;

export type FeatureFlagEnvironment = (typeof FEATURE_FLAG_ENVIRONMENTS)[number];

type FeatureFlagIdentity = {
  userId: Id<"user"> | string;
  clerkUserId: string;
};

type FeatureFlagStoredDoc = {
  _id: Id<"featureFlags">;
  key: string;
  description?: string;
  defaultEnabled: boolean;
  rolloutPercentage: number;
  killSwitch: boolean;
  enabledInDevelopment?: boolean;
  enabledInStaging?: boolean;
  enabledInProduction?: boolean;
  includeClerkUserIds?: string[];
  excludeClerkUserIds?: string[];
  createdAt: number;
  updatedAt: number;
  updatedByUserId?: Id<"user">;
};

type FeatureFlagDefaultConfig = {
  description: string;
  defaultEnabled: boolean;
  rolloutPercentage: number;
  enabledInDevelopment: boolean;
  enabledInStaging: boolean;
  enabledInProduction: boolean;
  includeClerkUserIds: string[];
  excludeClerkUserIds: string[];
};

type FeatureFlagResolvedConfig = {
  key: FeatureFlagKey;
  description: string;
  defaultEnabled: boolean;
  killSwitch: boolean;
  rolloutPercentage: number;
  enabledInDevelopment: boolean;
  enabledInStaging: boolean;
  enabledInProduction: boolean;
  includeClerkUserIds: string[];
  excludeClerkUserIds: string[];
  source: "default" | "db";
  updatedAt?: number;
  updatedByUserId?: Id<"user">;
};

type FeatureFlagReason =
  | "kill_switch"
  | "explicit_exclusion"
  | "explicit_inclusion"
  | "environment_disabled"
  | "global_disabled"
  | "rollout_disabled"
  | "fully_enabled"
  | "rollout_match"
  | "rollout_miss";

export type FeatureFlagEvaluation = {
  key: FeatureFlagKey;
  enabled: boolean;
  reason: FeatureFlagReason;
  environment: FeatureFlagEnvironment;
  rolloutPercentage: number;
  rolloutBucket: number | null;
  killSwitch: boolean;
};

const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, FeatureFlagDefaultConfig> =
  {
    aiSummaryEnabled: {
      description: "Controls AI summary generation endpoints and jobs.",
      defaultEnabled: true,
      rolloutPercentage: 100,
      enabledInDevelopment: true,
      enabledInStaging: true,
      enabledInProduction: true,
      includeClerkUserIds: [],
      excludeClerkUserIds: [],
    },
    backgroundTrackingEnabled: {
      description:
        "Controls controlled background location tracking availability.",
      defaultEnabled: true,
      rolloutPercentage: 100,
      enabledInDevelopment: true,
      enabledInStaging: true,
      enabledInProduction: true,
      includeClerkUserIds: [],
      excludeClerkUserIds: [],
    },
  };

function asFeatureFlagKey(value: string): FeatureFlagKey | null {
  if ((FEATURE_FLAG_KEYS as readonly string[]).includes(value)) {
    return value as FeatureFlagKey;
  }
  return null;
}

function clampRolloutPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeClerkUserIds(values?: string[]): string[] {
  if (!values || values.length === 0) return [];

  const deduped = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    deduped.add(normalized);
    if (deduped.size >= 200) break;
  }

  return [...deduped];
}

function normalizeEnvironmentValue(
  raw: string | undefined,
): FeatureFlagEnvironment | null {
  if (!raw) return null;

  const value = raw.trim().toLowerCase();
  if (!value) return null;

  if (
    value.includes("staging") ||
    value.includes("stage") ||
    value.includes("preview") ||
    value.includes("preprod") ||
    value.includes("qa")
  ) {
    return "staging";
  }

  if (
    value.includes("production") ||
    value.includes("prod") ||
    value === "live"
  ) {
    return "production";
  }

  if (
    value.includes("development") ||
    value.includes("dev") ||
    value.includes("local") ||
    value.includes("test")
  ) {
    return "development";
  }

  return null;
}

export function getCurrentFeatureFlagEnvironment(): FeatureFlagEnvironment {
  const candidates = [
    process.env.DAYLOG_APP_ENV,
    process.env.APP_ENV,
    process.env.DEPLOY_ENV,
    process.env.VERCEL_ENV,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeEnvironmentValue(candidate);
    if (normalized) return normalized;
  }

  if (process.env.NODE_ENV?.trim().toLowerCase() === "production") {
    return "production";
  }

  return "development";
}

function computeRolloutBucket(key: FeatureFlagKey, userId: string): number {
  const seed = `${key}:${userId}`;
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 1_000_003;
  }

  return hash % 100;
}

function mergeFlagConfig(
  key: FeatureFlagKey,
  stored: FeatureFlagStoredDoc | undefined,
): FeatureFlagResolvedConfig {
  const defaults = FEATURE_FLAG_DEFAULTS[key];

  return {
    key,
    description: stored?.description?.trim() || defaults.description,
    defaultEnabled: stored?.defaultEnabled ?? defaults.defaultEnabled,
    killSwitch: stored?.killSwitch ?? false,
    rolloutPercentage: clampRolloutPercentage(
      stored?.rolloutPercentage ?? defaults.rolloutPercentage,
    ),
    enabledInDevelopment:
      stored?.enabledInDevelopment ?? defaults.enabledInDevelopment,
    enabledInStaging: stored?.enabledInStaging ?? defaults.enabledInStaging,
    enabledInProduction:
      stored?.enabledInProduction ?? defaults.enabledInProduction,
    includeClerkUserIds: normalizeClerkUserIds(
      stored?.includeClerkUserIds ?? defaults.includeClerkUserIds,
    ),
    excludeClerkUserIds: normalizeClerkUserIds(
      stored?.excludeClerkUserIds ?? defaults.excludeClerkUserIds,
    ),
    source: stored ? "db" : "default",
    updatedAt: stored?.updatedAt,
    updatedByUserId: stored?.updatedByUserId,
  };
}

function getEnvironmentEnabled(
  config: FeatureFlagResolvedConfig,
  environment: FeatureFlagEnvironment,
): boolean {
  if (environment === "development") return config.enabledInDevelopment;
  if (environment === "staging") return config.enabledInStaging;
  return config.enabledInProduction;
}

function evaluateFlag(
  config: FeatureFlagResolvedConfig,
  environment: FeatureFlagEnvironment,
  identity: FeatureFlagIdentity,
): FeatureFlagEvaluation {
  if (config.killSwitch) {
    return {
      key: config.key,
      enabled: false,
      reason: "kill_switch",
      environment,
      rolloutPercentage: config.rolloutPercentage,
      rolloutBucket: null,
      killSwitch: true,
    };
  }

  const excluded = config.excludeClerkUserIds.includes(identity.clerkUserId);
  if (excluded) {
    return {
      key: config.key,
      enabled: false,
      reason: "explicit_exclusion",
      environment,
      rolloutPercentage: config.rolloutPercentage,
      rolloutBucket: null,
      killSwitch: false,
    };
  }

  const included = config.includeClerkUserIds.includes(identity.clerkUserId);
  if (included) {
    return {
      key: config.key,
      enabled: true,
      reason: "explicit_inclusion",
      environment,
      rolloutPercentage: config.rolloutPercentage,
      rolloutBucket: null,
      killSwitch: false,
    };
  }

  if (!getEnvironmentEnabled(config, environment)) {
    return {
      key: config.key,
      enabled: false,
      reason: "environment_disabled",
      environment,
      rolloutPercentage: config.rolloutPercentage,
      rolloutBucket: null,
      killSwitch: false,
    };
  }

  if (!config.defaultEnabled) {
    return {
      key: config.key,
      enabled: false,
      reason: "global_disabled",
      environment,
      rolloutPercentage: config.rolloutPercentage,
      rolloutBucket: null,
      killSwitch: false,
    };
  }

  if (config.rolloutPercentage <= 0) {
    return {
      key: config.key,
      enabled: false,
      reason: "rollout_disabled",
      environment,
      rolloutPercentage: config.rolloutPercentage,
      rolloutBucket: null,
      killSwitch: false,
    };
  }

  if (config.rolloutPercentage >= 100) {
    return {
      key: config.key,
      enabled: true,
      reason: "fully_enabled",
      environment,
      rolloutPercentage: config.rolloutPercentage,
      rolloutBucket: null,
      killSwitch: false,
    };
  }

  const rolloutBucket = computeRolloutBucket(
    config.key,
    String(identity.userId),
  );
  const enabled = rolloutBucket < config.rolloutPercentage;

  return {
    key: config.key,
    enabled,
    reason: enabled ? "rollout_match" : "rollout_miss",
    environment,
    rolloutPercentage: config.rolloutPercentage,
    rolloutBucket,
    killSwitch: false,
  };
}

async function getStoredFlagMap(db: QueryCtx["db"] | MutationCtx["db"]) {
  const rows = (await db
    .query("featureFlags")
    .collect()) as FeatureFlagStoredDoc[];
  const byKey = new Map<FeatureFlagKey, FeatureFlagStoredDoc>();

  for (const row of rows) {
    const key = asFeatureFlagKey(row.key);
    if (!key) continue;
    byKey.set(key, row);
  }

  return byKey;
}

export async function evaluateFeatureFlagForIdentity(
  db: QueryCtx["db"] | MutationCtx["db"],
  key: FeatureFlagKey,
  identity: FeatureFlagIdentity,
): Promise<FeatureFlagEvaluation> {
  const environment = getCurrentFeatureFlagEnvironment();
  const map = await getStoredFlagMap(db);
  const config = mergeFlagConfig(key, map.get(key));
  return evaluateFlag(config, environment, identity);
}

export const listFeatureFlagsForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const map = await getStoredFlagMap(ctx.db);

    return FEATURE_FLAG_KEYS.map((key) => mergeFlagConfig(key, map.get(key)));
  },
});

export const upsertFeatureFlagForAdmin = mutation({
  args: {
    key: featureFlagKeyValidator,
    description: v.optional(v.string()),
    defaultEnabled: v.boolean(),
    killSwitch: v.boolean(),
    rolloutPercentage: v.number(),
    enabledInDevelopment: v.boolean(),
    enabledInStaging: v.boolean(),
    enabledInProduction: v.boolean(),
    includeClerkUserIds: v.optional(v.array(v.string())),
    excludeClerkUserIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const now = Date.now();

    const description =
      args.description?.trim() || FEATURE_FLAG_DEFAULTS[args.key].description;

    const payload = {
      key: args.key,
      description,
      defaultEnabled: args.defaultEnabled,
      killSwitch: args.killSwitch,
      rolloutPercentage: clampRolloutPercentage(args.rolloutPercentage),
      enabledInDevelopment: args.enabledInDevelopment,
      enabledInStaging: args.enabledInStaging,
      enabledInProduction: args.enabledInProduction,
      includeClerkUserIds: normalizeClerkUserIds(args.includeClerkUserIds),
      excludeClerkUserIds: normalizeClerkUserIds(args.excludeClerkUserIds),
      updatedAt: now,
      updatedByUserId: admin._id,
    };

    const existing = (await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique()) as FeatureFlagStoredDoc | null;

    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("featureFlags", {
        ...payload,
        createdAt: now,
      });
    }

    return {
      key: args.key,
      updatedAt: now,
    };
  },
});

export const getMyResolvedFeatureFlags = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const environment = getCurrentFeatureFlagEnvironment();
    const map = await getStoredFlagMap(ctx.db);

    const evaluations = FEATURE_FLAG_KEYS.map((key) => {
      const config = mergeFlagConfig(key, map.get(key));
      return evaluateFlag(config, environment, {
        userId: user._id,
        clerkUserId: user.clerkUserId,
      });
    });

    const flags = evaluations.reduce(
      (accumulator, evaluation) => {
        accumulator[evaluation.key] = evaluation.enabled;
        return accumulator;
      },
      {
        aiSummaryEnabled: false,
        backgroundTrackingEnabled: false,
      } as Record<FeatureFlagKey, boolean>,
    );

    return {
      environment,
      evaluatedAt: Date.now(),
      flags,
      evaluations,
    };
  },
});
