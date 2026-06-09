import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import {
  createInviteCode,
  createWorkspace,
  getWorkspace,
  joinWorkspaceWithInviteCode,
  listWorkspaceMembers,
  listWorkspaces,
  selectWorkspace,
  updateWorkspace,
} from "../controllers/workspaceController.js";
import { workspaceContextMiddleware } from "../middleware/workspaceContextMiddleware.js";
import { validateRequest } from "../utils/validateRequest.js";

const workspaceParamsSchema = z.object({
  id: z.string().min(1),
});

const createWorkspaceBodySchema = z.object({
  name: z.string().trim().min(2).max(80),
});

const createInviteCodeBodySchema = z.object({
  roleGranted: z.enum(["admin", "operator", "member", "viewer"]),
  maxUses: z.number().int().min(1).max(100),
  emailRestriction: z.string().email().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const joinWorkspaceBodySchema = z.object({
  inviteCode: z.string().trim().min(1).max(80),
});

export const workspacesRouter = Router();

workspacesRouter.use(authMiddleware);
workspacesRouter.get("/workspaces", listWorkspaces);
workspacesRouter.post(
  "/workspaces",
  validateRequest({ body: createWorkspaceBodySchema }),
  createWorkspace,
);
workspacesRouter.post(
  "/workspaces/:id/invite-codes",
  validateRequest({ params: workspaceParamsSchema, body: createInviteCodeBodySchema }),
  workspaceContextMiddleware,
  createInviteCode,
);
workspacesRouter.post(
  "/workspaces/:id/join",
  validateRequest({ params: workspaceParamsSchema, body: joinWorkspaceBodySchema }),
  joinWorkspaceWithInviteCode,
);
workspacesRouter.post(
  "/workspaces/:id/select",
  validateRequest({ params: workspaceParamsSchema }),
  selectWorkspace,
);
workspacesRouter.get(
  "/workspaces/:id",
  validateRequest({ params: workspaceParamsSchema }),
  workspaceContextMiddleware,
  getWorkspace,
);

const updateWorkspaceBodySchema = z.object({
  defaultContextBundleId: z.string().nullable().optional(),
  profile: z.any().optional(),
  channelsConfig: z.object({
    emailEnabled: z.boolean(),
    whatsappEnabled: z.boolean(),
  }).optional(),
});

workspacesRouter.patch(
  "/workspaces/:id",
  validateRequest({ params: workspaceParamsSchema, body: updateWorkspaceBodySchema }),
  updateWorkspace,
);
workspacesRouter.get(
  "/workspaces/:id/members",
  validateRequest({ params: workspaceParamsSchema }),
  workspaceContextMiddleware,
  listWorkspaceMembers,
);
