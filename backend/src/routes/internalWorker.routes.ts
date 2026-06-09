import { Router } from "express";
import { z } from "zod";

import { enqueueWorkerJob, processWorkflowRunDirect } from "../controllers/internalWorkerController.js";
import { validateRequest } from "../utils/validateRequest.js";

const triggerBodySchema = z.object({
  jobType: z.enum(["run_workflow", "send_notification", "sync_integration", "gmail_delta_sync"]),
  workspaceId: z.string().min(1),
  workflowId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  input: z.record(z.string(), z.unknown()).default({}),
});

const processRunBodySchema = z.object({
  workspaceId: z.string().min(1),
  workflowId: z.string().min(1),
});

export const internalWorkerRouter = Router();

internalWorkerRouter.post(
  "/internal/worker/trigger",
  validateRequest({ body: triggerBodySchema }),
  enqueueWorkerJob,
);

internalWorkerRouter.post(
  "/internal/workflow-runs/:runId/process",
  validateRequest({ body: processRunBodySchema }),
  processWorkflowRunDirect,
);
