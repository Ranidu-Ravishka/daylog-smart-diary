import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  asIntegrationProvider,
  assertIntegrationProvider,
} from "../../integrationProviders";
import { isOpaqueTokenRef, normalizeTokenRef } from "../../integrations.auth";

const DELETE_BATCH_SIZE = 256;

export function buildAdminIntegrationUpdatePatch(
  integration: {
    provider: string;
  },
  args: {
    provider?: string;
    status?: "connected" | "disconnected" | "error";
    scopes?: string[];
    tokenRef?: string;
  },
) {
  const currentProvider = asIntegrationProvider(integration.provider);
  const nextProvider =
    args.provider !== undefined
      ? assertIntegrationProvider(args.provider)
      : currentProvider;

  const updates: Record<string, unknown> = {};
  if (args.provider !== undefined) updates.provider = nextProvider;
  if (args.status !== undefined) updates.status = args.status;
  if (args.scopes !== undefined) updates.scopes = args.scopes;
  if (args.tokenRef !== undefined) {
    if (!nextProvider) {
      throw new Error(
        `Current provider "${integration.provider}" is no longer supported. Set provider to a supported value before updating tokenRef.`,
      );
    }

    const normalizedTokenRef = normalizeTokenRef(args.tokenRef);

    if (normalizedTokenRef === null) {
      updates.tokenRef = undefined;
    } else if (!isOpaqueTokenRef(normalizedTokenRef)) {
      throw new Error(
        'adminUpdateIntegration.tokenRef must be an opaque tokenRef prefixed with "tokref_". Raw token values are rejected.',
      );
    } else {
      updates.tokenRef = normalizedTokenRef;
    }
  }

  return updates;
}

export async function deleteIntegrationCascadeData(
  db: MutationCtx["db"],
  integration: {
    _id: Id<"integrations">;
    userId: Id<"user">;
    provider: string;
    tokenRef?: string;
  },
) {
  while (true) {
    const linkedDailyRows = await db
      .query("integrationDailyData")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", integration.userId).eq("provider", integration.provider),
      )
      .take(DELETE_BATCH_SIZE);

    if (linkedDailyRows.length === 0) break;

    for (const row of linkedDailyRows) {
      await db.delete(row._id);
    }
  }

  const tokenRef = integration.tokenRef;
  if (tokenRef && isOpaqueTokenRef(tokenRef)) {
    const secret = await db
      .query("integrationSecrets")
      .withIndex("by_tokenRef", (q) => q.eq("tokenRef", tokenRef))
      .unique();
    if (secret) {
      await db.delete(secret._id);
    }
  }

  while (true) {
    const syncRuns = await db
      .query("integrationSyncRuns")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", integration.userId).eq("provider", integration.provider),
      )
      .take(DELETE_BATCH_SIZE);

    if (syncRuns.length === 0) break;

    for (const run of syncRuns) {
      await db.delete(run._id);
    }
  }
}
