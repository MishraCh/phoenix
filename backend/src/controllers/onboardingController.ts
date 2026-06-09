import type { Request, Response } from "express";

import { requireUser } from "../auth/authMiddleware.js";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { requireWorkspace } from "../middleware/workspaceContextMiddleware.js";
import { OnboardingRepository } from "../repositories/onboardingRepository.js";

function serializeState(state: Awaited<ReturnType<OnboardingRepository["saveState"]>>) {
  return {
    workspaceId: state.workspaceId,
    userId: state.userId,
    currentStep: state.currentStep,
    completed: state.completed,
    sampleWorkspaceEnabled: state.sampleWorkspaceEnabled,
    responses: state.responses,
    updatedAt: state.updatedAt.toDate().toISOString(),
    completedAt: state.completedAt?.toDate().toISOString() ?? null,
  };
}

export async function getOnboardingState(request: Request, response: Response) {
  const user = requireUser(request);
  const { workspace } = requireWorkspace(request);
  const repository = new OnboardingRepository(getFirebaseDb());
  const state = await repository.getState(workspace.id, user.id);

  response.json({
    onboarding: state ? serializeState(state) : null,
  });
}

export async function saveOnboardingState(request: Request, response: Response) {
  const user = requireUser(request);
  const { workspace } = requireWorkspace(request);
  const repository = new OnboardingRepository(getFirebaseDb());
  const state = await repository.saveState({
    workspaceId: workspace.id,
    userId: user.id,
    currentStep: request.body.currentStep,
    completed: request.body.completed,
    sampleWorkspaceEnabled: request.body.sampleWorkspaceEnabled,
    responses: request.body.responses,
  });

  response.json({
    onboarding: serializeState(state),
  });
}
