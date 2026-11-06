import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireUser } from "./authz";

const operationValidator = v.union(
  v.literal("summary_generation"),
  v.literal("personal_insight"),
  v.literal("ask_your_day"),
);

function estimateCostUsd(
  promptTokens: number | undefined,
  completionTokens: number | undefined,
): number | undefined {
  if (promptTokens === undefined && completionTokens === undefined) {
    return undefined;
  }

  const inputRate = Number(process.env.AI_INPUT_COST_PER_1K_USD ?? "0.005");
  const outputRate = Number(process.env.AI_OUTPUT_COST_PER_1K_USD ?? "0.015");
  const inputCost = ((promptTokens ?? 0) / 1000) * inputRate;
  const outputCost = ((completionTokens ?? 0) / 1000) * outputRate;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

export const recordAiUsageInternal = internalMutation({
  args: {
    userId: v.id("user"),
    operation: operationValidator,
    model: v.string(),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    usageSource: v.union(v.literal("provider"), v.literal("estimated")),
  },
  handler: async (ctx, args) => {
    const promptTokens = Number.isFinite(args.promptTokens)
      ? args.promptTokens
      : undefined;
    const completionTokens = Number.isFinite(args.completionTokens)
      ? args.completionTokens
      : undefined;
    const totalTokens =
      Number.isFinite(args.totalTokens) ||
      promptTokens !== undefined ||
      completionTokens !== undefined
        ? (args.totalTokens ??
          (promptTokens ?? 0) + (completionTokens ?? 0))
        : undefined;

    return await ctx.db.insert("aiUsageRecords", {
      userId: args.userId,
      operation: args.operation,
      provider: "openai",
      model: args.model,
      status: args.status,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd: estimateCostUsd(promptTokens, completionTokens),
      usageSource: args.usageSource,
      createdAt: Date.now(),
    });
  },
});

export const getMyAiUsage = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const days = Math.max(1, Math.min(31, Math.floor(args.days ?? 30)));
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return await ctx.db
      .query("aiUsageRecords")
      .withIndex("by_user_createdAt", (q) =>
        q.eq("userId", user._id).gte("createdAt", cutoff),
      )
      .order("desc")
      .take(100);
  },
});
