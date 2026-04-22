import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

export function sanitizeSyncError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Provider sync failed";
  return message.slice(0, 220);
}

export async function recordIntegrationHealthEvent(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    provider: string;
    userId: Id<"user">;
    integrationId: Id<"integrations">;
    dayKey: string;
    outcome: "success" | "error" | "skipped";
    tokenValidityStatus: "valid" | "expiring_soon" | "expired" | "unknown";
    error?: string;
    latencyMs?: number;
  },
) {
  await ctx.runMutation(
    internal.integrationHealth.recordIntegrationHealthEventInternal,
    args,
  );
}
