import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { ActivityService } from "../activity/activityService.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { requireWorkspace } from "../middleware/workspaceContextMiddleware.js";
import { timeRequestPhase } from "../observability/requestTiming.js";
import { InviteCodeRepository } from "../repositories/inviteCodeRepository.js";
import { serializeWorkspaceListItem, WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { workspaceProfileSchema } from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";

function toIso(value: { toDate: () => Date } | undefined) {
  return value ? value.toDate().toISOString() : null;
}

export async function listWorkspaces(request: Request, response: Response) {
  const user = requireUser(request);
  const repository = new WorkspaceRepository(getFirebaseDb());
  const workspaces = await repository.listWorkspacesForUser(user.id, request);

  await timeRequestPhase(request, "workspaces.serialize", async () => {
    response.json({
      workspaces: workspaces.map(serializeWorkspaceListItem),
    });
  });
}

export async function createWorkspace(request: Request, response: Response) {
  const user = requireUser(request);
  const repository = new WorkspaceRepository(getFirebaseDb());
  const workspaceId = await repository.createWorkspace(request.body.name, user.id);
  const activityService = new ActivityService(getFirebaseDb());

  await activityService.createEvent({
    workspaceId,
    type: "workspace.created",
    title: `Workspace created: ${request.body.name}`,
    actorType: "user",
    actorId: user.id,
  });

  response.status(201).json({ workspaceId });
}

export async function getWorkspace(request: Request, response: Response) {
  const { workspace } = requireWorkspace(request);
  const repository = new WorkspaceRepository(getFirebaseDb());
  const members = await repository.listMembers(workspace.id);

  response.json({
    id: workspace.id,
    name: workspace.name,
    plan: workspace.plan,
    monthlyCreditsLimit: workspace.monthlyCreditsLimit,
    monthlyCreditsUsed: workspace.monthlyCreditsUsed,
    defaultContextBundleId: workspace.defaultContextBundleId ?? null,
    profile: workspace.profile ?? null,
    channelsConfig: workspace.channelsConfig,
    members: members.map((member) => ({
      userId: member.userId,
      role: member.role,
      status: member.status,
    })),
  });
}

export async function listWorkspaceMembers(request: Request, response: Response) {
  const { workspace } = requireWorkspace(request);
  const repository = new WorkspaceRepository(getFirebaseDb());
  const members = await repository.listMembers(workspace.id);

  response.json({
    members: members.map((member) => ({
      userId: member.userId,
      role: member.role,
      status: member.status,
      joinedAt: toIso(member.joinedAt),
    })),
  });
}

export async function createInviteCode(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = requireWorkspace(request);

  if (!["owner", "admin"].includes(currentWorkspace.role)) {
    throw new ApiError({
      code: "FORBIDDEN",
      message: "Only workspace owners and admins can create invite codes.",
      status: 403,
    });
  }

  const repository = new InviteCodeRepository(getFirebaseDb());
  const invite = await repository.createInviteCode({
    workspaceId: currentWorkspace.workspace.id,
    roleGranted: request.body.roleGranted,
    maxUses: request.body.maxUses,
    emailRestriction: request.body.emailRestriction,
    expiresAt: request.body.expiresAt ? new Date(request.body.expiresAt) : null,
    createdBy: user.id,
  });
  const activityService = new ActivityService(getFirebaseDb());

  await activityService.createEvent({
    workspaceId: currentWorkspace.workspace.id,
    type: "workspace.invite_code_created",
    title: `Invite code created for ${invite.roleGranted}`,
    actorType: "user",
    actorId: user.id,
    metadata: {
      inviteCodeId: invite.id,
      maxUses: invite.maxUses,
      emailRestricted: Boolean(invite.emailRestriction),
    },
  });

  response.status(201).json({ code: invite.code, inviteCodeId: invite.id });
}

export async function joinWorkspaceWithInviteCode(request: Request, response: Response) {
  const user = requireUser(request);
  const workspaceId = request.params.id;

  if (!workspaceId || Array.isArray(workspaceId)) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "Workspace ID is required.",
      status: 400,
    });
  }

  const repository = new InviteCodeRepository(getFirebaseDb());
  const result = await repository.redeemInviteCode({
    workspaceId,
    inviteCode: request.body.inviteCode,
    user,
  });
  const activityService = new ActivityService(getFirebaseDb());

  await activityService.createEvent({
    workspaceId,
    type: "workspace.member_joined",
    title: `${user.email} joined workspace`,
    actorType: "user",
    actorId: user.id,
    metadata: { role: result.role },
  });

  response.json(result);
}

export async function updateWorkspace(request: Request, response: Response) {
  const user = requireUser(request);
  const workspaceId = request.params.id;

  if (!workspaceId || Array.isArray(workspaceId)) {
    throw new ApiError({ code: "VALIDATION_ERROR", message: "Workspace ID is required.", status: 400 });
  }

  const repository = new WorkspaceRepository(getFirebaseDb());
  const workspace = await repository.getWorkspace(workspaceId);

  if (!workspace) {
    throw new ApiError({ code: "NOT_FOUND", message: "Workspace not found.", status: 404 });
  }

  const member = await repository.getMember(workspaceId, user.id);
  if (!member || !["owner", "admin"].includes(member.role)) {
    throw new ApiError({ code: "FORBIDDEN", message: "Only workspace owners and admins can update settings.", status: 403 });
  }

  const profileInput = request.body.profile !== undefined ? request.body.profile : undefined;
  let parsedProfile = undefined;
  if (profileInput !== undefined) {
    if (profileInput === null) {
      parsedProfile = null;
    } else {
      const profileResult = workspaceProfileSchema.safeParse(profileInput);
      if (!profileResult.success) {
        throw new ApiError({ code: "VALIDATION_ERROR", message: "Invalid workspace profile data.", status: 400 });
      }
      parsedProfile = profileResult.data;
    }
  }

  await repository.updateSettings(workspaceId, {
    defaultContextBundleId: request.body.defaultContextBundleId,
    profile: parsedProfile,
    channelsConfig: request.body.channelsConfig,
  });

  response.json({ ok: true });
}

export async function selectWorkspace(request: Request, response: Response) {
  const user = requireUser(request);
  const workspaceId = request.params.id;

  if (!workspaceId || Array.isArray(workspaceId)) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "Workspace ID is required.",
      status: 400,
    });
  }

  const repository = new WorkspaceRepository(getFirebaseDb());
  const result = await repository.setDefaultWorkspaceForActiveMember(user.id, workspaceId);

  response.json(result);
}
