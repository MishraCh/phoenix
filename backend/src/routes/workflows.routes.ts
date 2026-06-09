import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import {
  cancelWorkflowRun,
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  getWorkflowPlaceholders,
  getWorkflowRun,
  listWorkflowRuns,
  listWorkflows,
  runWorkflow,
  updateWorkflow,
} from "../controllers/workflowController.js";
import { validateRequest } from "../utils/validateRequest.js";

const workflowParamsSchema = z.object({
  id: z.string().min(1),
});

const workflowRunParamsSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
});

const apiTriggerSchema = z.object({
  type: z.enum(["manual", "scheduled", "schedule", "integration_event"]),
  config: z.record(z.string(), z.unknown()).default({}),
});

const workflowStepInputSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "context",
    "agent",
    "tool",
    "approval",
    "action",
    "notification",
    "artifact",
    "monitor",
    "conditional",
    "fetch_url",
    "integration.read",
    "integration.action",
  ]),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
  order: z.number().int().nonnegative(),
});

const createWorkflowBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  type: z.literal("custom"),
  trigger: apiTriggerSchema,
  steps: z.array(workflowStepInputSchema).max(20),
  approvalPolicy: z.record(z.string(), z.unknown()).optional(),
  notificationPolicy: z.record(z.string(), z.unknown()).optional(),
});

const updateWorkflowBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(1000).optional(),
    status: z.enum(["draft", "active", "paused", "archived"]).optional(),
    trigger: apiTriggerSchema.optional(),
    steps: z.array(workflowStepInputSchema).max(20).optional(),
    approvalPolicy: z.record(z.string(), z.unknown()).optional(),
    notificationPolicy: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "At least one workflow field is required.");

const runWorkflowBodySchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
});

export const workflowsRouter = Router();

workflowsRouter.use(authMiddleware);
workflowsRouter.get("/workflows", listWorkflows);
workflowsRouter.post("/workflows", validateRequest({ body: createWorkflowBodySchema }), createWorkflow);
workflowsRouter.get("/workflows/:id", validateRequest({ params: workflowParamsSchema }), getWorkflow);
workflowsRouter.put(
  "/workflows/:id",
  validateRequest({ params: workflowParamsSchema, body: updateWorkflowBodySchema }),
  updateWorkflow,
);
workflowsRouter.delete(
  "/workflows/:id",
  validateRequest({ params: workflowParamsSchema }),
  deleteWorkflow,
);
workflowsRouter.get(
  "/workflows/:id/placeholders",
  validateRequest({ params: workflowParamsSchema }),
  getWorkflowPlaceholders,
);
workflowsRouter.post(
  "/workflows/:id/run",
  validateRequest({ params: workflowParamsSchema, body: runWorkflowBodySchema }),
  runWorkflow,
);
workflowsRouter.get(
  "/workflows/:id/runs",
  authMiddleware,
  validateRequest({ params: workflowParamsSchema }),
  listWorkflowRuns,
);
workflowsRouter.get(
  "/workflows/:id/runs/:runId",
  validateRequest({ params: workflowRunParamsSchema }),
  getWorkflowRun,
);
workflowsRouter.post(
  "/workflows/:id/runs/:runId/cancel",
  authMiddleware,
  validateRequest({ params: workflowRunParamsSchema }),
  cancelWorkflowRun,
);
