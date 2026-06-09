"use client";

import { Badge } from "@/components/ui/badge";

type ContextHealthBadgeProps = {
  freshness: "fresh" | "stale" | "partial" | "missing";
};

export function ContextHealthBadge({ freshness }: ContextHealthBadgeProps) {
  const variant =
    freshness === "fresh"
      ? ("success" as const)
      : freshness === "missing"
        ? ("outline" as const)
        : ("warning" as const);

  return <Badge variant={variant}>Context {freshness}</Badge>;
}
