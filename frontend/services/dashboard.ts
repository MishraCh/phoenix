import { apiFetch } from "./apiClient";

export type DashboardSummary = {
  pendingApprovals: number;
  activeWorkflowRuns: number;
  activeAgents: number;
  needsReviewMemoryCount: number;
  recentArtifacts: Array<{
    id: string;
    title: string;
    artifactType: string;
    createdAt: string;
  }>;
  notifications: Array<{
    id: string;
    title: string;
    read: boolean;
    createdAt: string;
  }>;
  unreadNotificationCount: number;
  credits: {
    used: number;
    limit: number;
  };
  contextHealth: "fresh" | "stale" | "partial" | "missing";
};

export const emptyDashboardSummary: DashboardSummary = {
  pendingApprovals: 0,
  activeWorkflowRuns: 0,
  activeAgents: 0,
  needsReviewMemoryCount: 0,
  recentArtifacts: [],
  notifications: [],
  unreadNotificationCount: 0,
  credits: {
    used: 0,
    limit: 100,
  },
  contextHealth: "missing",
};

export function fetchDashboardSummary(firebaseIdToken: string) {
  return apiFetch<DashboardSummary>("/dashboard/summary", {
    firebaseIdToken,
    method: "GET",
  });
}
