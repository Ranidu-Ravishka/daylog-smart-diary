import { Skeleton } from "@/components/ui/skeleton";

export default function ExportLoading() {
  return (
    <div className="max-w-xl space-y-6">
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-36" />
      <Skeleton className="h-36" />
      <Skeleton className="h-10 w-48" />
    </div>
  );
}
