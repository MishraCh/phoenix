import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import {
  bookmarkCommandSession,
  createArtifactFromCommandSessionMessage,
  getCommandSession,
  listCommandSessions,
  pinCommandSession,
  saveCommandSessionMessage,
  starCommandSessionMessage,
  unstarCommandSessionMessage,
  updateCommandSession,
} from "../controllers/commandSessionController.js";
import { validateRequest } from "../utils/validateRequest.js";

const sessionParamsSchema = z.object({
  id: z.string().min(1),
});

const messageParamsSchema = z.object({
  id: z.string().min(1),
  messageId: z.string().min(1),
});

const updateSessionBodySchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  pinned: z.boolean().optional(),
  bookmarked: z.boolean().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const createArtifactBodySchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  artifactType: z.enum(["report", "draft", "summary", "data", "document"]),
});

export const commandSessionsRouter = Router();

commandSessionsRouter.use(authMiddleware);
commandSessionsRouter.get("/command-sessions", listCommandSessions);
commandSessionsRouter.get(
  "/command-sessions/:id",
  validateRequest({ params: sessionParamsSchema }),
  getCommandSession,
);
commandSessionsRouter.patch(
  "/command-sessions/:id",
  validateRequest({ params: sessionParamsSchema, body: updateSessionBodySchema }),
  updateCommandSession,
);
commandSessionsRouter.post(
  "/command-sessions/:id/bookmark",
  validateRequest({ params: sessionParamsSchema }),
  bookmarkCommandSession,
);
commandSessionsRouter.post(
  "/command-sessions/:id/pin",
  validateRequest({ params: sessionParamsSchema }),
  pinCommandSession,
);
commandSessionsRouter.post(
  "/command-sessions/:id/messages/:messageId/star",
  validateRequest({ params: messageParamsSchema }),
  starCommandSessionMessage,
);
commandSessionsRouter.delete(
  "/command-sessions/:id/messages/:messageId/star",
  validateRequest({ params: messageParamsSchema }),
  unstarCommandSessionMessage,
);
commandSessionsRouter.post(
  "/command-sessions/:id/messages/:messageId/save",
  validateRequest({ params: messageParamsSchema }),
  saveCommandSessionMessage,
);
commandSessionsRouter.post(
  "/command-sessions/:id/messages/:messageId/create-artifact",
  validateRequest({ params: messageParamsSchema, body: createArtifactBodySchema }),
  createArtifactFromCommandSessionMessage,
);
