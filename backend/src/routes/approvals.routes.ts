import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import {
  approveApproval,
  createApproval,
  editApproval,
  getApproval,
  listApprovals,
  rejectApproval,
  retryApproval,
} from "../controllers/approvalController.js";
import { validateRequest } from "../utils/validateRequest.js";

const approvalParamsSchema = z.object({
  id: z.string().min(1),
});

const sourceRefInputSchema = z.object({
  sourceType: z.enum(["integration", "artifact", "web", "file", "memory"]),
  sourceId: z.string().min(1),
  title: z.string().optional(),
  url: z.string().url().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const proposedActionInputSchema = z.object({
  toolName: z.string().min(1),
  actionType: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  requiresApproval: z.boolean(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
});

const createApprovalBodySchema = z.object({
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(2000),
  type: z.enum(["email_send", "crm_update", "crm_create", "slack_message", "task_create", "other"]).default("other"),
  preview: z.record(z.string(), z.unknown()).default({}),
  proposedAction: proposedActionInputSchema,
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  sourceRefs: z.array(sourceRefInputSchema).default([]),
  idempotencyKey: z.string().trim().min(1).max(160),
});

const listApprovalsQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "edited", "executed", "failed", "cancelled"]).optional(),
  agentId: z.string().optional(),
  workflowId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const rejectApprovalBodySchema = z.object({
  reason: z.string().nullable().optional(),
});

const editApprovalBodySchema = z.object({
  proposedAction: proposedActionInputSchema.partial().optional(),
  preview: z.record(z.string(), z.unknown()).optional(),
}).refine(
  (value) => value.proposedAction !== undefined || value.preview !== undefined,
  "At least one field to update is required.",
);

export const approvalsRouter = Router();

approvalsRouter.use(authMiddleware);
approvalsRouter.get("/approvals", validateRequest({ query: listApprovalsQuerySchema }), listApprovals);
approvalsRouter.post("/approvals", validateRequest({ body: createApprovalBodySchema }), createApproval);
approvalsRouter.get("/approvals/:id", validateRequest({ params: approvalParamsSchema }), getApproval);
approvalsRouter.post(
  "/approvals/:id/approve",
  validateRequest({ params: approvalParamsSchema }),
  approveApproval,
);
approvalsRouter.post(
  "/approvals/:id/retry",
  validateRequest({ params: approvalParamsSchema }),
  retryApproval,
);
approvalsRouter.post(
  "/approvals/:id/reject",
  validateRequest({ params: approvalParamsSchema, body: rejectApprovalBodySchema }),
  rejectApproval,
);
approvalsRouter.put(
  "/approvals/:id",
  validateRequest({ params: approvalParamsSchema, body: editApprovalBodySchema }),
  editApproval,
);
