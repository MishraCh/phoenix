import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import { createMemory, deleteMemory, listMemory, updateMemory } from "../controllers/memoryController.js";
import { validateRequest } from "../utils/validateRequest.js";

const memoryParamsSchema = z.object({ id: z.string().min(1) });

const createMemoryBodySchema = z.object({
  type: z.enum(["fact", "preference", "pattern", "contact", "decision"]),
  content: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(["active", "needs_review"]).optional(),
});

const updateMemoryBodySchema = z.object({
  status: z.enum(["active", "needs_review", "archived"]).optional(),
  content: z.string().min(1).max(2000).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const memoryRouter = Router();

memoryRouter.use(authMiddleware);

memoryRouter.get("/memory", listMemory);

memoryRouter.post(
  "/memory",
  validateRequest({ body: createMemoryBodySchema }),
  createMemory,
);

memoryRouter.patch(
  "/memory/:id",
  validateRequest({ params: memoryParamsSchema, body: updateMemoryBodySchema }),
  updateMemory,
);

memoryRouter.delete(
  "/memory/:id",
  validateRequest({ params: memoryParamsSchema }),
  deleteMemory,
);
