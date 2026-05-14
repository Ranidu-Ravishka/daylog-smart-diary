import { Clock } from "lucide-react";
import { DashboardSectionLabel } from "@/components/dashboard/dashboard-section-label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MemoryCard, type MemoryData } from "@/components/MemoryCard";
import { DashboardMemoriesSkeleton } from "@/components/dashboard/dashboard-skeletons";

type MemoryRow = MemoryData & { thumbnailUrl?: string | null };

type DashboardMemoriesSectionProps = {
  isMemoriesLoading: boolean;
  memories: MemoryRow[];
  canLoadMoreMemories: boolean;
  isLoadingMoreMemories: boolean;
  onLoadMore: () => void;
  onEditMemory: (memory: MemoryData) => void;
  onDeleteSuccess: () => void;
};

export function DashboardMemoriesSection({
  isMemoriesLoading,
  memories,
  canLoadMoreMemories,
  isLoadingMoreMemories,
  onLoadMore,
  onEditMemory,
  onDeleteSuccess,
}: DashboardMemoriesSectionProps) {
  return (
    <section className="mb-10">
      <DashboardSectionLabel
        icon={Clock}
        title="Memories"
        description="Moments you saved for this day."
      />
      {isMemoriesLoading ? (
        <DashboardMemoriesSkeleton />
      ) : memories.length > 0 ? (
        <div className="space-y-3">
          {memories.map((memory) => (
            <MemoryCard
              key={memory._id}
              memory={memory as MemoryData}
              thumbnailUrl={memory.thumbnailUrl}
              onEdit={onEditMemory}
              onDeleteSuccess={onDeleteSuccess}
            />
          ))}

          {(canLoadMoreMemories || isLoadingMoreMemories) && (
            <div className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onLoadMore}
                disabled={isLoadingMoreMemories}
              >
                {isLoadingMoreMemories
                  ? "Loading more..."
                  : "Load more memories"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <Clock className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">No memories today.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Everything is working—this day just has no data yet. Add a memory
              to get started.
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
