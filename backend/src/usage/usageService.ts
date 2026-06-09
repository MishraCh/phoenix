import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import { visibleAgentRegistry } from "../agents/agentRegistry.js";
import {
  getCachedIntegrationsCount,
  setCachedIntegrationsCount,
} from "../cache/requestStateCache.js";
import type { Workspace } from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";

/**
 * Canonical free plan monthly credit limit.
 * Must match the hardcoded value in:
 *   - backend/src/auth/authBootstrapService.ts
 *   - backend/src/repositories/workspaceRepository.ts
 * Change all three together when adjusting the free tier.
 */
export const FREE_PLAN_CREDITS_LIMIT = 50;

// ─── In-memory rate limit counters ────────────────────────────────────────────
// Tracks command counts per workspace and per user within a rolling 1-hour window.
// Single-process safe. If multiple backend replicas are ever deployed, move this
// to a shared Redis store.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

type RateLimitEntry = { count: number; windowStart: number };
const workspaceCommandCounts = new Map<string, RateLimitEntry>();
const userCommandCounts = new Map<string, RateLimitEntry>();

function incrementRateLimitCounter(map: Map<string, RateLimitEntry>, key: string): number {
  const now = Date.now();
  const existing = map.get(key);

  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    map.set(key, { count: 1, windowStart: now });
    return 1;
  }

  existing.count += 1;
  return existing.count;
}

function getRateLimitCount(map: Map<string, RateLimitEntry>, key: string): number {
  const now = Date.now();
  const existing = map.get(key);
  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) return 0;
  return existing.count;
}

export type GideonOperationType =
  | "simple_command"
  | "workflow_run"
  | "workflow_agent_step"
  | "integration_sync"
  | "manual_artifact";

const operationCredits: Record<GideonOperationType, number> = {
  simple_command: 1,
  workflow_run: 5,
  // workflow_agent_step: charged per agent step inside a workflow run (separate from the run charge)
  workflow_agent_step: 1,
  integration_sync: 2,
  manual_artifact: 0,
};

const planLimits = {
  free: {
    integrations: 1,
    activeAgents: 1,
    activeWorkflows: 2,
    customWorkflows: 1,
    commandUserPerHour: 20,
    commandWorkspacePerHour: 60,
  },
  plus: {
    integrations: 3,
    activeAgents: 4,
    activeWorkflows: 10,
    customWorkflows: 5,
    commandUserPerHour: 120,
    commandWorkspacePerHour: 300,
  },
  pro: {
    integrations: 8,
    activeAgents: 10,
    activeWorkflows: 50,
    customWorkflows: 25,
    commandUserPerHour: 500,
    commandWorkspacePerHour: 1200,
  },
} satisfies Record<
  Workspace["plan"],
  {
    integrations: number;
    activeAgents: number;
    activeWorkflows: number;
    customWorkflows: number;
    commandUserPerHour: number;
    commandWorkspacePerHour: number;
  }
>;

export function assertCreditsAvailable(workspace: Workspace, creditsNeeded: number) {
  if (workspace.monthlyCreditsUsed + creditsNeeded > workspace.monthlyCreditsLimit) {
    throw new ApiError({
      code: "CREDIT_LIMIT_EXCEEDED",
      message: "This workspace does not have enough remaining Gideon credits.",
      status: 429,
      details: {
        creditsNeeded,
        monthlyCreditsLimit: workspace.monthlyCreditsLimit,
        monthlyCreditsUsed: workspace.monthlyCreditsUsed,
      },
    });
  }
}

export function getPlanLimits(plan: Workspace["plan"]) {
  return planLimits[plan];
}

export class UsageService {
  constructor(private readonly db: Firestore) {}

  private collection(workspaceId: string) {
    return this.db.collection("workspaces").doc(workspaceId).collection("usage");
  }

  async chargeCredits(workspace: Workspace, credits: number) {
    return this.chargeOperation({
      workspace,
      operationType: "manual_artifact",
      creditsOverride: credits,
    });
  }

  async assertCommandRateLimit(workspace: Workspace, userId: string) {
    const limits = getPlanLimits(workspace.plan);
    const workspaceKey = workspace.id;
    const userKey = `${workspace.id}:${userId}`;

    // Read current window counts BEFORE incrementing
    const workspaceCount = getRateLimitCount(workspaceCommandCounts, workspaceKey);
    const userCount = getRateLimitCount(userCommandCounts, userKey);

    if (workspaceCount >= limits.commandWorkspacePerHour) {
      throw new ApiError({
        code: "RATE_LIMIT_EXCEEDED",
        message: "This workspace has reached its hourly command limit. Try again later or upgrade the plan.",
        status: 429,
        details: {
          limitType: "workspace_commands_per_hour",
          current: workspaceCount,
          limit: limits.commandWorkspacePerHour,
          plan: workspace.plan,
        },
      });
    }

    if (userCount >= limits.commandUserPerHour) {
      throw new ApiError({
        code: "RATE_LIMIT_EXCEEDED",
        message: "You have reached your hourly command limit in this workspace. Try again later.",
        status: 429,
        details: {
          limitType: "user_commands_per_hour",
          current: userCount,
          limit: limits.commandUserPerHour,
          plan: workspace.plan,
        },
      });
    }

    // Increment AFTER all checks pass — only count successful command starts
    incrementRateLimitCounter(workspaceCommandCounts, workspaceKey);
    incrementRateLimitCounter(userCommandCounts, userKey);
  }

  async assertIntegrationLimit(workspace: Workspace, existingProvider?: string | null) {
    const limits = getPlanLimits(workspace.plan);

    // Use cached count to avoid a full collection scan on every connect attempt.
    // The existingProvider case is a reconnect — same provider, so count stays the same.
    // We only skip the cache when adding a NEW provider (existingProvider is null/undefined).
    let activeIntegrations: number;
    const cached = getCachedIntegrationsCount(workspace.id);

    if (cached !== null && existingProvider) {
      // Reconnect path: use cached count directly (same provider, count unchanged)
      activeIntegrations = cached;
    } else {
      // New connection or cold cache: do a real Firestore read
      const snapshot = await this.db
        .collection("workspaces")
        .doc(workspace.id)
        .collection("integrations")
        .get();
      activeIntegrations = snapshot.docs.filter((doc) => {
        const data = doc.data();
        const isSameProvider = existingProvider ? doc.id === existingProvider : false;
        return !isSameProvider && data.status !== "disabled";
      }).length;
      // Cache the fresh count for subsequent calls
      setCachedIntegrationsCount(workspace.id, activeIntegrations);
    }

    if (activeIntegrations >= limits.integrations) {
      throw new ApiError({
        code: "PLAN_LIMIT_EXCEEDED",
        message: `The ${workspace.plan} plan supports up to ${limits.integrations} connected integrations.`,
        status: 429,
        details: {
          limitType: "integrations",
          current: activeIntegrations,
          limit: limits.integrations,
          plan: workspace.plan,
        },
      });
    }
  }

  async assertCustomWorkflowLimit(workspace: Workspace) {
    const limits = getPlanLimits(workspace.plan);
    const snapshot = await this.db
      .collection("workspaces")
      .doc(workspace.id)
      .collection("workflows")
      .where("type", "==", "custom")
      .get();

    if (snapshot.size >= limits.customWorkflows) {
      throw new ApiError({
        code: "PLAN_LIMIT_EXCEEDED",
        message: `The ${workspace.plan} plan supports up to ${limits.customWorkflows} custom workflows.`,
        status: 429,
        details: {
          limitType: "custom_workflows",
          current: snapshot.size,
          limit: limits.customWorkflows,
          plan: workspace.plan,
        },
      });
    }
  }

  async assertActiveWorkflowLimit(workspace: Workspace, excludedWorkflowId?: string) {
    const limits = getPlanLimits(workspace.plan);
    const snapshot = await this.db
      .collection("workspaces")
      .doc(workspace.id)
      .collection("workflows")
      .where("status", "==", "active")
      .get();
    const activeCount = snapshot.docs.filter((doc) => doc.id !== excludedWorkflowId).length;

    if (activeCount >= limits.activeWorkflows) {
      throw new ApiError({
        code: "PLAN_LIMIT_EXCEEDED",
        message: `The ${workspace.plan} plan supports up to ${limits.activeWorkflows} active workflows.`,
        status: 429,
        details: {
          limitType: "active_workflows",
          current: activeCount,
          limit: limits.activeWorkflows,
          plan: workspace.plan,
        },
      });
    }
  }

  getAccessibleAgentIds(workspace: Workspace) {
    const limits = getPlanLimits(workspace.plan);
    return visibleAgentRegistry.slice(0, limits.activeAgents).map((agent) => agent.id);
  }

  assertAgentAllowedForPlan(workspace: Workspace, agentId: string) {
    if (!this.getAccessibleAgentIds(workspace).includes(agentId)) {
      const limits = getPlanLimits(workspace.plan);
      throw new ApiError({
        code: "PLAN_LIMIT_EXCEEDED",
        message: `The ${workspace.plan} plan currently unlocks ${limits.activeAgents} assistant${limits.activeAgents === 1 ? "" : "s"}.`,
        status: 429,
        details: {
          limitType: "active_agents",
          requestedAgentId: agentId,
          allowedAgentIds: this.getAccessibleAgentIds(workspace),
          limit: limits.activeAgents,
          plan: workspace.plan,
        },
      });
    }
  }

  async chargeOperation(input: {
    workspace: Workspace;
    userId?: string;
    operationType: GideonOperationType;
    metadata?: Record<string, unknown>;
    creditsOverride?: number;
  }) {
    const creditsToCharge = input.creditsOverride ?? operationCredits[input.operationType];

    if (input.operationType === "simple_command" && input.userId) {
      await this.assertCommandRateLimit(input.workspace, input.userId);
    }

    assertCreditsAvailable(input.workspace, creditsToCharge);

    const usageRef = this.collection(input.workspace.id).doc();
    const now = Timestamp.now();

    await this.db.runTransaction(async (transaction) => {
      transaction.set(usageRef, {
        id: usageRef.id,
        workspaceId: input.workspace.id,
        userId: input.userId,
        operationType: input.operationType,
        creditsCharged: creditsToCharge,
        metadata: input.metadata ?? {},
        createdAt: now,
      });

      transaction.update(this.db.collection("workspaces").doc(input.workspace.id), {
        monthlyCreditsUsed: FieldValue.increment(creditsToCharge),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return {
      creditsCharged: creditsToCharge,
    };
  }
}
