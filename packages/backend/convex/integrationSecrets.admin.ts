import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { requireAdmin } from "./authz";
import { rotateKey } from "./integrationSecretsCrypto";

export const adminRotateIntegrationSecretKeys = internalMutation({
  args: {
    newKeyId: v.string(),
    dryRun: v.optional(v.boolean()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const result = await rotateKey(ctx.db as any, args.newKeyId, {
      pageSize: args.pageSize ?? 200,
      dryRun: !!args.dryRun,
    });

    return result;
  },
});
