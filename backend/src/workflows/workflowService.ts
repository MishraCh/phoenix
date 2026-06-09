import type { Request } from "express";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { ActivityService } from "../activity/activityService.js";
import {
  getCachedWorkflows,
  invalidateCachedDashboardSummary,
  invalidateCachedWorkflows,
  setCachedWorkflows,
} from "../cache/requestStateCache.js";
import { JobLockService } from "../jobs/jobLockService.js";
import { logger } from "../observability/logger.js";
import { env } from "../config/env.js";
import { timeRequestPhase } from "../observability/requestTiming.js";
import {
  workflowRunSchema,
  workflowSchema,
  type Workflow,
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowTrigger,
  type Workspace,
} from "../schemas/coreSchemas.js";
import { UsageService } from "../usage/usageService.js";
import { ApiError } from "../utils/apiError.js";
import { computeNextRunAt, inferPlaceholders, validateCron } from "./workflowUtils.js";
import { getWorkflowTemplate, workflowTemplates, type WorkflowTemplate } from "./workflowTemplates.js";

export type ApiWorkflowTrigger = {
  type: "manual" | "scheduled" | "schedule" | "integration_event";
  config?: Record<string, unknown>;
};

export type CreateWorkflowInput = {
  workspace: Workspace;
  userId: string;
  name: string;
  description?: string;
  type: "custom";
  trigger: ApiWorkflowTrigger;
  steps: WorkflowStep[];
  approvalPolicy?: Record<string, unknown>;
  notificationPolicy?: Record<string, unknown>;
};

export type UpdateWorkflowInput = Partial<
  Pick<Workflow, "name" | "description" | "status" | "steps" | "approvalPolicy" | "notificationPolicy">
> & {
  trigger?: ApiWorkflowTrigger;
};

function collection(db: Firestore, workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("workflows");
}

function runCollection(db: Firestore, workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("workflowRuns");
}

function toWorkflowTrigger(trigger: ApiWorkflowTrigger): WorkflowTrigger {
  if (trigger.type === "manual") {
    return { type: "manual" };
  }

  if (trigger.type === "scheduled" || trigger.type === "schedule") {
    const cron = String(trigger.config?.cron ?? "0 9 * * *");
    const timezone = String(trigger.config?.timezone ?? "UTC");
    if (!validateCron(cron, timezone)) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: `Invalid cron expression: "${cron}". Use standard 5-field cron syntax (e.g. "0 9 * * *").`,
        status: 400,
      });
    }
    return { type: "schedule", cron, timezone };
  }

  return {
    type: "integration_event",
    provider: String(trigger.config?.provider ?? "google"),
    eventType: String(trigger.config?.eventType ?? "placeholder.event"),
  };
}

// Returns the next scheduled Timestamp for a schedule trigger.
// Pass `existing` to reuse an already-computed value (trigger unchanged); omit to force recompute.
function resolveNextRunAt(trigger: WorkflowTrigger, existing?: Timestamp): Timestamp | undefined {
  if (trigger.type !== "schedule") return undefined;
  if (existing) return existing;
  try {
    return Timestamp.fromDate(computeNextRunAt(trigger.cron, trigger.timezone));
  } catch {
    return undefined;
  }
}

function triggerType(trigger: WorkflowTrigger) {
  return trigger.type === "schedule" ? "scheduled" : trigger.type;
}

function sortSteps(steps: WorkflowStep[]) {
  return [...steps].sort((left, right) => left.order - right.order);
}

function serializeWorkflowListItem(workflow: Workflow | WorkflowTemplate, status = "draft") {
  const isStored = "workspaceId" in workflow;
  return {
    id: workflow.id,
    name: workflow.name,
    type: isStored ? workflow.type : "template" as const,
    status,
    triggerType: triggerType(workflow.trigger),
    nextRunAt: isStored ? (workflow.nextRunAt?.toDate().toISOString() ?? null) : null,
  };
}

function serializeWorkflow(workflow: Workflow | WorkflowTemplate) {
  const isStored = "workspaceId" in workflow;
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? null,
    type: isStored ? workflow.type : "template" as const,
    status: isStored ? workflow.status : "draft",
    trigger: workflow.trigger,
    steps: sortSteps(workflow.steps),
    approvalPolicy: isStored ? workflow.approvalPolicy : { default: "external_only" },
    notificationPolicy: isStored ? workflow.notificationPolicy : { channel: "in_app" },
    version: isStored ? workflow.version : 1,
    createdAt: isStored ? workflow.createdAt.toDate().toISOString() : null,
    updatedAt: isStored ? workflow.updatedAt.toDate().toISOString() : null,
    nextRunAt: isStored ? (workflow.nextRunAt?.toDate().toISOString() ?? null) : null,
    lastRunAt: isStored ? (workflow.lastRunAt?.toDate().toISOString() ?? null) : null,
  };
}

function serializeRun(run: WorkflowRun) {
  return {
    runId: run.id,
    status: run.status,
    triggeredBy: run.triggeredBy,
    scheduledForAt: run.scheduledForAt ? run.scheduledForAt.toDate().toISOString() : null,
    startedAt: run.startedAt ? run.startedAt.toDate().toISOString() : null,
    completedAt: run.completedAt ? run.completedAt.toDate().toISOString() : null,
    stepResults: run.progress.map((step) => ({
      stepId: step.stepId,
      name: step.name,
      status: step.status,
      startedAt: step.startedAt ? step.startedAt.toDate().toISOString() : null,
      completedAt: step.completedAt ? step.completedAt.toDate().toISOString() : null,
      outputSummary: step.outputSummary ?? null,
      error: step.error ?? null,
      approvalId: step.approvalId ?? null,
    })),
    error: run.error ?? null,
    outputSummary: run.outputSummary ?? null,
    artifactIds: run.artifactIds ?? [],
  };
}

function serializeRunListItem(run: WorkflowRun) {
  const durationMs =
    run.completedAt && run.startedAt
      ? run.completedAt.toMillis() - run.startedAt.toMillis()
      : null;
  return {
    runId: run.id,
    status: run.status,
    triggeredBy: run.triggeredBy,
    scheduledForAt: run.scheduledForAt ? run.scheduledForAt.toDate().toISOString() : null,
    startedAt: run.startedAt ? run.startedAt.toDate().toISOString() : null,
    completedAt: run.completedAt ? run.completedAt.toDate().toISOString() : null,
    durationMs,
    stepCount: run.progress.length,
    outputSummary: run.outputSummary ?? null,
    error: run.error ?? null,
  };
}

export class WorkflowService {
  private readonly activityService: ActivityService;
  private readonly jobLockService: JobLockService;
  private readonly usageService: UsageService;

  constructor(private readonly db: Firestore) {
    this.activityService = new ActivityService(db);
    this.jobLockService = new JobLockService(db);
    this.usageService = new UsageService(db);
  }

  async listWorkflows(workspace: Workspace, request?: Request) {
    const cachedCustom = getCachedWorkflows(workspace.id);
    const customWorkflows = cachedCustom
      ? cachedCustom
          .sort((left, right) => right.updatedAt.toMillis() - left.updatedAt.toMillis())
          .map((workflow) => serializeWorkflowListItem(workflow, workflow.status))
      : await (async () => {
          const snapshot = await timeRequestPhase(request, "workflows.list_query", async () =>
            collection(this.db, workspace.id).limit(100).get(),
          );
          const parsed = snapshot.docs
            .map((doc) => workflowSchema.parse({ id: doc.id, ...doc.data() }));
          setCachedWorkflows(workspace.id, parsed);
          return parsed
            .sort((left, right) => right.updatedAt.toMillis() - left.updatedAt.toMillis())
            .map((workflow) => serializeWorkflowListItem(workflow, workflow.status));
        })();

    return [...workflowTemplates.map((template) => serializeWorkflowListItem(template)), ...customWorkflows];
  }

  async createWorkflow(input: CreateWorkflowInput) {
    await this.usageService.assertCustomWorkflowLimit(input.workspace);
    const workflowRef = collection(this.db, input.workspace.id).doc();
    const now = Timestamp.now();
    const trigger = toWorkflowTrigger(input.trigger);
    const workflow = workflowSchema.parse({
      id: workflowRef.id,
      workspaceId: input.workspace.id,
      name: input.name,
      description: input.description,
      type: input.type,
      status: "draft",
      trigger,
      steps: sortSteps(input.steps),
      approvalPolicy: input.approvalPolicy ?? { default: "external_only" },
      notificationPolicy: input.notificationPolicy ?? { channel: "in_app" },
      version: 1,
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
      nextRunAt: resolveNextRunAt(trigger),
    });

    await workflowRef.set(workflow);
    invalidateCachedWorkflows(input.workspace.id);
    invalidateCachedDashboardSummary(input.workspace.id);
    await this.activityService.createEvent({
      workspaceId: input.workspace.id,
      type: "workflow.created",
      title: `Workflow draft created: ${input.name}`,
      actorType: "user",
      actorId: input.userId,
      related: { workflowId: workflow.id },
      metadata: { triggerType: triggerType(workflow.trigger), stepCount: workflow.steps.length },
    });

    return workflow;
  }

  async getWorkflow(workspace: Workspace, workflowId: string) {
    const template = getWorkflowTemplate(workflowId);

    if (template) {
      return serializeWorkflow(template);
    }

    const snapshot = await collection(this.db, workspace.id).doc(workflowId).get();

    if (!snapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Workflow not found.",
        status: 404,
      });
    }

    return serializeWorkflow(workflowSchema.parse({ id: snapshot.id, ...snapshot.data() }));
  }

  async updateWorkflow(workspace: Workspace, workflowId: string, userId: string, input: UpdateWorkflowInput) {
    const workflowRef = collection(this.db, workspace.id).doc(workflowId);
    const snapshot = await workflowRef.get();

    if (!snapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Workflow not found.",
        status: 404,
      });
    }

    const existing = workflowSchema.parse({ id: snapshot.id, ...snapshot.data() });

    if (input.status === "active" && existing.status !== "active") {
      await this.usageService.assertActiveWorkflowLimit(workspace, workflowId);
    }

    const newTrigger = input.trigger ? toWorkflowTrigger(input.trigger) : existing.trigger;
    const triggerChanged = input.trigger !== undefined;
    // Recompute nextRunAt when: trigger changes, activating from non-active, or nextRunAt not yet set
    const effectiveStatus = input.status ?? existing.status;
    const becomingActive = input.status === "active" && existing.status !== "active";
    const needsRecompute = triggerChanged || becomingActive || !existing.nextRunAt;
    const nextRunAt = resolveNextRunAt(
      newTrigger,
      needsRecompute ? undefined : existing.nextRunAt,
    );
    // If trigger is no longer schedule and it was before, clear scheduling fields
    const lastRunAt = newTrigger.type === "schedule" ? existing.lastRunAt : undefined;
    void effectiveStatus; // used above in becomingActive; referenced to avoid TS unused warning

    const workflow = workflowSchema.parse({
      ...existing,
      ...input,
      trigger: newTrigger,
      steps: input.steps ? sortSteps(input.steps) : existing.steps,
      version: existing.version + 1,
      updatedAt: Timestamp.now(),
      nextRunAt,
      lastRunAt,
    });

    await workflowRef.set(workflow);
    invalidateCachedWorkflows(workspace.id);
    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "workflow.updated",
      title: `Workflow ${workflow.status}: ${workflow.name}`,
      actorType: "user",
      actorId: userId,
      related: { workflowId },
      metadata: { version: workflow.version },
    });

    return workflow;
  }

  async startRun(workspace: Workspace, workflowId: string, userId: string, inputSnapshot: Record<string, unknown> = {}) {
    const workflowSnapshot = await collection(this.db, workspace.id).doc(workflowId).get();

    if (!workflowSnapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Workflow not found.",
        status: 404,
      });
    }

    const workflow = workflowSchema.parse({ id: workflowSnapshot.id, ...workflowSnapshot.data() });

    if (workflow.status === "archived") {
      throw new ApiError({
        code: "WORKFLOW_ARCHIVED",
        message: "Archived workflows cannot be run.",
        status: 400,
      });
    }

    // Validate all required placeholders are provided
    const requiredPlaceholders = inferPlaceholders(workflow.steps);
    const missingKeys = requiredPlaceholders.filter((key) => !(key in inputSnapshot));
    if (missingKeys.length > 0) {
      throw new ApiError({
        code: "MISSING_PLACEHOLDER_INPUTS",
        message: `Workflow requires input values for: ${missingKeys.join(", ")}`,
        status: 400,
      });
    }

    await this.usageService.chargeOperation({
      workspace,
      userId,
      operationType: "workflow_run",
      metadata: { workflowId },
    });

    const runRef = runCollection(this.db, workspace.id).doc();
    const now = Timestamp.now();
    // All runs start queued and go through the Job Queue (which routes via QStash or local polling)
    const initialStatus = "queued";
    const run = workflowRunSchema.parse({
      id: runRef.id,
      workspaceId: workspace.id,
      workflowId,
      status: initialStatus,
      currentStepId: workflow.steps[0]?.id,
      progress: sortSteps(workflow.steps).map((step) => ({
        stepId: step.id,
        name: step.name,
        status: "pending",
      })),
      inputSnapshot,
      artifactIds: [],
      approvalIds: [],
      dedupeKey: `run_workflow:${workspace.id}:${workflowId}:${runRef.id}`,
      startedAt: now,
      triggeredBy: "user",
      triggeredByUserId: userId,
    });

    await runRef.set(run);
    invalidateCachedDashboardSummary(workspace.id);

    await this.jobLockService.enqueueJob({
      workspaceId: workspace.id,
      jobType: "run_workflow",
      workflowId,
      runId: run.id,
      userId,
      input: inputSnapshot,
      dedupeKey: run.dedupeKey,
    });

    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "workflow.run_queued",
      title: `Workflow run queued: ${workflow.name}`,
      actorType: "user",
      actorId: userId,
      related: { workflowId, workflowRunId: run.id },
      metadata: { stepCount: run.progress.length },
    });

    return { runId: run.id, status: run.status };
  }

  // Called by the WorkflowScheduler — creates a run attributed to the schedule, not a user.
  async startScheduledRun(workspaceId: string, workflowId: string, scheduledForAt: Date) {
    const workspaceSnap = await this.db.collection("workspaces").doc(workspaceId).get();
    if (!workspaceSnap.exists) return;

    const workspace = workspaceSnap.data() as Workspace & { id: string };
    workspace.id = workspaceId;

    const workflowSnapshot = await collection(this.db, workspaceId).doc(workflowId).get();
    if (!workflowSnapshot.exists) return;

    const workflow = workflowSchema.parse({ id: workflowSnapshot.id, ...workflowSnapshot.data() });
    if (workflow.status !== "active") return; // double-check; scheduler should only send active

    await this.usageService.chargeOperation({
      workspace,
      userId: workflow.createdBy,
      operationType: "workflow_run",
      metadata: { workflowId, triggeredBy: "schedule" },
    });

    const runRef = runCollection(this.db, workspaceId).doc();
    const now = Timestamp.now();
    const scheduledForAtTs = Timestamp.fromDate(scheduledForAt);
    const scheduledInitialStatus = "queued";
    const run = workflowRunSchema.parse({
      id: runRef.id,
      workspaceId,
      workflowId,
      status: scheduledInitialStatus,
      currentStepId: workflow.steps[0]?.id,
      progress: sortSteps(workflow.steps).map((step) => ({
        stepId: step.id,
        name: step.name,
        status: "pending",
      })),
      inputSnapshot: {},
      artifactIds: [],
      approvalIds: [],
      dedupeKey: `scheduled:${workspaceId}:${workflowId}:${scheduledForAt.getTime()}`,
      startedAt: now,
      triggeredBy: "schedule",
      scheduledForAt: scheduledForAtTs,
    });

    await runRef.set(run);
    invalidateCachedDashboardSummary(workspaceId);

    await this.jobLockService.enqueueJob({
      workspaceId,
      jobType: "run_workflow",
      workflowId,
      runId: run.id,
      userId: workflow.createdBy,
      input: {},
      dedupeKey: run.dedupeKey,
    });

    await this.activityService.createEvent({
      workspaceId,
      type: "workflow.run_queued",
      title: `Workflow scheduled run queued: ${workflow.name}`,
      actorType: "system",
      related: { workflowId, workflowRunId: run.id },
      metadata: { stepCount: run.progress.length, scheduledForAt: scheduledForAt.toISOString() },
    });

    return { runId: run.id, workflowId, workspaceId };
  }

  async deleteWorkflow(workspace: Workspace, workflowId: string, userId: string) {
    const workflowRef = collection(this.db, workspace.id).doc(workflowId);
    const snapshot = await workflowRef.get();

    if (!snapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Workflow not found.",
        status: 404,
      });
    }

    const workflow = workflowSchema.parse({ id: snapshot.id, ...snapshot.data() });

    const activeRunsSnapshot = await runCollection(this.db, workspace.id)
      .where("workflowId", "==", workflowId)
      .where("status", "in", ["queued", "running"])
      .limit(1)
      .get();

    if (!activeRunsSnapshot.empty) {
      throw new ApiError({
        code: "WORKFLOW_HAS_ACTIVE_RUNS",
        message: "Cannot delete a workflow with active runs in progress.",
        status: 409,
      });
    }

    await workflowRef.delete();
    invalidateCachedWorkflows(workspace.id);
    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "workflow.deleted",
      title: `Workflow deleted: ${workflow.name}`,
      actorType: "user",
      actorId: userId,
      related: { workflowId },
      metadata: {},
    });
  }

  async getRun(workspace: Workspace, workflowId: string, runId: string) {
    const snapshot = await runCollection(this.db, workspace.id).doc(runId).get();

    if (!snapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Workflow run not found.",
        status: 404,
      });
    }

    const run = workflowRunSchema.parse({ id: snapshot.id, ...snapshot.data() });

    if (run.workflowId !== workflowId) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Workflow run not found for this workflow.",
        status: 404,
      });
    }

    return serializeRun(run);
  }

  async listRuns(workspace: Workspace, workflowId: string, limit = 20) {
    const snapshot = await runCollection(this.db, workspace.id)
      .where("workflowId", "==", workflowId)
      .orderBy("startedAt", "desc")
      .limit(Math.min(limit, 50))
      .get();

    return snapshot.docs.map((doc) =>
      serializeRunListItem(workflowRunSchema.parse({ id: doc.id, ...doc.data() })),
    );
  }

  async cancelRun(workspace: Workspace, workflowId: string, runId: string, userId: string) {
    const runRef = runCollection(this.db, workspace.id).doc(runId);
    const snapshot = await runRef.get();

    if (!snapshot.exists) {
      throw new ApiError({ code: "NOT_FOUND", message: "Workflow run not found.", status: 404 });
    }

    const run = workflowRunSchema.parse({ id: snapshot.id, ...snapshot.data() });

    if (run.workflowId !== workflowId) {
      throw new ApiError({ code: "NOT_FOUND", message: "Workflow run not found.", status: 404 });
    }

    if (["completed", "failed", "cancelled"].includes(run.status)) {
      throw new ApiError({
        code: "RUN_ALREADY_TERMINAL",
        message: "This run has already finished and cannot be cancelled.",
        status: 409,
      });
    }

    const now = Timestamp.now();
    const updatedProgress = run.progress.map((step) => {
      if (step.status === "pending" || step.status === "running") {
        return {
          ...step,
          status: "skipped" as const,
          startedAt: step.startedAt ?? now,
          completedAt: now,
          outputSummary: "Cancelled by user.",
        };
      }
      return step;
    });

    await runRef.update({
      status: "cancelled",
      error: "Cancelled by user.",
      progress: updatedProgress,
      completedAt: now,
    });
    invalidateCachedDashboardSummary(workspace.id);

    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "workflow.run_cancelled",
      title: "Workflow run cancelled by user",
      actorType: "user",
      actorId: userId,
      related: { workflowId, workflowRunId: runId },
      metadata: {},
    });
  }

  async resumeAfterApproval(workspace: Workspace, runId: string, approvalId: string, userId: string) {
    const runRef = runCollection(this.db, workspace.id).doc(runId);
    const snapshot = await runRef.get();

    if (!snapshot.exists) {
      throw new ApiError({ code: "NOT_FOUND", message: "Workflow run not found.", status: 404 });
    }

    const run = workflowRunSchema.parse({ id: snapshot.id, ...snapshot.data() });

    if (run.status !== "waiting_approval") {
      return; // already resumed or in a terminal state — no-op
    }

    // Mark the waiting step as completed so the processor skips it on resume
    const updatedProgress = run.progress.map((step) =>
      step.approvalId === approvalId
        ? { ...step, status: "completed" as const, completedAt: Timestamp.now(), outputSummary: "Approved by user." }
        : step,
    );

    // Resume: status becomes "running" so processWorkflowRun's idempotency guard allows execution
    await runRef.update({ status: "running", progress: updatedProgress });
    invalidateCachedDashboardSummary(workspace.id);

    await new JobLockService(this.db).enqueueJob({
      workspaceId: workspace.id,
      jobType: "run_workflow",
      workflowId: run.workflowId,
      runId: run.id,
      userId,
      dedupeKey: `run_workflow:${workspace.id}:${run.workflowId}:${runId}:resume:${approvalId}`,
    });

    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "workflow.run_resumed",
      title: "Workflow run resumed after approval",
      actorType: "user",
      actorId: userId,
      related: { workflowId: run.workflowId, workflowRunId: runId, approvalId },
      metadata: {},
    });
  }

  async cancelAfterRejection(workspace: Workspace, runId: string, approvalId: string, userId: string) {
    const runRef = runCollection(this.db, workspace.id).doc(runId);
    const snapshot = await runRef.get();

    if (!snapshot.exists || !(workflowRunSchema.safeParse({ id: snapshot.id, ...snapshot.data() }).success)) {
      return;
    }

    const run = workflowRunSchema.parse({ id: snapshot.id, ...snapshot.data() });

    if (run.status !== "waiting_approval") {
      return;
    }

    const now = Timestamp.now();
    const updatedProgress = run.progress.map((step) => {
      if (step.approvalId === approvalId) {
        return { ...step, status: "failed" as const, completedAt: now, outputSummary: "Rejected by user.", error: "Rejected by user." };
      }
      if (step.status === "pending") {
        return { ...step, status: "skipped" as const, startedAt: now, completedAt: now, outputSummary: "Skipped: approval was rejected." };
      }
      return step;
    });

    await runRef.update({
      status: "cancelled",
      error: "Workflow cancelled: approval was rejected.",
      progress: updatedProgress,
      completedAt: now,
    });
    invalidateCachedDashboardSummary(workspace.id);

    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "workflow.run_cancelled",
      title: "Workflow run cancelled after rejection",
      actorType: "user",
      actorId: userId,
      related: { workflowId: run.workflowId, workflowRunId: runId, approvalId },
      metadata: {},
    });
  }

  async failAfterApprovalExecutionError(
    workspace: Workspace,
    runId: string,
    approvalId: string,
    userId: string,
    error: string,
  ) {
    const runRef = runCollection(this.db, workspace.id).doc(runId);
    const snapshot = await runRef.get();

    if (!snapshot.exists || !(workflowRunSchema.safeParse({ id: snapshot.id, ...snapshot.data() }).success)) {
      return;
    }

    const run = workflowRunSchema.parse({ id: snapshot.id, ...snapshot.data() });

    if (run.status !== "waiting_approval") {
      return;
    }

    const now = Timestamp.now();
    const updatedProgress = run.progress.map((step) => {
      if (step.approvalId === approvalId) {
        return {
          ...step,
          status: "failed" as const,
          completedAt: now,
          outputSummary: "Approved action failed during execution.",
          error,
        };
      }
      if (step.status === "pending") {
        return {
          ...step,
          status: "skipped" as const,
          startedAt: now,
          completedAt: now,
          outputSummary: "Skipped: a prior approved action failed.",
        };
      }
      return step;
    });

    await runRef.update({
      status: "failed",
      error,
      progress: updatedProgress,
      completedAt: now,
    });
    invalidateCachedDashboardSummary(workspace.id);

    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "workflow.run_failed",
      title: "Workflow run failed after approval execution error",
      actorType: "user",
      actorId: userId,
      related: { workflowId: run.workflowId, workflowRunId: runId, approvalId },
      metadata: { error },
    });
  }
}
