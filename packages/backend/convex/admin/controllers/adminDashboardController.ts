import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import type { DashboardMetricsSnapshot } from "../../dashboardMetrics";
import {
  getDashboardMetricsSnapshot,
  replaceDashboardMetricsSnapshot,
} from "../../dashboardMetrics";
import { countRows, logAdminAction } from "../services/adminAuditService";

export async function getDashboardMetricsController(ctx: QueryCtx) {
  return await getDashboardMetricsSnapshot(ctx.db);
}

export async function rebuildDashboardMetricsController(
  ctx: MutationCtx,
  adminId: Id<"user">,
): Promise<DashboardMetricsSnapshot> {
  const [
    totalUsers,
    totalMemories,
    totalDays,
    totalSummaries,
    totalIntegrations,
    totalPreferences,
    totalAuditLogs,
  ] = await Promise.all([
    countRows(ctx.db.query("user")),
    countRows(ctx.db.query("memories")),
    countRows(ctx.db.query("days")),
    countRows(ctx.db.query("daySummaries")),
    countRows(ctx.db.query("integrations")),
    countRows(ctx.db.query("userPreferences")),
    countRows(ctx.db.query("auditLogs")),
  ]);

  await replaceDashboardMetricsSnapshot(ctx.db, {
    totalUsers,
    totalMemories,
    totalDays,
    totalSummaries,
    totalIntegrations,
    totalPreferences,
    totalAuditLogs,
  });

  await logAdminAction(ctx, adminId, "rebuild_dashboard_metrics", "global");
  return await getDashboardMetricsSnapshot(ctx.db);
}
