import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import { getOnboardingState, saveOnboardingState } from "../controllers/onboardingController.js";
import { workspaceContextMiddleware } from "../middleware/workspaceContextMiddleware.js";
import { validateRequest } from "../utils/validateRequest.js";

const workspaceParamsSchema = z.object({
  id: z.string().min(1),
});

const saveOnboardingBodySchema = z.object({
  currentStep: z.number().int().min(0).max(8),
  completed: z.boolean(),
  sampleWorkspaceEnabled: z.boolean(),
  responses: z.record(z.string(), z.unknown()),
});

export const onboardingRouter = Router();

onboardingRouter.use(authMiddleware);
onboardingRouter.get(
  "/workspaces/:id/onboarding",
  validateRequest({ params: workspaceParamsSchema }),
  workspaceContextMiddleware,
  getOnboardingState,
);
onboardingRouter.put(
  "/workspaces/:id/onboarding",
  validateRequest({ params: workspaceParamsSchema, body: saveOnboardingBodySchema }),
  workspaceContextMiddleware,
  saveOnboardingState,
);
