import { Activity, FileText, Sparkles } from "lucide-react";
import { DashboardSectionLabel } from "@/components/dashboard/dashboard-section-label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { DashboardSummary } from "@/lib/types/dashboard";
import { formatDateTime } from "@/lib/dashboard/format";
import { DashboardSummarySkeleton } from "@/components/dashboard/dashboard-skeletons";

type MetricItem = { label: string; value: string };

type DashboardAiSummarySectionProps = {
  summary: DashboardSummary | undefined;
  isSummaryLoading: boolean;
  isGeneratingSummary: boolean;
  hasSummarySourceData: boolean;
  summaryGenerationError: string | null;
  metricItems: MetricItem[];
  onGenerateSummary: () => void;
};

export function DashboardAiSummarySection({
  summary,
  isSummaryLoading,
  isGeneratingSummary,
  hasSummarySourceData,
  summaryGenerationError,
  metricItems,
  onGenerateSummary,
}: DashboardAiSummarySectionProps) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <DashboardSectionLabel
            icon={Sparkles}
            title="AI summary"
            description="A gentle recap of your day—generated when you choose."
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 self-start rounded-full sm:self-auto"
          onClick={onGenerateSummary}
          disabled={isGeneratingSummary || !hasSummarySourceData}
        >
          {isGeneratingSummary ? "Generating..." : "Generate Summary"}
        </Button>
      </div>
      {summary?.generatedAt ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Last generated: {formatDateTime(summary.generatedAt)}
        </p>
      ) : null}
      {summaryGenerationError ? (
        <Card className="mb-3 border-destructive/40 bg-destructive/10">
          <CardContent className="p-3 text-xs text-destructive">
            {summaryGenerationError}
          </CardContent>
        </Card>
      ) : null}
      {isSummaryLoading ? (
        <DashboardSummarySkeleton />
      ) : summary ? (
        <Card>
          <CardContent className="p-5">
            <p className="text-[15px] leading-[1.75] text-muted-foreground md:text-base">
              {summary.story}
            </p>
            {summary.highlights && summary.highlights.length > 0 && (
              <>
                <Separator className="my-4" />
                <p className="text-xs font-medium mb-2">Highlights</p>
                <ul className="space-y-1">
                  {summary.highlights.map((h, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                      <span className="mt-1 block h-1 w-1 shrink-0 rounded-full bg-primary" />
                      {h}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {summary.sourcesUsed && summary.sourcesUsed.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {summary.sourcesUsed.map((src) => (
                  <Badge key={src} variant="secondary">
                    {src}
                  </Badge>
                ))}
              </div>
            )}
            {metricItems.length > 0 && (
              <>
                <Separator className="my-4" />
                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                    <Activity className="h-3.5 w-3.5" />
                    Metrics
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {metricItems.map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded-md border border-border bg-secondary p-2"
                      >
                        <p className="text-[11px] text-muted-foreground">
                          {metric.label}
                        </p>
                        <p className="text-sm font-medium">{metric.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              No summary generated for this day yet.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {hasSummarySourceData
                ? "Click Generate Summary to create one from your day data."
                : "Add a memory, rating, note, or people tag, then generate a summary."}
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
