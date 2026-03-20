"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void _error;

  return (
    <div className="max-w-2xl">
      <Card>
        <CardContent className="p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">
            We couldn’t load this dashboard day.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please retry. If this keeps happening, check your network and try
            again.
          </p>
          <Button onClick={reset} className="mt-4" variant="outline">
            <RotateCcw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
