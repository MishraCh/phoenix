import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import { createArtifact, deleteArtifact, getArtifact, listArtifacts } from "../controllers/artifactController.js";
import { validateRequest } from "../utils/validateRequest.js";

const artifactParamsSchema = z.object({
  id: z.string().min(1),
});

const sourceRefInputSchema = z.object({
  sourceType: z.enum(["integration", "artifact", "web", "file", "memory"]),
  sourceId: z.string().min(1),
  title: z.string().optional(),
  url: z.string().url().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const listArtifactsQuerySchema = z.object({
  artifactType: z.string().optional(),
  agentId: z.string().optional(),
  workflowId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  startAfter: z.string().optional(),
});

const createArtifactBodySchema = z.object({
  title: z.string().trim().min(1).max(180),
  artifactType: z.enum(["report", "draft", "summary", "data", "document"]),
  content: z.string().trim().min(1).max(50000),
  sourceRefs: z.array(sourceRefInputSchema).default([]),
  inputHash: z.string().optional(),
});

export const artifactsRouter = Router();

artifactsRouter.use(authMiddleware);
artifactsRouter.get("/artifacts", validateRequest({ query: listArtifactsQuerySchema }), listArtifacts);
artifactsRouter.get("/artifacts/:id", validateRequest({ params: artifactParamsSchema }), getArtifact);
artifactsRouter.post("/artifacts", validateRequest({ body: createArtifactBodySchema }), createArtifact);
artifactsRouter.delete("/artifacts/:id", validateRequest({ params: artifactParamsSchema }), deleteArtifact);
