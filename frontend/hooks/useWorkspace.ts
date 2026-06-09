"use client";

import { createContext, useContext } from "react";

import type { AuthMe } from "@/services/auth";
import type { WorkspaceListItem } from "@/services/workspaces";

export type WorkspaceContextValue = {
  me: AuthMe["user"] | null;
  workspaces: WorkspaceListItem[];
  selectedWorkspaceId: string | null;
  selectedWorkspace: WorkspaceListItem | null;
  loading: boolean;
  error: string | null;
  selectingWorkspaceId: string | null;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (name?: string) => Promise<void>;
  joinWorkspace: (input: { workspaceId: string; inviteCode: string }) => Promise<void>;
  refresh: () => Promise<void>;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const value = useContext(WorkspaceContext);

  if (!value) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  }

  return value;
}
