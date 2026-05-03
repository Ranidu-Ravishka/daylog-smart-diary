import { Database, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { DashboardIntegrationSource } from "@/lib/types/dashboard";
import { formatDateTime } from "@/lib/dashboard/format";
import { DashboardSummarySkeleton } from "@/components/dashboard/dashboard-skeletons";

type DashboardDataSourcesSectionProps = {
  integrationDailyData: Array<DashboardIntegrationSource> | undefined;
  sourceRows: DashboardIntegrationSource[];
  providerLabelMap: Record<string, string>;
};

export function DashboardDataSourcesSection({
  integrationDailyData,
  sourceRows,
  providerLabelMap,
}: DashboardDataSourcesSectionProps) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <Database className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-medium">Data sources for this day</h2>
      </div>

      {(integrationDailyData ?? undefined) === undefined ? (
        <DashboardSummarySkeleton />
      ) : sourceRows.length > 0 ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            {sourceRows.map((row) => (
              <div
                key={`${row.provider}-${row.dayKey}`}
                className="rounded-md border border-border bg-secondary p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {row.provider === "location" ? (
                      <MapPin className="h-3.5 w-3.5" />
                    ) : null}
                    {providerLabelMap[row.provider] ?? row.provider}
                  </div>
                  <Badge variant="secondary">
                    Synced {formatDateTime(row.syncedAt)}
                  </Badge>
                </div>

                {row.summary ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {row.summary}
                  </p>
                ) : null}

                {row.signals && row.signals.length > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Signals: {row.signals.slice(0, 2).join(" • ")}
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No integration sync data for this day yet.
          </CardContent>
        </Card>
      )}
    </section>
  );
}
