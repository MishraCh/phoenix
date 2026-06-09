"use client";
import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { gideonQueryKeys } from "@/hooks/useGideonQueries";
import { useWorkspaceStream } from "@/hooks/useWorkspaceStream";

const TERMINAL_EVENTS = [
  "connected",
  "command.completed",
  "workflow.run.completed",
  "workflow.run.failed",
  "approval.created",
  "approval.approved",
  "approval.executed",
  "approval.failed",
  "approval.rejected",
  "notification.created",
];

export function SseEventHandler() {
  const queryClient = useQueryClient();
  const { idToken } = useAuth();
  const hasConnectedRef = useRef(false);

  useWorkspaceStream(
    TERMINAL_EVENTS,
    useCallback(
      (event: string) => {
        if (event === "connected") {
          if (!hasConnectedRef.current) {
            hasConnectedRef.current = true;
            return; // first connection — data is already fresh
          }
          // Reconnect after a gap — invalidate potentially stale queries
          void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.dashboardSummary(idToken) });
          void queryClient.invalidateQueries({ queryKey: ["workflowRuns"] });
          return;
        }
        if (event === "command.completed") {
          void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.commandSessions(idToken) });
        } else if (event === "workflow.run.completed" || event === "workflow.run.failed") {
          void queryClient.invalidateQueries({ queryKey: ["workflowRuns"] });
          void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.dashboardSummary(idToken) });
        } else if (
          event === "approval.created" ||
          event === "approval.approved" ||
          event === "approval.executed" ||
          event === "approval.failed" ||
          event === "approval.rejected"
        ) {
          void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.approvals(idToken) });
          void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.dashboardSummary(idToken) });
        } else if (event === "notification.created") {
          void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.notifications(idToken) });
          void queryClient.invalidateQueries({ queryKey: gideonQueryKeys.dashboardSummary(idToken) });
        }
      },
      [idToken, queryClient],
    ),
  );

  return null;
}
