import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import { getAgent, listAgents, runAgent, updateAgentConfig } from "../controllers/agentController.js";
import { validateRequest } from "../utils/validateRequest.js";

const agentParamsSchema = z.object({
  id: z.string().min(1),
});

const runAgentBodySchema = z.object({
  input: z.string().trim().min(1).max(4000),
  mode: z.enum(["auto", "search", "research", "extract_url", "workflow"]).optional(),
  contextBundleId: z.string().nullable().optional(),
  attachments: z.array(z.unknown()).max(10).optional(),
});

const updateAgentConfigBodySchema = z
  .object({
    status: z.enum(["active", "disabled", "needs_setup"]).optional(),
    systemPromptAddition: z.string().max(2000).nullable().optional(),
    allowedTools: z.array(z.string()).nullable().optional(),
    contextBundleId: z.string().nullable().optional(),
  })
  .refine((body) => Object.keys(body).some((k) => body[k as keyof typeof body] !== undefined), {
    message: "At least one field is required.",
  });

export const agentsRouter = Router();

agentsRouter.use(authMiddleware);
agentsRouter.get("/agents", listAgents);
agentsRouter.get("/agents/:id", validateRequest({ params: agentParamsSchema }), getAgent);
agentsRouter.patch(
  "/agents/:id",
  validateRequest({ params: agentParamsSchema, body: updateAgentConfigBodySchema }),
  updateAgentConfig,
);
agentsRouter.post(
  "/agents/:id/run",
  validateRequest({ params: agentParamsSchema, body: runAgentBodySchema }),
  runAgent,
);
