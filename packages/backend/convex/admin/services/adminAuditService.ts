import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { applyDashboardMetricsDelta } from "../../dashboardMetrics";

type CountableQuery = {
  paginate: (opts: { numItems: number; cursor: string | null }) => Promise<{
    page: unknown[];
    isDone: boolean;
    continueCursor: string | null;
  }>;
};

export async function logAdminAction(
  ctx: MutationCtx,
  adminId: Id<"user">,
  action: string,
  target?: string,
) {
  const now = Date.now();
  await ctx.db.insert("auditLogs", {
    actorUserId: adminId,
    action,
    target,
    at: now,
  });

  // Immutable parallel audit trail for security-sensitive admin operations.
  await ctx.db.insert("platformAuditEvents", {
    category: "admin",
    action: `admin:${action}`,
    actorType: "admin",
    actorUserId: adminId,
    target,
    at: now,
  });

  await applyDashboardMetricsDelta(ctx.db, {
    totalAuditLogs: 1,
  });
}

export async function countRows(queryRef: CountableQuery): Promise<number> {
  let total = 0;
  let cursor: string | null = null;

  while (true) {
    const page = await queryRef.paginate({
      numItems: 512,
      cursor,
    });

    total += page.page.length;
    if (page.isDone) break;
    cursor = page.continueCursor;
  }

  return total;
}
