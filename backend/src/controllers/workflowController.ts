import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { env } from "../config/env.js";
import { processWorkflowRun } from "../jobs/workflowRunProcessor.js";
import { logger } from "../observability/logger.js";
import { timeRequestPhase } from "../observability/requestTiming.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";
import { ApiError } from "../utils/apiError.js";
import { inferPlaceholders } from "../workflows/workflowUtils.js";
import { WorkflowService } from "../workflows/workflowService.js";

function requiredParam(request: Request, name: string) {
  const value = request.params[name];

  if (!value || Array.isArray(value)) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: `${name} is required.`,
      status: 400,
    });
  }

  return value;
}

export async function listWorkflows(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new WorkflowService(getFirebaseDb());
  const workflows = await service.listWorkflows(currentWorkspace.workspace, request);

  await timeRequestPhase(request, "workflows.serialize", async () => {
    response.json({ workflows });
  });
}

export async function createWorkflow(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new WorkflowService(getFirebaseDb());
  const workflow = await service.createWorkflow({
    workspace: currentWorkspace.workspace,
    userId: user.id,
    name: request.body.name,
    description: request.body.description,
    type: request.body.type,
    trigger: request.body.trigger,
    steps: request.body.steps,
    approvalPolicy: request.body.approvalPolicy,
    notificationPolicy: request.body.notificationPolicy,
  });

  response.status(201).json({ workflowId: workflow.id });
}

export async function getWorkflow(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new WorkflowService(getFirebaseDb());
  const workflow = await service.getWorkflow(currentWorkspace.workspace, requiredParam(request, "id"));

  response.json(workflow);
}

export async function updateWorkflow(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new WorkflowService(getFirebaseDb());
  const workflow = await service.updateWorkflow(
    currentWorkspace.workspace,
    requiredParam(request, "id"),
    user.id,
    request.body,
  );

  response.json({ workflowId: workflow.id });
}

export async function deleteWorkflow(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new WorkflowService(getFirebaseDb());
  await service.deleteWorkflow(
    currentWorkspace.workspace,
    requiredParam(request, "id"),
    user.id,
  );
  response.status(204).end();
}

export async function runWorkflow(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const workflowId = requiredParam(request, "id");
  const db = getFirebaseDb();
  const service = new WorkflowService(db);
  const run = await service.startRun(
    currentWorkspace.workspace,
    workflowId,
    user.id,
    request.body.input ?? {},
  );

  const cloudTasksEnabled = !!env.GOOGLE_CLOUD_TASKS_QUEUE_PATH;
  if (!env.WORKER_POLLING_ENABLED && !cloudTasksEnabled) {
    void processWorkflowRun(db, {
      workspaceId: currentWorkspace.workspace.id,
      workflowId,
      runId: run.runId,
    }).catch((err: Error) => {
      logger.error("runWorkflow: processWorkflowRun failed", { runId: run.runId, error: err.message });
    });
  }

  response.json(run);
}

export async function getWorkflowRun(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new WorkflowService(getFirebaseDb());
  const run = await service.getRun(
    currentWorkspace.workspace,
    requiredParam(request, "id"),
    requiredParam(request, "runId"),
  );

  response.json(run);
}

export async function listWorkflowRuns(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new WorkflowService(getFirebaseDb());
  const limitParam = Number(request.query["limit"]) || 20;
  const runs = await service.listRuns(
    currentWorkspace.workspace,
    requiredParam(request, "id"),
    limitParam,
  );

  response.json({ runs });
}

export async function getWorkflowPlaceholders(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new WorkflowService(getFirebaseDb());
  const workflow = await service.getWorkflow(currentWorkspace.workspace, requiredParam(request, "id"));
  const placeholders = inferPlaceholders(workflow.steps);
  response.json({ placeholders });
}

export async function cancelWorkflowRun(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new WorkflowService(getFirebaseDb());
  await service.cancelRun(
    currentWorkspace.workspace,
    requiredParam(request, "id"),
    requiredParam(request, "runId"),
    user.id,
  );

  response.status(204).end();
}
