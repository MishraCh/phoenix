import { apiFetch } from "./apiClient";

export type OnboardingStateResponse = {
  workspaceId: string;
  userId: string;
  currentStep: number;
  completed: boolean;
  sampleWorkspaceEnabled: boolean;
  responses: Record<string, unknown>;
  updatedAt: string | null;
  completedAt: string | null;
};

export function isOnboardingDeferred(onboarding: Pick<OnboardingStateResponse, "responses"> | null | undefined) {
  return onboarding?.responses?.onboardingDeferred === true;
}

export function canEnterAppFromOnboarding(
  onboarding: Pick<OnboardingStateResponse, "completed" | "responses"> | null | undefined,
) {
  return Boolean(onboarding?.completed || isOnboardingDeferred(onboarding));
}

export type OnboardingProgressInput = {
  workspaceId: string;
  firebaseIdToken: string;
  currentStep: number;
  completed: boolean;
  sampleWorkspaceEnabled: boolean;
  responses: Record<string, unknown>;
};

export function fetchOnboardingProgress(firebaseIdToken: string, workspaceId: string) {
  return apiFetch<{ onboarding: OnboardingStateResponse | null }>(`/workspaces/${workspaceId}/onboarding`, {
    firebaseIdToken,
    method: "GET",
  });
}

export function saveOnboardingProgress(input: OnboardingProgressInput) {
  return apiFetch<{ onboarding: OnboardingStateResponse }>(`/workspaces/${input.workspaceId}/onboarding`, {
    firebaseIdToken: input.firebaseIdToken,
    method: "PUT",
    body: JSON.stringify({
      currentStep: input.currentStep,
      completed: input.completed,
      sampleWorkspaceEnabled: input.sampleWorkspaceEnabled,
      responses: input.responses,
    }),
  });
}
