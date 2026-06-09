import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { handleWorkerExecute, handleWorkerSchedulerTick } from "../controllers/workerController.js";
import { logger } from "../observability/logger.js";

export const workerRouter = Router();

// Middleware to verify Cloud Tasks/Scheduler webhooks using a shared secret
function verifyWorkerTriggerSecret(req: Request, res: Response, next: NextFunction) {
  if (!env.WORKER_TRIGGER_SECRET) {
    logger.error("Webhook verification failed: WORKER_TRIGGER_SECRET is not configured.");
    res.status(401).json({ error: "Missing worker trigger secret configuration" });
    return;
  }

  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn("Webhook signature missing or malformed in headers.");
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const token = authHeader.substring(7); // Remove "Bearer "
  
  if (token !== env.WORKER_TRIGGER_SECRET) {
    logger.warn("Webhook signature invalid.");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }
  
  next();
}

// Secure webhook endpoints for Google Cloud Tasks / Cloud Scheduler
workerRouter.post("/execute", verifyWorkerTriggerSecret, handleWorkerExecute);
workerRouter.post("/scheduler-tick", verifyWorkerTriggerSecret, handleWorkerSchedulerTick);
