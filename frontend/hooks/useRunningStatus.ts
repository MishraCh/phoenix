"use client";
import { useRunningStatusContext } from "@/components/app-shell/RunningStatusProvider";

export function useRunningStatus() {
  const { items, dismiss } = useRunningStatusContext();
  return {
    items,
    dismiss,
    activeCount: items.filter((i) => i.status === "running").length,
    waitingCount: items.filter((i) => i.status === "waiting_approval").length,
    failedCount: items.filter((i) => i.status === "failed").length,
  };
}
