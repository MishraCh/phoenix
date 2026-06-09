import { apiFetch } from "./apiClient";
import type { AuthMe } from "./auth";
import type { OnboardingStateResponse } from "./onboarding";
import type { WorkspaceListItem } from "./workspaces";
import type { QueryClient } from "@tanstack/react-query";

import { gideonQueryKeys } from "@/hooks/useGideonQueries";

export type AuthBootstrapResponse = {
  user: AuthMe["user"];
  defaultWorkspace: WorkspaceListItem;
  workspaces: WorkspaceListItem[];
  onboarding: OnboardingStateResponse;
};

export function bootstrapSession(firebaseIdToken: string) {
  return apiFetch<AuthBootstrapResponse>("/auth/bootstrap", {
    firebaseIdToken,
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function seedBootstrapCaches(
  queryClient: QueryClient,
  firebaseIdToken: string,
  payload: AuthBootstrapResponse,
) {
  queryClient.setQueryData(gideonQueryKeys.authMe(firebaseIdToken), {
    user: payload.user,
  });
  queryClient.setQueryData(gideonQueryKeys.workspaces(firebaseIdToken), {
    workspaces: payload.workspaces,
  });
  queryClient.setQueryData(gideonQueryKeys.onboarding(firebaseIdToken, payload.defaultWorkspace.id), {
    onboarding: payload.onboarding,
  });
}
