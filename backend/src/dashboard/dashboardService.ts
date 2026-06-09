import type { Request } from "express";
import type { Firestore } from "firebase-admin/firestore";

import { getCachedDashboardSummary, setCachedDashboardSummary } from "../cache/requestStateCache.js";
import { timeRequestPhase } from "../observability/requestTiming.js";
import { notificationSchema, type Workspace } from "../schemas/coreSchemas.js";

export type DashboardSummary = {
  pendingApprovals: number;
  activeWorkflowRuns: number;
  activeAgents: number;
  needsReviewMemoryCount: number;
  recentArtifacts: Array<{ id: string; title: string; artifactType: string; createdAt: string }>;
  notifications: Array<{ id: string; title: string; read: boolean; createdAt: string }>;
  // capped at 50 unread; upgrade to Firestore count() aggregate when firebase-admin supports it cleanly
  unreadNotificationCount: number;
  credits: { used: number; limit: number };
  contextHealth: "partial";
};

function toIso(value: { toDate: () => Date } | undefined) {
  return value ? value.toDate().toISOString() : new Date(0).toISOString();
}

export class DashboardService {
  constructor(private readonly db: Firestore) {}

  async getSummary(workspace: Workspace, userId: string, request?: Request): Promise<DashboardSummary> {
    const cached = getCachedDashboardSummary(workspace.id, userId);
    if (cached) return cached as DashboardSummary;

    const workspaceRef = this.db.collection("workspaces").doc(workspace.id);

    const [
      pendingApprovalsSnapshot,
      activeWorkflowRunsSnapshot,
      activeAgentsSnapshot,
      needsReviewMemorySnapshot,
      recentArtifactsSnapshot,
      notificationsSnapshot,
    ] = await Promise.all([
      timeRequestPhase(request, "dashboard.approvals_query", async () =>
        workspaceRef.collection("approvals").where("status", "in", ["pending", "edited"]).get(),
      ),
      timeRequestPhase(request, "dashboard.workflow_runs_query", async () =>
        workspaceRef
          .collection("workflowRuns")
          .where("status", "in", ["queued", "running", "waiting_approval"])
          .get(),
      ),
      timeRequestPhase(request, "dashboard.active_agents_query", async () =>
        workspaceRef.collection("agents").where("status", "==", "active").get(),
      ),
      timeRequestPhase(request, "dashboard.needs_review_memory_query", async () =>
        workspaceRef.collection("memory").where("status", "==", "needs_review").get(),
      ),
      timeRequestPhase(request, "dashboard.recent_artifacts_query", async () =>
        workspaceRef.collection("artifacts").orderBy("createdAt", "desc").limit(5).get(),
      ),
      timeRequestPhase(request, "dashboard.notifications_query", async () =>
        workspaceRef
          .collection("notifications")
          .where("userId", "==", userId)
          .where("status", "==", "unread")
          .orderBy("createdAt", "desc")
          .limit(50)
          .get(),
      ),
    ]);

    const summary = {
      pendingApprovals: pendingApprovalsSnapshot.size,
      activeWorkflowRuns: activeWorkflowRunsSnapshot.size,
      activeAgents: activeAgentsSnapshot.size,
      needsReviewMemoryCount: needsReviewMemorySnapshot.size,
      recentArtifacts: recentArtifactsSnapshot.docs.map((doc) => {
        const data = doc.data();

        return {
          id: doc.id,
          title: String(data.title ?? "Untitled artifact"),
          artifactType: String(data.type ?? data.artifactType ?? "artifact"),
          createdAt: toIso(data.createdAt),
        };
      }),
      notifications: notificationsSnapshot.docs
        .slice(0, 5)
        .map((doc) => notificationSchema.parse({ id: doc.id, ...doc.data() }))
        .map((notification) => ({
          id: notification.id,
          title: notification.title,
          read: notification.status === "read",
          createdAt: notification.createdAt.toDate().toISOString(),
        })),
      unreadNotificationCount: notificationsSnapshot.size,
      credits: {
        used: workspace.monthlyCreditsUsed,
        limit: workspace.monthlyCreditsLimit,
      },
      contextHealth: "partial" as const,
    };

    setCachedDashboardSummary(workspace.id, userId, summary);
    return summary;
  }
}
