import type { Request, Response } from "express";

import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { env } from "../config/env.js";
import { JobLockService, type JobType } from "../jobs/jobLockService.js";
import { processWorkflowRun } from "../jobs/workflowRunProcessor.js";
import { logger } from "../observability/logger.js";
import { ApiError } from "../utils/apiError.js";

export async function enqueueWorkerJob(request: Request, response: Response) {
  const providedSecret = request.header("x-worker-secret");

  if (!env.WORKER_TRIGGER_SECRET || providedSecret !== env.WORKER_TRIGGER_SECRET) {
    throw new ApiError({
      code: "UNAUTHORIZED",
      message: "Worker trigger secret is missing or invalid.",
      status: 401,
    });
  }

  const service = new JobLockService(getFirebaseDb());

  const job = await service.enqueueJob({
    workspaceId: request.body.workspaceId,
    jobType: request.body.jobType as JobType,
    workflowId: request.body.workflowId,
    agentId: request.body.agentId,
    input: request.body.input,
  });

  response.json({ jobId: job.id, status: job.status });
}

export async function processWorkflowRunDirect(request: Request, response: Response) {
  const providedKey = request.header("x-internal-key");

  if (!env.INTERNAL_API_KEY || providedKey !== env.INTERNAL_API_KEY) {
    throw new ApiError({
      code: "UNAUTHORIZED",
      message: "Internal API key is missing or invalid.",
      status: 401,
    });
  }

  const runIdParam = request.params["runId"];
  const runId = Array.isArray(runIdParam) ? runIdParam[0] : runIdParam;
  const { workspaceId, workflowId } = request.body as { workspaceId: string; workflowId: string };

  if (!runId) {
    throw new ApiError({ code: "VALIDATION_ERROR", message: "runId is required.", status: 400 });
  }

  // Validate the run exists and belongs to the stated workflow/workspace before executing
  const db = getFirebaseDb();
  const runSnap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("workflowRuns")
    .doc(runId)
    .get();

  if (!runSnap.exists) {
    throw new ApiError({ code: "NOT_FOUND", message: "Workflow run not found.", status: 404 });
  }

  const runData = runSnap.data() as { workflowId?: string; status?: string } | undefined;

  if (runData?.workflowId !== workflowId) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "Run workflowId does not match the provided workflowId.",
      status: 400,
    });
  }

  const terminalStates = new Set(["completed", "failed", "cancelled"]);
  if (runData?.status && terminalStates.has(runData.status)) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: `Run is already in terminal state: ${runData.status}`,
      status: 409,
    });
  }

  // Respond immediately — execution is detached
  response.status(202).json({ accepted: true, runId });

  void processWorkflowRun(db, { workspaceId, workflowId, runId }).catch((err: Error) => {
    logger.error("processWorkflowRunDirect: execution failed", { runId, error: err.message });
  });
}
