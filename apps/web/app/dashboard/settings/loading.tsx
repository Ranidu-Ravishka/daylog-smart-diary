import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="max-w-xl space-y-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-24" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
      <Skeleton className="h-16" />
    </div>
  );
}
