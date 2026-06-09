import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import { createContextBundle, listContextBundles } from "../controllers/contextController.js";
import { validateRequest } from "../utils/validateRequest.js";

const sourceRefInputSchema = z.object({
  sourceType: z.enum(["integration", "artifact", "web", "file", "memory"]),
  sourceId: z.string().min(1),
  title: z.string().optional(),
  url: z.string().url().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const createContextBundleBodySchema = z.object({
  key: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(500),
  sourceRefs: z.array(sourceRefInputSchema).default([]),
  payload: z.record(z.string(), z.unknown()).default({}),
  ttlMinutes: z.number().int().min(5).max(1440).optional(),
});

export const contextRouter = Router();

contextRouter.use(authMiddleware);
contextRouter.get("/context", listContextBundles);
contextRouter.post("/context/bundles", validateRequest({ body: createContextBundleBodySchema }), createContextBundle);
