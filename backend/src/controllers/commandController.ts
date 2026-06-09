import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { CommandService } from "../command/commandService.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";

export async function runCommand(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new CommandService(getFirebaseDb());
  const result = await service.runCommand({
    input: request.body.input,
    mode: request.body.mode,
    agentId: request.body.agentId,
    contextBundleId: request.body.contextBundleId,
    attachments: Array.isArray(request.body.attachments) ? request.body.attachments : [],
    sessionId: request.body.sessionId,
    timezone: request.body.timezone,
    clientCommandId: request.body.clientCommandId,
    originSurface: request.body.originSurface,
    currentWorkspace,
    userId: user.id,
    request,
  });

  response.json(result);
}
