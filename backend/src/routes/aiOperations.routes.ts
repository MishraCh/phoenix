import { Router } from "express";

import { authMiddleware } from "../auth/authMiddleware.js";
import {
  getAiOperationsOverview,
  getAiTrace,
} from "../controllers/aiOperationsController.js";

export const aiOperationsRouter = Router();

aiOperationsRouter.get("/internal/ai-operations", authMiddleware, getAiOperationsOverview);
aiOperationsRouter.get("/internal/ai-operations/traces/:traceId", authMiddleware, getAiTrace);
