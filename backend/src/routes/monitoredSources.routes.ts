import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import {
  createMonitoredSource,
  getMonitoredSource,
  listMonitoredSources,
  runMonitorCheck,
  updateMonitoredSource,
} from "../controllers/monitoredSourceController.js";
import { validateRequest } from "../utils/validateRequest.js";

const idParamsSchema = z.object({ id: z.string().min(1) });

const createBodySchema = z.object({
  type: z.enum(["url", "keyword", "company", "person"]),
  value: z.string().trim().min(1).max(500),
  frequency: z.enum(["daily", "weekly", "manual"]).default("manual"),
  workflowId: z.string().trim().optional(),
});

const updateBodySchema = z.object({
  status: z.enum(["active", "paused"]).optional(),
  frequency: z.enum(["daily", "weekly", "manual"]).optional(),
});

const checkBodySchema = z.object({
  objective: z.string().trim().min(1).max(400).optional(),
  processor: z.enum(["base", "core", "pro", "ultra"]).default("core"),
});

export const monitoredSourcesRouter = Router();

monitoredSourcesRouter.use(authMiddleware);

monitoredSourcesRouter.get("/monitored-sources", listMonitoredSources);

monitoredSourcesRouter.post(
  "/monitored-sources",
  validateRequest({ body: createBodySchema }),
  createMonitoredSource,
);

monitoredSourcesRouter.get(
  "/monitored-sources/:id",
  validateRequest({ params: idParamsSchema }),
  getMonitoredSource,
);

monitoredSourcesRouter.patch(
  "/monitored-sources/:id",
  validateRequest({ params: idParamsSchema, body: updateBodySchema }),
  updateMonitoredSource,
);

monitoredSourcesRouter.post(
  "/monitored-sources/:id/check",
  validateRequest({ params: idParamsSchema, body: checkBodySchema }),
  runMonitorCheck,
);
