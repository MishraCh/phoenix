import { Router } from "express";

import { authMiddleware } from "../auth/authMiddleware.js";
import { getDashboardSummary } from "../controllers/dashboardController.js";

export const dashboardRouter = Router();

dashboardRouter.get("/dashboard/summary", authMiddleware, getDashboardSummary);
