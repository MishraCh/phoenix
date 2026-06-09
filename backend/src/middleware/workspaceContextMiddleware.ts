import type { NextFunction, Request, Response } from "express";

import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { ApiError } from "../utils/apiError.js";
import { requireUser } from "../auth/authMiddleware.js";

export async function workspaceContextMiddleware(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  try {
    const user = requireUser(request);
    const rawWorkspaceId = request.params.id ?? request.params.workspaceId;

    if (!rawWorkspaceId || Array.isArray(rawWorkspaceId)) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "Workspace ID is required.",
        status: 400,
      });
    }

    const workspaceId = rawWorkspaceId;
    const repository = new WorkspaceRepository(getFirebaseDb());
    const [workspace, member] = await Promise.all([
      repository.getWorkspace(workspaceId),
      repository.getMember(workspaceId, user.id),
    ]);

    if (!workspace) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Workspace not found.",
        status: 404,
      });
    }

    if (!member || member.status !== "active") {
      throw new ApiError({
        code: "FORBIDDEN",
        message: "You are not an active member of this workspace.",
        status: 403,
      });
    }

    request.workspace = {
      id: workspace.id,
      workspace,
      member,
      role: member.role,
    };

    next();
  } catch (error) {
    next(error);
  }
}

export function requireWorkspace(request: Request) {
  if (!request.workspace) {
    throw new ApiError({
      code: "FORBIDDEN",
      message: "Workspace context is required.",
      status: 403,
    });
  }

  return request.workspace;
}
