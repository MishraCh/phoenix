import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import {
  deleteSavedItem,
  getSavedItem,
  listSavedItems,
  promoteSavedItem,
} from "../controllers/savedItemsController.js";
import { validateRequest } from "../utils/validateRequest.js";

const savedItemParamsSchema = z.object({
  id: z.string().min(1),
});

const promoteSavedItemBodySchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  artifactType: z.enum(["report", "draft", "summary", "data", "document"]),
});

export const savedItemsRouter = Router();

savedItemsRouter.use(authMiddleware);
savedItemsRouter.get("/saved-items", listSavedItems);
savedItemsRouter.get(
  "/saved-items/:id",
  validateRequest({ params: savedItemParamsSchema }),
  getSavedItem,
);
savedItemsRouter.delete(
  "/saved-items/:id",
  validateRequest({ params: savedItemParamsSchema }),
  deleteSavedItem,
);
savedItemsRouter.post(
  "/saved-items/:id/promote",
  validateRequest({ params: savedItemParamsSchema, body: promoteSavedItemBodySchema }),
  promoteSavedItem,
);
