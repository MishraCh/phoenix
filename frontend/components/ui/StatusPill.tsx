"use client";

import { Badge } from "@/components/ui/badge";

type StatusPillProps = {
  status: string;
};

function getVariant(status: string) {
  if (["completed", "connected", "active", "approved", "executed", "read", "fresh", "idle", "saved"].includes(status)) {
    return "success" as const;
  }

  if (["running", "queued"].includes(status)) {
    return "running" as const;
  }

  if (["failed", "cancelled", "error", "rejected", "expired"].includes(status)) {
    return "danger" as const;
  }

  if (["pending", "paused", "draft", "syncing", "partial", "stale", "edited", "unread", "waiting_approval", "reconnect_needed", "disconnected"].includes(status)) {
    return "warning" as const;
  }

  return "outline" as const;
}

export function StatusPill({ status }: StatusPillProps) {
  return <Badge variant={getVariant(status)}>{status.replaceAll("_", " ")}</Badge>;
}
