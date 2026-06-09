import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import {
  deleteAllNotifications,
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/notificationController.js";
import { validateRequest } from "../utils/validateRequest.js";

const notificationsQuerySchema = z.object({
  read: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const notificationParamsSchema = z.object({
  id: z.string().min(1),
});

export const notificationsRouter = Router();

notificationsRouter.get(
  "/notifications",
  authMiddleware,
  validateRequest({ query: notificationsQuerySchema }),
  listNotifications,
);
notificationsRouter.post(
  "/notifications/read-all",
  authMiddleware,
  markAllNotificationsRead,
);
notificationsRouter.post(
  "/notifications/:id/read",
  authMiddleware,
  validateRequest({ params: notificationParamsSchema }),
  markNotificationRead,
);
notificationsRouter.delete(
  "/notifications",
  authMiddleware,
  deleteAllNotifications,
);
notificationsRouter.delete(
  "/notifications/:id",
  authMiddleware,
  validateRequest({ params: notificationParamsSchema }),
  deleteNotification,
);
