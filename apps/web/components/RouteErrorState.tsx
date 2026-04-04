"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type RouteErrorStateProps = {
  title: string;
  description: string;
  onRetry: () => void;
};

export function RouteErrorState({
  title,
  description,
  onRetry,
}: RouteErrorStateProps) {
  return (
    <div className="max-w-2xl">
      <Card>
        <CardContent className="p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          <Button onClick={onRetry} className="mt-4" variant="outline">
            <RotateCcw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
