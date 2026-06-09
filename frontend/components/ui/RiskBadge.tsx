"use client";

import { Badge } from "@/components/ui/badge";

type RiskBadgeProps = {
  riskLevel: "low" | "medium" | "high" | "critical";
};

function getVariant(riskLevel: RiskBadgeProps["riskLevel"]) {
  if (riskLevel === "low") {
    return "secondary" as const;
  }

  if (riskLevel === "medium") {
    return "outline" as const;
  }

  return "warning" as const;
}

export function RiskBadge({ riskLevel }: RiskBadgeProps) {
  return <Badge variant={getVariant(riskLevel)}>{riskLevel}</Badge>;
}
