import type { Request, Response } from "express";

import { ApprovalExecutionService } from "../actions/approvalExecutionService.js";
import { requireUser } from "../auth/authMiddleware.js";
import { ApprovalService } from "../approvals/approvalService.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { logger } from "../observability/logger.js";
import { PolicyService } from "../policy/policyService.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";
import { ApiError } from "../utils/apiError.js";
import { WorkflowService } from "../workflows/workflowService.js";

function getRouteId(request: Request) {
  const id = request.params.id;

  if (!id || Array.isArray(id)) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "Approval ID is required.",
      status: 400,
    });
  }

  return id;
}

export async function createApproval(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new ApprovalService(getFirebaseDb());
  const policyService = new PolicyService();
  const decision = policyService.assertActionAllowed({
    currentWorkspace,
    toolName: request.body.proposedAction.toolName,
    actionType: request.body.proposedAction.actionType,
    requestedRiskLevel: request.body.riskLevel,
    requestedRequiresApproval: request.body.proposedAction.requiresApproval,
  });
  const approval = await service.createApproval({
    workspace: currentWorkspace.workspace,
    userId: user.id,
    title: request.body.title,
    reason: request.body.reason,
    type: request.body.type,
    preview: request.body.preview,
    proposedAction: {
      ...request.body.proposedAction,
      riskLevel: decision.riskLevel,
      requiresApproval: decision.requiresApproval,
    },
    riskLevel: decision.riskLevel,
    sourceRefs: request.body.sourceRefs,
    idempotencyKey: request.body.idempotencyKey,
  });

  response.status(201).json({ approvalId: approval.id });
}

export async function listApprovals(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new ApprovalService(getFirebaseDb());
  const approvals = await service.listApprovals(currentWorkspace.workspace, {
    status: typeof request.query.status === "string" ? request.query.status : undefined,
    agentId: typeof request.query.agentId === "string" ? request.query.agentId : undefined,
    workflowId: typeof request.query.workflowId === "string" ? request.query.workflowId : undefined,
    limit: typeof request.query.limit === "number" ? request.query.limit : undefined,
  });

  response.json({ approvals });
}

export async function getApproval(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new ApprovalService(getFirebaseDb());
  const approval = await service.getApproval(currentWorkspace.workspace, getRouteId(request));

  response.json(service.serializeApproval(approval));
}

export async function approveApproval(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const approvalId = getRouteId(request);
  const db = getFirebaseDb();
  const service = new ApprovalService(db);
  const executionService = new ApprovalExecutionService(db);

  // Load before state-change to capture workflowRunId
  const approval = await service.getApproval(currentWorkspace.workspace, approvalId);
  const result = await service.approve(currentWorkspace.workspace, approvalId, user.id);

  let responsePayload: { approvalId: string; status: "approved" | "executed" | "executing" | "failed"; error?: string } = result;
  let shouldResumeWorkflow = false;

  try {
    const executionResult = await executionService.executeApprovedAction(
      currentWorkspace,
      approval,
      user.id,
    );

    if (executionResult.status === "executed") {
      responsePayload = { approvalId, status: "executed" };
      shouldResumeWorkflow = true;
    } else if (executionResult.status === "executing") {
      responsePayload = { approvalId, status: "executing" };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Approved action execution failed.";

    if (approval.workflowRunId) {
      void new WorkflowService(db).failAfterApprovalExecutionError(
        currentWorkspace.workspace,
        approval.workflowRunId,
        approvalId,
        user.id,
        message,
      ).catch((workflowErr: unknown) => {
        logger.error("Failed to mark workflow run as failed after approval execution error", {
          approvalId,
          workflowRunId: approval.workflowRunId,
          error: workflowErr instanceof Error ? workflowErr.message : String(workflowErr),
        });
      });
    }

    return response.json({ approvalId, status: "failed" as const, error: message });
  }

  // Resume workflow run if this approval belongs to one (fire-and-forget, non-blocking)
  if (approval.workflowRunId && shouldResumeWorkflow) {
    void new WorkflowService(db).resumeAfterApproval(
      currentWorkspace.workspace,
      approval.workflowRunId,
      approvalId,
      user.id,
    ).catch((err: unknown) => {
      logger.error("Failed to resume workflow after approval", {
        approvalId,
        workflowRunId: approval.workflowRunId,
        error: err instanceof Error ? err.message : String(err),
      });
      });
  }

  response.json(responsePayload);
}

export async function retryApproval(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const approvalId = getRouteId(request);
  const db = getFirebaseDb();
  const service = new ApprovalService(db);
  const executionService = new ApprovalExecutionService(db);
  const approval = await service.getApproval(currentWorkspace.workspace, approvalId);
  const result = await service.retry(currentWorkspace.workspace, approvalId, user.id);
  let responsePayload: { approvalId: string; status: "approved" | "executed" | "executing" | "failed"; error?: string } = result;
  let shouldResumeWorkflow = false;

  try {
    const executionResult = await executionService.executeApprovedAction(
      currentWorkspace,
      approval,
      user.id,
      { retry: true },
    );

    if (executionResult.status === "executed") {
      responsePayload = { approvalId, status: "executed" };
      shouldResumeWorkflow = true;
    } else if (executionResult.status === "executing") {
      responsePayload = { approvalId, status: "executing" };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Approved action execution failed.";

    if (approval.workflowRunId) {
      void new WorkflowService(db).failAfterApprovalExecutionError(
        currentWorkspace.workspace,
        approval.workflowRunId,
        approvalId,
        user.id,
        message,
      ).catch((workflowErr: unknown) => {
        logger.error("Failed to mark workflow run as failed after approval retry execution error", {
          approvalId,
          workflowRunId: approval.workflowRunId,
          error: workflowErr instanceof Error ? workflowErr.message : String(workflowErr),
        });
      });
    }

    return response.json({ approvalId, status: "failed" as const, error: message });
  }

  if (approval.workflowRunId && shouldResumeWorkflow) {
    void new WorkflowService(db).resumeAfterApproval(
      currentWorkspace.workspace,
      approval.workflowRunId,
      approvalId,
      user.id,
    ).catch((err: unknown) => {
      logger.error("Failed to resume workflow after approval retry", {
        approvalId,
        workflowRunId: approval.workflowRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  response.json(responsePayload);
}

export async function rejectApproval(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const approvalId = getRouteId(request);
  const db = getFirebaseDb();
  const service = new ApprovalService(db);

  // Load before state-change to capture workflowRunId
  const approval = await service.getApproval(currentWorkspace.workspace, approvalId);
  const result = await service.reject(
    currentWorkspace.workspace,
    approvalId,
    user.id,
    request.body.reason,
  );

  // Cancel workflow run if this approval belongs to one (fire-and-forget, non-blocking)
  if (approval.workflowRunId) {
    void new WorkflowService(db).cancelAfterRejection(
      currentWorkspace.workspace,
      approval.workflowRunId,
      approvalId,
      user.id,
    ).catch((err: unknown) => {
      logger.error("Failed to cancel workflow after rejection", {
        approvalId,
        workflowRunId: approval.workflowRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  response.json(result);
}

export async function editApproval(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new ApprovalService(getFirebaseDb());
  const result = await service.edit(currentWorkspace.workspace, getRouteId(request), user.id, request.body);

  response.json(result);
}
