import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { NotificationService } from "../notifications/notificationService.js";
import { timeRequestPhase } from "../observability/requestTiming.js";
import { resolveCurrentWorkspace } from "../services/currentWorkspaceService.js";
import { ApiError } from "../utils/apiError.js";

export async function listNotifications(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new NotificationService(getFirebaseDb());
  const notifications = await service.listNotifications(currentWorkspace.workspace, user.id, {
    limit: typeof request.query.limit === "number" ? request.query.limit : undefined,
    read: typeof request.query.read === "boolean" ? request.query.read : undefined,
  }, request);

  await timeRequestPhase(request, "notifications.serialize", async () => {
    response.json({ notifications });
  });
}

export async function markNotificationRead(request: Request, response: Response) {
  const user = requireUser(request);
  const notificationId = request.params.id;

  if (!notificationId || Array.isArray(notificationId)) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "Notification ID is required.",
      status: 400,
    });
  }

  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new NotificationService(getFirebaseDb());
  const result = await service.markRead(currentWorkspace.workspace, notificationId, user.id);

  response.json(result);
}

export async function markAllNotificationsRead(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new NotificationService(getFirebaseDb());
  const result = await service.markAllRead(currentWorkspace.workspace, user.id);
  response.json(result);
}

export async function deleteNotification(request: Request, response: Response) {
  const user = requireUser(request);
  const notificationId = request.params.id;

  if (!notificationId || Array.isArray(notificationId)) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "Notification ID is required.",
      status: 400,
    });
  }

  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new NotificationService(getFirebaseDb());
  const result = await service.deleteNotification(currentWorkspace.workspace, notificationId, user.id);
  response.json(result);
}

export async function deleteAllNotifications(request: Request, response: Response) {
  const user = requireUser(request);
  const currentWorkspace = await resolveCurrentWorkspace(user, request);
  const service = new NotificationService(getFirebaseDb());
  const result = await service.deleteAllNotifications(currentWorkspace.workspace, user.id);
  response.json(result);
}
