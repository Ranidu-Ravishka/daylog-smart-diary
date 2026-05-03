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
    <div className="mb-8 grid grid-cols-3 gap-3">
      <Card>
        <CardContent className="bg-secondary/80 p-4 text-center">
          <p className="text-xl">{latestMemoryMood}</p>
          <p className="mt-1 text-xs text-muted-foreground">Latest mood</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="bg-secondary/80 p-4 text-center">
          <p className="text-xl font-semibold">{memoryCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">Memories</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="bg-secondary/80 p-4 text-center">
          <DayRating dayKey={dayKey} initialRating={dayRating ?? null} />
        </CardContent>
      </Card>
    </div>
  );
}
