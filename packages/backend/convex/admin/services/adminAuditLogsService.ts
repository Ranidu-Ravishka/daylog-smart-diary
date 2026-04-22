import type { Id } from "../../_generated/dataModel";
import { requireAdmin } from "../../authz";
import { clampLimit } from "../../validators";
import { applyDashboardMetricsDelta } from "../../dashboardMetrics";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

export async function listAuditLogsImpl(
  ctx: QueryCtx,
  args: { limit?: number },
) {
  await requireAdmin(ctx);
  const limit = clampLimit(args.limit ?? 100, 500);
  return await ctx.db
    .query("auditLogs")
    .withIndex("by_createdAt")
    .order("desc")
    .take(limit);
}

export async function writeAuditLogImpl(
  ctx: MutationCtx,
  args: { action: string; target?: string },
) {
  const admin = await requireAdmin(ctx);
  const now = Date.now();
  const id = await ctx.db.insert("auditLogs", {
    actorUserId: admin._id,
    action: args.action,
    target: args.target,
    at: now,
  });

  await ctx.db.insert("platformAuditEvents", {
    category: "integration_health",
    action: `admin:${args.action}`,
    actorType: "admin",
    actorUserId: admin._id,
    target: args.target,
    at: now,
  });

  await applyDashboardMetricsDelta(ctx.db, {
    totalAuditLogs: 1,
  });

  return await ctx.db.get(id);
}

export async function adminDeleteAuditLogImpl(
  ctx: MutationCtx,
  args: { auditLogId: Id<"auditLogs"> },
) {
  await requireAdmin(ctx);
  void args.auditLogId;
  // Fail-closed: audit logs are immutable in production-grade mode.
  throw new Error("Audit logs are immutable and cannot be deleted");
}
