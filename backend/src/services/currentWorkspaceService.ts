import type { Request } from "express";

import { getFirebaseDb } from "../config/firebaseAdmin.js";
import {
  coalesceWorkspaceResolve,
  getCachedCurrentWorkspace,
  setCachedCurrentWorkspace,
} from "../cache/requestStateCache.js";
import { timeRequestPhase } from "../observability/requestTiming.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import type { Workspace, WorkspaceMember, WorkspaceRole } from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";
import type { AuthenticatedUser } from "../auth/types.js";

export type CurrentWorkspace = {
  id: string;
  workspace: Workspace;
  member: WorkspaceMember;
  role: WorkspaceRole;
};

export async function resolveCurrentWorkspace(
  user: AuthenticatedUser,
  request?: Request,
): Promise<CurrentWorkspace> {
  if (request?.workspace && (!user.defaultWorkspaceId || request.workspace.id === user.defaultWorkspaceId)) {
    return request.workspace;
  }

  const cachedCurrentWorkspace = getCachedCurrentWorkspace(user.id, user.defaultWorkspaceId);

  if (cachedCurrentWorkspace) {
    if (request) {
      request.workspace = cachedCurrentWorkspace;
    }

    return cachedCurrentWorkspace;
  }

  const repository = new WorkspaceRepository(getFirebaseDb());
  let workspaceId = user.defaultWorkspaceId;

  if (!workspaceId) {
    const workspaces = await timeRequestPhase(request, "workspace.list_for_current_user", async () =>
      repository.listWorkspacesForUser(user.id, request),
    );
    workspaceId = workspaces[0]?.id;
  }

  if (!workspaceId) {
    throw new ApiError({
      code: "WORKSPACE_REQUIRED",
      message: "Create or select a workspace before using this endpoint.",
      status: 400,
    });
  }

  const currentWorkspace = await coalesceWorkspaceResolve(
    user.id,
    workspaceId!,
    () =>
      timeRequestPhase(request, "workspace.resolve_current", async () => {
        const [workspace, member] = await Promise.all([
          repository.getWorkspace(workspaceId!),
          repository.getMember(workspaceId!, user.id),
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

        const resolved: CurrentWorkspace = {
          id: workspace.id,
          workspace,
          member,
          role: member.role,
        };

        setCachedCurrentWorkspace(user.id, user.defaultWorkspaceId, resolved);
        return resolved;
      }),
  );

  if (request) {
    request.workspace = currentWorkspace;
  }

  return currentWorkspace;
}
