import type { Workspace, WorkspaceMember, WorkspaceRole } from "../schemas/coreSchemas.js";

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  defaultWorkspaceId?: string;
};

export type WorkspaceContext = {
  id: string;
  workspace: Workspace;
  member: WorkspaceMember;
  role: WorkspaceRole;
};
