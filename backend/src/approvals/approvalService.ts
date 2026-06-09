import { randomUUID } from "node:crypto";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { ActivityService } from "../activity/activityService.js";
import { publishEvent } from "../sse/eventBus.js";
import {
  getCachedApprovals,
  invalidateCachedApprovals,
  invalidateCachedDashboardSummary,
  setCachedApprovals,
} from "../cache/requestStateCache.js";
import {
  approvalSchema,
  proposedActionSchema,
  sourceRefSchema,
  type Approval,
  type Workspace,
} from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";
import { JobLockService } from "../jobs/jobLockService.js";

type CreateApprovalInput = {
  workspace: Workspace;
  userId: string;
  title: string;
  reason: string;
  type: "email_send" | "crm_update" | "crm_create" | "slack_message" | "task_create" | "other";
  preview: Record<string, unknown>;
  proposedAction: unknown;
  riskLevel: "low" | "medium" | "high" | "critical";
  sourceRefs: unknown[];
  idempotencyKey: string;
  workflowId?: string;
  workflowRunId?: string;
};

type ListApprovalsOptions = {
  status?: string;
  agentId?: string;
  workflowId?: string;
  limit?: number;
};

type ClaimExecutionOptions = {
  retry?: boolean;
};

type ClaimExecutionResult =
  | { status: "claimed"; approval: Approval; executionLockId: string }
  | { status: "already_executed"; approval: Approval }
  | { status: "already_executing"; approval: Approval };

function serializeApproval(approval: ReturnType<typeof approvalSchema.parse>) {
  return {
    id: approval.id,
    title: approval.title,
    description: approval.reason,
    riskLevel: approval.riskLevel,
    status: approval.status,
    executionStatus: approval.executionStatus,
    proposedAction: approval.proposedAction,
    workflowId: approval.workflowId ?? null,
    workflowRunId: approval.workflowRunId ?? null,
    createdAt: approval.createdAt.toDate().toISOString(),
  };
}

export class ApprovalService {
  private readonly activityService: ActivityService;

  constructor(private readonly db: Firestore) {
    this.activityService = new ActivityService(db);
  }

  private collection(workspaceId: string) {
    return this.db.collection("workspaces").doc(workspaceId).collection("approvals");
  }

  async createApproval(input: CreateApprovalInput) {
    const existing = await this.collection(input.workspace.id)
      .where("idempotencyKey", "==", input.idempotencyKey)
      .limit(1)
      .get();

    if (!existing.empty) {
      return approvalSchema.parse({ id: existing.docs[0].id, ...existing.docs[0].data() });
    }

    const approvalRef = this.collection(input.workspace.id).doc();
    const now = Timestamp.now();
    const proposedAction = proposedActionSchema.parse(input.proposedAction);
    const sourceRefs = input.sourceRefs.map((sourceRef) => sourceRefSchema.parse(sourceRef));
    const approval = {
      id: approvalRef.id,
      workspaceId: input.workspace.id,
      type: input.type,
      status: "pending" as const,
      executionStatus: "not_started" as const,
      executionAttempts: 0,
      title: input.title,
      reason: input.reason,
      preview: input.preview,
      proposedAction,
      riskLevel: input.riskLevel,
      sourceRefs,
      idempotencyKey: input.idempotencyKey,
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      ...(input.workflowRunId ? { workflowRunId: input.workflowRunId } : {}),
      createdAt: now,
      updatedAt: now,
    };

    approvalSchema.parse(approval);
    await approvalRef.set(approval);
    invalidateCachedApprovals(input.workspace.id);
    invalidateCachedDashboardSummary(input.workspace.id);
    publishEvent([`workspace:${input.workspace.id}`], "approval.created", {
      workspaceId: input.workspace.id, approvalId: approvalRef.id, title: input.title, riskLevel: input.riskLevel, timestamp: new Date().toISOString(),
    });
    await this.activityService.createEvent({
      workspaceId: input.workspace.id,
      type: "approval.created",
      title: `Approval requested: ${input.title}`,
      actorType: "user",
      actorId: input.userId,
      related: { approvalId: approvalRef.id },
      metadata: { riskLevel: input.riskLevel },
    });

    return approval;
  }

  async listApprovals(workspace: Workspace, options: ListApprovalsOptions) {
    let allApprovals: Approval[];
    const cached = getCachedApprovals(workspace.id);
    if (cached) {
      allApprovals = cached;
    } else {
      const snapshot = await this.collection(workspace.id).limit(100).get();
      allApprovals = snapshot.docs.map((doc) => approvalSchema.parse({ id: doc.id, ...doc.data() }));
      setCachedApprovals(workspace.id, allApprovals);
    }

    return allApprovals
      .filter((approval) =>
        options.status ? approval.status === options.status : approval.status === "pending" || approval.status === "edited"
      )
      .filter((approval) => (options.agentId ? approval.createdByAgentId === options.agentId : true))
      .filter((approval) => (options.workflowId ? approval.workflowId === options.workflowId : true))
      .sort((left, right) => right.createdAt.toMillis() - left.createdAt.toMillis())
      .slice(0, options.limit ?? 50)
      .map(serializeApproval);
  }

  async getApproval(workspace: Workspace, approvalId: string) {
    const snapshot = await this.collection(workspace.id).doc(approvalId).get();

    if (!snapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Approval not found.",
        status: 404,
      });
    }

    return approvalSchema.parse({ id: snapshot.id, ...snapshot.data() });
  }

  async approve(workspace: Workspace, approvalId: string, userId: string) {
    const approval = await this.getApproval(workspace, approvalId);

    if (approval.status === "approved" || approval.status === "executed") {
      return { approvalId, status: approval.status };
    }

    if (approval.status !== "pending" && approval.status !== "edited") {
      throw new ApiError({
        code: "APPROVAL_NOT_PENDING",
        message: "Only pending or edited approvals can be approved.",
        status: 409,
      });
    }

    await this.collection(workspace.id).doc(approvalId).update({
      status: "approved",
      approvedBy: userId,
      approvedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    invalidateCachedApprovals(workspace.id);
    invalidateCachedDashboardSummary(workspace.id);
    publishEvent([`workspace:${workspace.id}`], "approval.approved", {
      workspaceId: workspace.id, approvalId, timestamp: new Date().toISOString(),
    });
    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "approval.approved",
      title: `Approval approved: ${approval.title}`,
      actorType: "user",
      actorId: userId,
      related: { approvalId },
    });

    return { approvalId, status: "approved" as const };
  }

  async retry(workspace: Workspace, approvalId: string, userId: string) {
    const approval = await this.getApproval(workspace, approvalId);

    if (approval.status !== "failed" && approval.executionStatus !== "failed") {
      throw new ApiError({
        code: "APPROVAL_NOT_RETRYABLE",
        message: "Only failed approvals can be retried.",
        status: 409,
      });
    }

    const now = Timestamp.now();
    await this.collection(workspace.id).doc(approvalId).update({
      status: "approved",
      approvedBy: approval.approvedBy ?? userId,
      approvedAt: approval.approvedAt ?? now,
      updatedAt: now,
    });
    invalidateCachedApprovals(workspace.id);
    invalidateCachedDashboardSummary(workspace.id);
    publishEvent([`workspace:${workspace.id}`], "approval.retry_requested", {
      workspaceId: workspace.id, approvalId, timestamp: new Date().toISOString(),
    });
    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "approval.retry_requested",
      title: `Approval retry requested: ${approval.title}`,
      actorType: "user",
      actorId: userId,
      related: { approvalId },
    });

    return { approvalId, status: "approved" as const };
  }

  async reject(workspace: Workspace, approvalId: string, userId: string, reason: string | null) {
    const approval = await this.getApproval(workspace, approvalId);

    if (approval.status !== "pending" && approval.status !== "edited") {
      throw new ApiError({
        code: "APPROVAL_NOT_PENDING",
        message: "Only pending or edited approvals can be rejected.",
        status: 409,
      });
    }

    await this.collection(workspace.id).doc(approvalId).update({
      status: "rejected",
      error: reason ?? undefined,
      updatedAt: Timestamp.now(),
    });
    invalidateCachedApprovals(workspace.id);
    invalidateCachedDashboardSummary(workspace.id);
    publishEvent([`workspace:${workspace.id}`], "approval.rejected", {
      workspaceId: workspace.id, approvalId, timestamp: new Date().toISOString(),
    });
    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "approval.rejected",
      title: `Approval rejected: ${approval.title}`,
      description: reason ?? undefined,
      actorType: "user",
      actorId: userId,
      related: { approvalId },
    });

    return { approvalId, status: "rejected" as const };
  }

  async edit(
    workspace: Workspace,
    approvalId: string,
    userId: string,
    patch: { proposedAction?: Record<string, unknown>; preview?: Record<string, unknown> }
  ) {
    const approval = await this.getApproval(workspace, approvalId);

    if (approval.status !== "pending" && approval.status !== "edited") {
      throw new ApiError({
        code: "APPROVAL_NOT_PENDING",
        message: "Only pending approvals can be edited.",
        status: 409,
      });
    }

    let proposedAction = approval.proposedAction;
    if (patch.proposedAction) {
      proposedAction = proposedActionSchema.parse({
        ...approval.proposedAction,
        ...patch.proposedAction,
        input: {
          ...(approval.proposedAction.input as Record<string, unknown>),
          ...(patch.proposedAction.input as Record<string, unknown> || {}),
        }
      });
    }

    const preview = patch.preview ? { ...approval.preview, ...patch.preview } : approval.preview;

    await this.collection(workspace.id).doc(approvalId).update({
      proposedAction,
      preview,
      riskLevel: proposedAction.riskLevel,
      status: "edited",
      wasEdited: true,
      updatedAt: Timestamp.now(),
    });
    invalidateCachedApprovals(workspace.id);
    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "approval.edited",
      title: `Approval edited: ${approval.title}`,
      actorType: "user",
      actorId: userId,
      related: { approvalId },
    });

    return { approvalId };
  }

  serializeApproval(approval: ReturnType<typeof approvalSchema.parse>) {
    return {
      ...serializeApproval(approval),
      type: approval.type,
      reason: approval.reason,
      preview: approval.preview,
      sourceRefs: approval.sourceRefs,
      idempotencyKey: approval.idempotencyKey,
      approvedBy: approval.approvedBy ?? null,
      approvedAt: approval.approvedAt?.toDate().toISOString() ?? null,
      executedAt: approval.executedAt?.toDate().toISOString() ?? null,
      executionLockId: approval.executionLockId ?? null,
      executionStartedAt: approval.executionStartedAt?.toDate().toISOString() ?? null,
      executionCompletedAt: approval.executionCompletedAt?.toDate().toISOString() ?? null,
      executionAttempts: approval.executionAttempts ?? 0,
      executionResult: approval.executionResult ?? null,
      externalActionId: approval.externalActionId ?? null,
      error: approval.error ?? null,
    };
  }

  async claimExecution(
    workspace: Workspace,
    approvalId: string,
    _userId: string,
    options: ClaimExecutionOptions = {},
  ): Promise<ClaimExecutionResult> {
    const docRef = this.collection(workspace.id).doc(approvalId);
    const executionLockId = randomUUID();
    let result: ClaimExecutionResult | null = null;

    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef);

      if (!snapshot.exists) {
        throw new ApiError({
          code: "NOT_FOUND",
          message: "Approval not found.",
          status: 404,
        });
      }

      const approval = approvalSchema.parse({ id: snapshot.id, ...snapshot.data() });

      if (approval.status === "executed" || approval.executionStatus === "executed") {
        result = { status: "already_executed", approval };
        return;
      }

      if (approval.executionStatus === "executing") {
        result = { status: "already_executing", approval };
        return;
      }

      const canRetry = options.retry && (approval.status === "failed" || approval.executionStatus === "failed");
      if (!canRetry && approval.status !== "approved") {
        throw new ApiError({
          code: "APPROVAL_NOT_EXECUTABLE",
          message: "Only approved approvals can be executed.",
          status: 409,
        });
      }

      const now = Timestamp.now();
      const updated: Approval = approvalSchema.parse({
        ...approval,
        status: "approved",
        executionStatus: "executing",
        executionLockId,
        executionStartedAt: now,
        executionCompletedAt: undefined,
        executionAttempts: (approval.executionAttempts ?? 0) + 1,
        executionResult: approval.executionResult,
        externalActionId: approval.externalActionId,
        error: undefined,
        updatedAt: now,
      });

      transaction.update(docRef, {
        status: updated.status,
        executionStatus: updated.executionStatus,
        executionLockId: updated.executionLockId,
        executionStartedAt: updated.executionStartedAt,
        executionAttempts: updated.executionAttempts,
        updatedAt: updated.updatedAt,
      });
      result = { status: "claimed", approval: updated, executionLockId };
    });

    invalidateCachedApprovals(workspace.id);
    invalidateCachedDashboardSummary(workspace.id);
    if (!result) {
      throw new ApiError({
        code: "APPROVAL_EXECUTION_CLAIM_FAILED",
        message: "Failed to claim approval execution.",
        status: 500,
      });
    }
    return result;
  }

  async markExecuted(
    workspace: Workspace,
    approvalId: string,
    userId: string,
    input: {
      executionLockId?: string | null;
      executionResult?: Record<string, unknown>;
      externalActionId?: string | null;
    } = {},
  ) {
    const approval = await this.getApproval(workspace, approvalId);
    const now = Timestamp.now();

    if (
      input.executionLockId &&
      approval.executionLockId &&
      approval.executionLockId !== input.executionLockId
    ) {
      throw new ApiError({
        code: "APPROVAL_EXECUTION_LOCK_MISMATCH",
        message: "Approval execution lock did not match the active execution.",
        status: 409,
      });
    }

    const patch: Record<string, unknown> = {
      status: "executed",
      executedAt: now,
      executionStatus: "executed",
      executionCompletedAt: now,
      updatedAt: now,
    };
    if (input.executionResult) patch["executionResult"] = input.executionResult;
    if (input.externalActionId) patch["externalActionId"] = input.externalActionId;

    await this.collection(workspace.id).doc(approvalId).update(patch);
    invalidateCachedApprovals(workspace.id);
    invalidateCachedDashboardSummary(workspace.id);
    publishEvent([`workspace:${workspace.id}`], "approval.executed", {
      workspaceId: workspace.id, approvalId, timestamp: new Date().toISOString(),
    });
    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "approval.executed",
      title: `Approval executed: ${approval.title}`,
      actorType: "user",
      actorId: userId,
      related: { approvalId },
    });

    if (approval.type === "email_send" && (approval as any).wasEdited) {
      const jobLockService = new JobLockService(this.db);
      await jobLockService.enqueueJob({
        workspaceId: workspace.id,
        jobType: "extract_memory_from_approval",
        userId,
        input: { approvalId },
      });
    }

    return { approvalId, status: "executed" as const };
  }

  async markFailed(
    workspace: Workspace,
    approvalId: string,
    error: string,
    userId: string,
    input: {
      executionLockId?: string | null;
      executionResult?: Record<string, unknown>;
    } = {},
  ) {
    const approval = await this.getApproval(workspace, approvalId);
    const now = Timestamp.now();

    if (
      input.executionLockId &&
      approval.executionLockId &&
      approval.executionLockId !== input.executionLockId
    ) {
      throw new ApiError({
        code: "APPROVAL_EXECUTION_LOCK_MISMATCH",
        message: "Approval execution lock did not match the active execution.",
        status: 409,
      });
    }

    const patch: Record<string, unknown> = {
      status: "failed",
      executionStatus: "failed",
      executionCompletedAt: now,
      error,
      updatedAt: now,
    };
    if (input.executionResult) patch["executionResult"] = input.executionResult;

    await this.collection(workspace.id).doc(approvalId).update(patch);
    invalidateCachedApprovals(workspace.id);
    invalidateCachedDashboardSummary(workspace.id);
    publishEvent([`workspace:${workspace.id}`], "approval.failed", {
      workspaceId: workspace.id, approvalId, timestamp: new Date().toISOString(),
    });
    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "approval.failed",
      title: `Approval failed: ${approval.title}`,
      description: error,
      actorType: "user",
      actorId: userId,
      related: { approvalId },
    });

    return { approvalId, status: "failed" as const, error };
  }
}
