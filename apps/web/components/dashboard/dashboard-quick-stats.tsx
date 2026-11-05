import { Card, CardContent } from "@/components/ui/card";
import { DayRating } from "@/components/DayRating";

type DashboardQuickStatsProps = {
  latestMemoryMood: string;
  memoryCount: number;
  dayKey: string;
  dayRating: number | null | undefined;
};

export function DashboardQuickStats({
  latestMemoryMood,
  memoryCount,
  dayKey,
  dayRating,
}: DashboardQuickStatsProps) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:mb-8 sm:grid-cols-3">
      <Card className="overflow-hidden border-border/60 bg-gradient-to-b from-secondary/50 to-card/80">
        <CardContent className="p-4 text-center sm:p-5">
          <p className="text-xl font-semibold sm:text-2xl">{latestMemoryMood}</p>
          <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Latest mood
          </p>
        </CardContent>
      </Card>
      <Card className="overflow-hidden border-border/60 bg-gradient-to-b from-secondary/50 to-card/80">
        <CardContent className="p-4 text-center sm:p-5">
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {memoryCount}
          </p>
          <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Memories
          </p>
        </CardContent>
      </Card>
      <Card className="overflow-hidden border-border/60 bg-gradient-to-b from-secondary/50 to-card/80">
        <CardContent className="flex min-h-[112px] items-center justify-center p-4 sm:p-5">
          <DayRating dayKey={dayKey} initialRating={dayRating ?? null} />
        </CardContent>
      </Card>
    </div>
  );
}
