import { afterEach, describe, expect, it } from "vitest";

import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as featureFlagsModule from "./featureFlags";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

const runtimeEnvKeys = [
  "APP_ENV",
  "DAYLOG_APP_ENV",
  "DEPLOY_ENV",
  "VERCEL_ENV",
  "NODE_ENV",
] as const;

const baselineEnv = Object.fromEntries(
  runtimeEnvKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof runtimeEnvKeys)[number], string | undefined>;

afterEach(() => {
  for (const key of runtimeEnvKeys) {
    const baseline = baselineEnv[key];
    if (baseline === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = baseline;
    }
  }
});

function seededDb() {
  return createInMemoryDb({
    user: [
      {
        _id: "user_admin_001",
        _creationTime: 1,
        clerkUserId: "clerk_admin_001",
        email: "admin@example.com",
        isAdmin: true,
      },
      {
        _id: "user_member_001",
        _creationTime: 2,
        clerkUserId: "clerk_member_001",
        email: "member1@example.com",
        isAdmin: false,
      },
      {
        _id: "user_member_002",
        _creationTime: 3,
        clerkUserId: "clerk_member_002",
        email: "member2@example.com",
        isAdmin: false,
      },
    ],
  });
}

describe("feature flags behavior", () => {
  it("enforces admin access and lists default flags", async () => {
    const db = seededDb();

    const listFeatureFlagsForAdmin = handler<
      { limit?: number; cursor?: string },
      {
        items: Array<{ key: string; source: "default" | "db" }>;
        nextCursor: string | null;
      }
    >(featureFlagsModule.listFeatureFlagsForAdmin);

    await expect(
      listFeatureFlagsForAdmin(createAuthCtx(db, "clerk_member_001"), {}),
    ).rejects.toThrow("Forbidden");

    const listed = await listFeatureFlagsForAdmin(
      createAuthCtx(db, "clerk_admin_001"),
      {},
    );

    expect(listed.items.map((flag) => flag.key)).toEqual([
      "aiSummaryEnabled",
      "backgroundTrackingEnabled",
    ]);
    expect(listed.items.every((flag) => flag.source === "default")).toBe(true);
    expect(listed.nextCursor).toBeNull();

    const firstPage = await listFeatureFlagsForAdmin(
      createAuthCtx(db, "clerk_admin_001"),
      { limit: 1 },
    );

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
  });

  it("supports include and exclude targeting with kill switch precedence", async () => {
    process.env.APP_ENV = "production";

    const db = seededDb();

    const upsertFeatureFlagForAdmin = handler<
      {
        key: "aiSummaryEnabled" | "backgroundTrackingEnabled";
        description?: string;
        defaultEnabled: boolean;
        killSwitch: boolean;
        rolloutPercentage: number;
        enabledInDevelopment: boolean;
        enabledInStaging: boolean;
        enabledInProduction: boolean;
        includeClerkUserIds?: string[];
        excludeClerkUserIds?: string[];
      },
      { key: string }
    >(featureFlagsModule.upsertFeatureFlagForAdmin);

    const getMyResolvedFeatureFlags = handler<
      Record<string, never>,
      {
        flags: {
          aiSummaryEnabled: boolean;
          backgroundTrackingEnabled: boolean;
        };
        evaluations: Array<{ key: string; reason: string; enabled: boolean }>;
      }
    >(featureFlagsModule.getMyResolvedFeatureFlags);

    await upsertFeatureFlagForAdmin(createAuthCtx(db, "clerk_admin_001"), {
      key: "aiSummaryEnabled",
      description: "AI summaries rollout",
      defaultEnabled: true,
      killSwitch: false,
      rolloutPercentage: 0,
      enabledInDevelopment: true,
      enabledInStaging: true,
      enabledInProduction: true,
      includeClerkUserIds: ["clerk_member_001"],
      excludeClerkUserIds: ["clerk_member_002"],
    });

    const memberOneFlags = await getMyResolvedFeatureFlags(
      createAuthCtx(db, "clerk_member_001"),
      {},
    );
    expect(memberOneFlags.flags.aiSummaryEnabled).toBe(true);

    const memberTwoFlags = await getMyResolvedFeatureFlags(
      createAuthCtx(db, "clerk_member_002"),
      {},
    );
    expect(memberTwoFlags.flags.aiSummaryEnabled).toBe(false);

    await upsertFeatureFlagForAdmin(createAuthCtx(db, "clerk_admin_001"), {
      key: "aiSummaryEnabled",
      description: "AI summaries rollout",
      defaultEnabled: true,
      killSwitch: true,
      rolloutPercentage: 100,
      enabledInDevelopment: true,
      enabledInStaging: true,
      enabledInProduction: true,
      includeClerkUserIds: ["clerk_member_001"],
      excludeClerkUserIds: [],
    });

    const killSwitchResult = await getMyResolvedFeatureFlags(
      createAuthCtx(db, "clerk_member_001"),
      {},
    );
    expect(killSwitchResult.flags.aiSummaryEnabled).toBe(false);
    expect(
      killSwitchResult.evaluations.find(
        (evaluation) => evaluation.key === "aiSummaryEnabled",
      )?.reason,
    ).toBe("kill_switch");
  });

  it("applies environment-specific toggles for runtime fetch", async () => {
    const db = seededDb();

    const upsertFeatureFlagForAdmin = handler<
      {
        key: "aiSummaryEnabled" | "backgroundTrackingEnabled";
        description?: string;
        defaultEnabled: boolean;
        killSwitch: boolean;
        rolloutPercentage: number;
        enabledInDevelopment: boolean;
        enabledInStaging: boolean;
        enabledInProduction: boolean;
        includeClerkUserIds?: string[];
        excludeClerkUserIds?: string[];
      },
      { key: string }
    >(featureFlagsModule.upsertFeatureFlagForAdmin);

    const getMyResolvedFeatureFlags = handler<
      Record<string, never>,
      {
        environment: string;
        flags: {
          aiSummaryEnabled: boolean;
          backgroundTrackingEnabled: boolean;
        };
      }
    >(featureFlagsModule.getMyResolvedFeatureFlags);

    await upsertFeatureFlagForAdmin(createAuthCtx(db, "clerk_admin_001"), {
      key: "backgroundTrackingEnabled",
      description: "Background location control",
      defaultEnabled: true,
      killSwitch: false,
      rolloutPercentage: 100,
      enabledInDevelopment: true,
      enabledInStaging: false,
      enabledInProduction: true,
      includeClerkUserIds: [],
      excludeClerkUserIds: [],
    });

    process.env.APP_ENV = "staging";
    const stagingResult = await getMyResolvedFeatureFlags(
      createAuthCtx(db, "clerk_member_001"),
      {},
    );

    expect(stagingResult.environment).toBe("staging");
    expect(stagingResult.flags.backgroundTrackingEnabled).toBe(false);

    process.env.APP_ENV = "development";
    const developmentResult = await getMyResolvedFeatureFlags(
      createAuthCtx(db, "clerk_member_001"),
      {},
    );

    expect(developmentResult.environment).toBe("development");
    expect(developmentResult.flags.backgroundTrackingEnabled).toBe(true);
  });
});
