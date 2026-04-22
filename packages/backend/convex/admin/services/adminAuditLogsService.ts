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
    category: "admin",
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
  const admin = await requireAdmin(ctx);
  const isProduction =
    (process.env.NODE_ENV ?? "").toLowerCase() === "production";

  if (isProduction) {
    // Fail-closed in production: audit logs are immutable.
    throw new Error("Audit logs are immutable and cannot be deleted");
  }

  // Backward-compatible behavior for non-production/test environments.
  const log = await ctx.db.get(args.auditLogId);
  if (!log) throw new Error("Audit log not found");
  await ctx.db.delete(args.auditLogId);

  await ctx.db.insert("platformAuditEvents", {
    category: "admin",
    action: "admin:delete_audit_log",
    actorType: "admin",
    actorUserId: admin._id,
    target: String(args.auditLogId),
    at: Date.now(),
  });

  await applyDashboardMetricsDelta(ctx.db, {
    totalAuditLogs: -1,
  });

  return { success: true };
}
