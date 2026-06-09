import { getVisibleAgent } from "../agents/agentRegistry.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import type { WorkspaceRole } from "../schemas/coreSchemas.js";
import { requireToolDefinition } from "../tools/toolRegistry.js";
import { ApiError } from "../utils/apiError.js";

export type PolicyDecision = {
  toolName: string;
  actionType: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  status: "allowed" | "approval_recommended" | "approval_required" | "blocked";
  requiresApproval: boolean;
  reason: string;
};

type EvaluateActionInput = {
  currentWorkspace: CurrentWorkspace;
  toolName: string;
  actionType: string;
  agentId?: string | null;
  requestedRiskLevel?: "low" | "medium" | "high" | "critical";
  requestedRequiresApproval?: boolean;
};

const riskOrder: Record<PolicyDecision["riskLevel"], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function maxRiskLevel(
  left: PolicyDecision["riskLevel"],
  right?: PolicyDecision["riskLevel"],
): PolicyDecision["riskLevel"] {
  if (!right) {
    return left;
  }

  return riskOrder[right] > riskOrder[left] ? right : left;
}

function isWriteRestrictedRole(role: WorkspaceRole) {
  return role === "viewer";
}

function isWriteLike(permissionsRequired: string[]) {
  return permissionsRequired.some((permission) => permission.includes("write"));
}

export class PolicyService {
  evaluateAction(input: EvaluateActionInput): PolicyDecision {
    const toolDefinition = requireToolDefinition(input.toolName);
    const riskLevel = maxRiskLevel(toolDefinition.riskLevel, input.requestedRiskLevel);
    const visibleAgent = input.agentId ? getVisibleAgent(input.agentId) : null;

    if (input.agentId && !visibleAgent) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Agent not found for policy evaluation.",
        status: 404,
      });
    }

    if (visibleAgent && !visibleAgent.toolsAllowed.includes(input.toolName)) {
      return {
        toolName: input.toolName,
        actionType: input.actionType,
        riskLevel,
        status: "blocked",
        requiresApproval: false,
        reason: `${visibleAgent.name} is not allowed to use ${input.toolName}.`,
      };
    }

    if (isWriteRestrictedRole(input.currentWorkspace.role) && isWriteLike(toolDefinition.permissionsRequired)) {
      return {
        toolName: input.toolName,
        actionType: input.actionType,
        riskLevel,
        status: "blocked",
        requiresApproval: false,
        reason: "Viewers can inspect workspace data, but cannot create or route write actions.",
      };
    }

    if (riskLevel === "critical") {
      return {
        toolName: input.toolName,
        actionType: input.actionType,
        riskLevel,
        status: "blocked",
        requiresApproval: false,
        reason: "Critical actions are blocked in the current MVP policy layer.",
      };
    }

    if (toolDefinition.requiresApproval || input.requestedRequiresApproval || riskLevel === "high") {
      return {
        toolName: input.toolName,
        actionType: input.actionType,
        riskLevel,
        status: "approval_required",
        requiresApproval: true,
        reason: "This action must go through approval before any execution step.",
      };
    }

    if (riskLevel === "medium") {
      return {
        toolName: input.toolName,
        actionType: input.actionType,
        riskLevel,
        status: "approval_recommended",
        requiresApproval: false,
        reason: "This action is medium risk, so approval is recommended.",
      };
    }

    return {
      toolName: input.toolName,
      actionType: input.actionType,
      riskLevel,
      status: "allowed",
      requiresApproval: false,
      reason: "This action is low risk and can proceed within the current policy rules.",
    };
  }

  assertActionAllowed(input: EvaluateActionInput) {
    const decision = this.evaluateAction(input);

    if (decision.status === "blocked") {
      throw new ApiError({
        code: "POLICY_BLOCKED",
        message: decision.reason,
        status: 403,
        details: decision,
      });
    }

    return decision;
  }
}
