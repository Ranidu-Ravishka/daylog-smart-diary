import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <Card className="border-dashed bg-muted/30">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
        {Icon ? (
          <span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
            <Icon className="size-6" strokeWidth={1.5} />
          </span>
        ) : null}
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description ? (
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
      </CardContent>
    </Card>
  );
}
