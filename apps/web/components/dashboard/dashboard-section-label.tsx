import type { LucideIcon } from "lucide-react";

type DashboardSectionLabelProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
};

export function DashboardSectionLabel({
  icon: Icon,
  title,
  description,
}: DashboardSectionLabelProps) {
  return (
    <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-secondary/70 text-primary shadow-sm">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
