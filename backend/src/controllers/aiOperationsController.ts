import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { AiOperationsService } from "../ai/observability/aiOperationsService.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";
import { ApiError } from "../utils/apiError.js";

async function requireAdmin(request: Request) {
  const user = requireUser(request);
  const workspace = await resolveCurrentWorkspace(user, request);
  if (workspace.role !== "owner" && workspace.role !== "admin") {
    throw new ApiError({
      code: "FORBIDDEN",
      message: "AI operations data is available to workspace owners and admins.",
      status: 403,
    });
  }
  return workspace;
}

export async function getAiOperationsOverview(request: Request, response: Response) {
  const workspace = await requireAdmin(request);
  const result = await new AiOperationsService(getFirebaseDb()).getOverview(workspace.id);
  response.json(result);
}

export async function getAiTrace(request: Request, response: Response) {
  const workspace = await requireAdmin(request);
  const trace = await new AiOperationsService(getFirebaseDb()).getTrace(
    workspace.id,
    String(request.params.traceId),
  );
  if (!trace) {
    throw new ApiError({ code: "NOT_FOUND", message: "AI trace not found.", status: 404 });
  }
  response.json(trace);
}
