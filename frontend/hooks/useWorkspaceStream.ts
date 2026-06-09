"use client";
import { useEffect } from "react";

import { useSseContext } from "@/components/app-shell/SseProvider";

export function useWorkspaceStream(
  events: string[],
  handler: (event: string, data: unknown) => void,
) {
  const ctx = useSseContext();
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe((event, data) => {
      if (events.includes(event)) handler(event, data);
    });
  }, [ctx, events, handler]);
}
