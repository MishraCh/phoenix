import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { DashboardService } from "../dashboard/dashboardService.js";
import { timeRequestPhase } from "../observability/requestTiming.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";

export async function getDashboardSummary(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new DashboardService(getFirebaseDb());
  const summary = await service.getSummary(currentWorkspace.workspace, user.id, request);

  await timeRequestPhase(request, "dashboard.serialize", async () => {
    response.json(summary);
  });
}
