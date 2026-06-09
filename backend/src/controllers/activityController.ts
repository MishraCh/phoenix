import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { ActivityService } from "../activity/activityService.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";

export async function listActivity(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user);
  const service = new ActivityService(getFirebaseDb());
  const events = await service.listEvents(currentWorkspace.workspace, {
    entityId: typeof request.query.entityId === "string" ? request.query.entityId : undefined,
    entityType: typeof request.query.entityType === "string" ? request.query.entityType : undefined,
    limit: typeof request.query.limit === "number" ? request.query.limit : undefined,
  });

  response.json({ events });
}
