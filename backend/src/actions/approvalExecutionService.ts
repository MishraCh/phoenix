import type { Firestore } from "firebase-admin/firestore";

import { ApprovalService } from "../approvals/approvalService.js";
import { logger } from "../observability/logger.js";
import type { Approval } from "../schemas/coreSchemas.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { getToolDefinition } from "../tools/toolRegistry.js";

type ApprovalExecutionResult =
  | {
      status: "unsupported";
    }
  | {
      status: "executing";
      output: unknown;
    }
  | {
      status: "executed";
      output: unknown;
    };

function normalizeExecutionResult(output: unknown): Record<string, unknown> {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }

  return { value: output };
}

export class ApprovalExecutionService {
  private readonly approvalService: ApprovalService;

  constructor(private readonly db: Firestore) {
    this.approvalService = new ApprovalService(db);
  }

  async executeApprovedAction(
    currentWorkspace: CurrentWorkspace,
    approval: Approval,
    userId: string,
    options?: { retry?: boolean },
  ): Promise<ApprovalExecutionResult> {
    const toolDefinition = getToolDefinition(approval.proposedAction.toolName);

    if (!toolDefinition) {
      return { status: "unsupported" };
    }

    const claim = await this.approvalService.claimExecution(
      currentWorkspace.workspace,
      approval.id,
      userId,
      { retry: options?.retry ?? false },
    );

    if (claim.status === "already_executed") {
      return {
        status: "executed",
        output: claim.approval.executionResult ?? {},
      };
    }

    if (claim.status === "already_executing") {
      return {
        status: "executing",
        output: claim.approval.executionResult ?? {},
      };
    }

    try {
      const tool = toolDefinition.buildTool({
        db: this.db,
        currentWorkspace,
        userId,
        sourceRefs: approval.sourceRefs,
      });
      const output = await tool.invoke(approval.proposedAction.input);
      const executionResult = normalizeExecutionResult(output);
      const externalActionId =
        typeof executionResult["messageId"] === "string"
          ? executionResult["messageId"]
          : typeof executionResult["recordId"] === "string"
            ? executionResult["recordId"]
            : typeof executionResult["id"] === "string"
              ? executionResult["id"]
              : null;
      await this.approvalService.markExecuted(currentWorkspace.workspace, approval.id, userId, {
        executionLockId: claim.executionLockId,
        executionResult,
        externalActionId,
      });

      return {
        status: "executed",
        output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Approved action execution failed.";
      logger.error("Failed to execute approved action", {
        approvalId: approval.id,
        toolName: approval.proposedAction.toolName,
        actionType: approval.proposedAction.actionType,
        error: message,
      });
      await this.approvalService.markFailed(currentWorkspace.workspace, approval.id, message, userId, {
        executionLockId: claim.executionLockId,
      });
      throw error;
    }
  }
}
