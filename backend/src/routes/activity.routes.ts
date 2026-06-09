import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import { listActivity } from "../controllers/activityController.js";
import { validateRequest } from "../utils/validateRequest.js";

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  startAfter: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
});

export const activityRouter = Router();

activityRouter.get(
  "/activity",
  authMiddleware,
  validateRequest({ query: activityQuerySchema }),
  listActivity,
);
