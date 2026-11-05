import { beforeAll, describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";

let integrationHealthModule!: typeof import("./integrationHealth");
let integrationsModule!: typeof import("./integrations");
let personalInsightsModule!: typeof import("./personalInsights");
let summaryQualityModule!: typeof import("./summaryQuality");

beforeAll(async () => {
  process.env.CLERK_JWT_ISSUER_DOMAIN ??= "https://clerk.daylog.dev";
  process.env.CLERK_WEBHOOK_SECRET ??= "whsec_test_valid_key_1234567890";
  process.env.OPENAI_API_KEY ??= "sk-test-valid-key-1234567890";

  [
    integrationHealthModule,
    integrationsModule,
    personalInsightsModule,
    summaryQualityModule,
  ] = await Promise.all([
    import("./integrationHealth"),
    import("./integrations"),
    import("./personalInsights"),
    import("./summaryQuality"),
  ]);
});

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

describe("deletion race writers", () => {
  it("rejects asynchronous writes after account deletion has been requested", async () => {
    const userId = "user_deletion_race_001" as Id<"user">;
    const db = createInMemoryDb({
      user: [
        {
          _id: userId,
          _creationTime: 1,
          clerkUserId: "clerk_deletion_race_001",
          email: "deletion-race@example.com",
          isAdmin: false,
          accountStatus: "deletion_requested",
          accountDeletionRequestedAt: 2,
        },
      ],
      integrations: [
        {
          _id: "integration_deletion_race_001",
          _creationTime: 3,
          userId,
          provider: "spotify",
          status: "connected",
        },
      ],
    });
    const ctx = createAuthCtx(db, "clerk_deletion_race_001");

    const writes: Array<Promise<unknown>> = [
      handler<
        {
          userId: Id<"user">;
          provider: string;
          accessToken: string;
        },
        unknown
      >(integrationsModule.storeIntegrationSecretInternal)(ctx, {
        userId,
        provider: "spotify",
        accessToken: "synthetic-token",
      }),
      handler<
        {
          integrationId: Id<"integrations">;
          tokenRef: string;
        },
        unknown
      >(integrationsModule.updateIntegrationTokenRefInternal)(ctx, {
        integrationId:
          "integration_deletion_race_001" as Id<"integrations">,
        tokenRef: "tokref_synthetic",
      }),
      handler<
        { userId: Id<"user">; provider: string; dayKey: string },
        unknown
      >(integrationsModule.beginIntegrationSyncRunInternal)(ctx, {
        userId,
        provider: "spotify",
        dayKey: "2026-04-01",
      }),
      handler<
        {
          userId: Id<"user">;
          provider: string;
          dayKey: string;
          metrics?: undefined;
        },
        unknown
      >(integrationsModule.upsertIntegrationDailyDataInternal)(ctx, {
        userId,
        provider: "spotify",
        dayKey: "2026-04-01",
      }),
      handler<
        {
          userId: Id<"user">;
          dayKey: string;
          modelProvider: string;
          modelName: string;
          modelInput: string;
          success: boolean;
        },
        unknown
      >(summaryQualityModule.recordSummaryGenerationEvaluationInternal)(ctx, {
        userId,
        dayKey: "2026-04-01",
        modelProvider: "openai",
        modelName: "synthetic",
        modelInput: "synthetic input",
        success: false,
      }),
      handler<
        {
          userId: Id<"user">;
          dayKey: string;
          vectorVersion: number;
          features: {
            memoryCount: number;
            noteCount: number;
            peopleTagCount: number;
            highlightCount: number;
            integrationProviderCount: number;
          };
          sourceDays: number;
        },
        unknown
      >(personalInsightsModule.upsertDailyFeatureVectorInternal)(ctx, {
        userId,
        dayKey: "2026-04-01",
        vectorVersion: 1,
        features: {
          memoryCount: 0,
          noteCount: 0,
          peopleTagCount: 0,
          highlightCount: 0,
          integrationProviderCount: 0,
        },
        sourceDays: 1,
      }),
      handler<
        {
          provider: string;
          userId: Id<"user">;
          outcome: "success";
        },
        unknown
      >(integrationHealthModule.recordIntegrationHealthEventInternal)(ctx, {
        provider: "spotify",
        userId,
        outcome: "success",
      }),
    ];

    const results = await Promise.allSettled(writes);
    expect(results).toHaveLength(writes.length);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toHaveProperty(
          "message",
          expect.stringContaining("inactive user"),
        );
      }
    }

    expect(db.getTable("integrationSecrets")).toHaveLength(0);
    expect(db.getTable("integrationSyncRuns")).toHaveLength(0);
    expect(db.getTable("integrationDailyData")).toHaveLength(0);
    expect(db.getTable("summaryGenerationEvents")).toHaveLength(0);
    expect(db.getTable("dailyFeatureVectors")).toHaveLength(0);
    expect(db.getTable("integrationHealthEvents")).toHaveLength(0);
    expect(db.getTable("integrations")[0]?.tokenRef).toBeUndefined();
  });
});
