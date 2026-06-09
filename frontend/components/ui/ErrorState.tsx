"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ErrorState({
  title = "This section needs attention",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <Card className="overflow-hidden rounded-[1.75rem] border-[hsl(var(--badge-warning-border))] bg-[linear-gradient(180deg,rgba(255,250,238,0.92)_0%,rgba(255,248,232,0.98)_100%)] shadow-none">
      <CardContent className="flex items-start gap-3 p-5">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[hsl(var(--badge-warning-text))]" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[hsl(var(--badge-warning-text))]">{title}</p>
          <p className="mt-2 text-sm leading-6 text-[hsl(var(--badge-warning-text))]">{message}</p>
          {onRetry ? (
            <Button variant="outline" className="mt-4 border-[hsl(var(--badge-warning-border))] bg-white" onClick={onRetry}>
              <RefreshCw className="mr-2 size-4" />
              Try again
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
