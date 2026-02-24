"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { useConvexAuth, useQuery } from "convex/react";

export default function AdminDashboardPage() {
  const { isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );
  const metrics = useQuery(
    api.admin.getDashboardMetrics,
    isAdmin ? {} : "skip",
  );

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-5xl mx-auto px-6">
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="mt-2 text-sm text-gray-600">
            Admin overview of all tables.
          </p>

          {metrics === undefined ? (
            <div className="mt-6 text-sm text-gray-500">Loading metrics…</div>
          ) : (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <MetricCard
                label="Users"
                value={metrics.totalUsers}
                href="/users"
              />
              <MetricCard
                label="Memories"
                value={metrics.totalMemories}
                href="/memories"
              />
              <MetricCard label="Days" value={metrics.totalDays} href="/days" />
              <MetricCard
                label="Summaries"
                value={metrics.totalSummaries}
                href="/summaries"
              />
              <MetricCard
                label="Integrations"
                value={metrics.totalIntegrations}
                href="/integrations"
              />
              <MetricCard
                label="Preferences"
                value={metrics.totalPreferences}
                href="/preferences"
              />
              <MetricCard
                label="Audit Logs"
                value={metrics.totalAuditLogs}
                href="/audit-logs"
              />
            </div>
          )}
        </div>
      </div>
    </AdminGuard>
  );
}

function MetricCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <a
      href={href}
      className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 hover:border-blue-300 transition"
    >
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </a>
  );
}
