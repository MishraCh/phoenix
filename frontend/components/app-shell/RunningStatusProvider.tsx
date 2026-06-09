"use client";
import { createContext, useCallback, useContext, useReducer, useRef, type ReactNode } from "react";

import { useWorkspaceStream } from "@/hooks/useWorkspaceStream";

export type RunningItem = {
  id: string;
  type: "command" | "workflow";
  label: string;
  status: "running" | "completed" | "failed" | "waiting_approval";
  statusCopy: string;
  href: string | null;
  startedAt: number;
  approvalId?: string;
};

type Action =
  | { type: "ADD"; item: RunningItem }
  | { type: "UPDATE"; id: string; patch: Partial<RunningItem> }
  | { type: "REMOVE"; id: string };

function reducer(state: RunningItem[], action: Action): RunningItem[] {
  switch (action.type) {
    case "ADD":
      return state.some((i) => i.id === action.item.id) ? state : [...state, action.item];
    case "UPDATE":
      return state.map((i) => (i.id === action.id ? { ...i, ...action.patch } : i));
    case "REMOVE":
      return state.filter((i) => i.id !== action.id);
    default:
      return state;
  }
}

type RunningStatusContextValue = {
  items: RunningItem[];
  dismiss: (id: string) => void;
  setDropdownOpen: (open: boolean) => void;
};

const RunningStatusContext = createContext<RunningStatusContextValue | null>(null);

export function useRunningStatusContext() {
  const ctx = useContext(RunningStatusContext);
  if (!ctx) throw new Error("useRunningStatusContext must be used within RunningStatusProvider");
  return ctx;
}

const RUNNING_EVENTS = [
  "command.started",
  "command.completed",
  "command.failed",
  "workflow.run.started",
  "workflow.step.started",
  "workflow.waiting_approval",
  "workflow.run.completed",
  "workflow.run.failed",
];

export function RunningStatusProvider({ children }: { children: ReactNode }) {
  const [items, dispatch] = useReducer(reducer, []);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pausedDismissalsRef = useRef<Set<string>>(new Set());
  const isDropdownOpenRef = useRef(false);

  const scheduleRemove = useCallback((id: string, delayMs: number) => {
    const existing = timersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      if (isDropdownOpenRef.current) {
        // Dropdown is open — hold this dismissal until it closes
        pausedDismissalsRef.current.add(id);
        return;
      }
      dispatch({ type: "REMOVE", id });
    }, delayMs);
    timersRef.current.set(id, timer);
  }, []);

  const dismiss = useCallback((id: string) => {
    const existing = timersRef.current.get(id);
    if (existing) clearTimeout(existing);
    timersRef.current.delete(id);
    pausedDismissalsRef.current.delete(id);
    dispatch({ type: "REMOVE", id });
  }, []);

  const setDropdownOpen = useCallback(
    (open: boolean) => {
      isDropdownOpenRef.current = open;
      if (!open) {
        const paused = [...pausedDismissalsRef.current];
        pausedDismissalsRef.current.clear();
        for (const id of paused) {
          scheduleRemove(id, 5_000);
        }
      }
    },
    [scheduleRemove],
  );

  useWorkspaceStream(
    RUNNING_EVENTS,
    useCallback(
      (event: string, data: unknown) => {
        const d = data as Record<string, unknown>;

        if (event === "command.started") {
          const id = String(d.commandId ?? `${String(d.sessionId ?? "cmd")}-${Date.now()}`);
          const sessionId = d.sessionId ? String(d.sessionId) : null;
          dispatch({
            type: "ADD",
            item: {
              id,
              type: "command",
              label: d.mode ? `${String(d.mode)} command` : "Command",
              status: "running",
              statusCopy: "Starting…",
              href: sessionId ? `/?session=${sessionId}` : null,
              startedAt: Date.now(),
            },
          });
        } else if (event === "command.completed") {
          const id = String(d.commandId ?? "");
          dispatch({ type: "UPDATE", id, patch: { status: "completed", statusCopy: "Done" } });
          scheduleRemove(id, 20_000);
        } else if (event === "command.failed") {
          const id = String(d.commandId ?? "");
          dispatch({ type: "UPDATE", id, patch: { status: "failed", statusCopy: String(d.error ?? "Failed") } });
        } else if (event === "workflow.run.started") {
          const runId = String(d.runId ?? "");
          dispatch({
            type: "ADD",
            item: {
              id: runId,
              type: "workflow",
              label: d.workflowName ? String(d.workflowName) : "Workflow",
              status: "running",
              statusCopy: "Starting…",
              href: "/workflows",
              startedAt: Date.now(),
            },
          });
        } else if (event === "workflow.step.started") {
          dispatch({
            type: "UPDATE",
            id: String(d.runId ?? ""),
            patch: { statusCopy: `Running ${String(d.stepType ?? "step")}…` },
          });
        } else if (event === "workflow.waiting_approval") {
          const approvalId = String(d.approvalId ?? "");
          dispatch({
            type: "UPDATE",
            id: String(d.runId ?? ""),
            patch: {
              status: "waiting_approval",
              statusCopy: "Waiting for your approval",
              approvalId,
              href: approvalId ? `/approvals/${approvalId}` : "/approvals",
            },
          });
        } else if (event === "workflow.run.completed") {
          const id = String(d.runId ?? "");
          dispatch({ type: "UPDATE", id, patch: { status: "completed", statusCopy: "Completed" } });
          scheduleRemove(id, 20_000);
        } else if (event === "workflow.run.failed") {
          dispatch({
            type: "UPDATE",
            id: String(d.runId ?? ""),
            patch: { status: "failed", statusCopy: "Run failed" },
          });
        }
      },
      [scheduleRemove],
    ),
  );

  return (
    <RunningStatusContext.Provider value={{ items, dismiss, setDropdownOpen }}>
      {children}
    </RunningStatusContext.Provider>
  );
}
