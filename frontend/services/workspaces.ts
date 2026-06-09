import { apiFetch } from "./apiClient";

export type WorkspaceProfile = {
  companyName?: string;
  oneLiner?: string;
  icp?: string;
  differentiators?: string;
  primaryCompetitors?: string;
  industry?: string;
  stage?: "idea" | "pre-revenue" | "early" | "growth" | "scale";
  additionalContext?: string;
};

export type WorkspaceListItem = {
  id: string;
  name: string;
  plan: "free" | "plus" | "pro";
  role: "owner" | "admin" | "operator" | "member" | "viewer";
  createdAt: string;
};

export type WorkspaceDetail = {
  id: string;
  name: string;
  plan: "free" | "plus" | "pro";
  monthlyCreditsLimit: number;
  monthlyCreditsUsed: number;
  defaultContextBundleId: string | null;
  profile: WorkspaceProfile | null;
  channelsConfig: {
    emailEnabled: boolean;
    whatsappEnabled: boolean;
  };
  members: Array<{
    userId: string;
    role: string;
    status: string;
  }>;
};

export function fetchWorkspaces(firebaseIdToken: string) {
  return apiFetch<{ workspaces: WorkspaceListItem[] }>("/workspaces", {
    firebaseIdToken,
    method: "GET",
  });
}

export function fetchWorkspace(firebaseIdToken: string, workspaceId: string) {
  return apiFetch<WorkspaceDetail>(`/workspaces/${workspaceId}`, {
    firebaseIdToken,
    method: "GET",
  });
}

export function createWorkspace(firebaseIdToken: string, name: string) {
  return apiFetch<{ workspaceId: string }>("/workspaces", {
    firebaseIdToken,
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function selectWorkspace(firebaseIdToken: string, workspaceId: string) {
  return apiFetch<{ workspaceId: string; defaultWorkspaceId: string }>(
    `/workspaces/${workspaceId}/select`,
    {
      firebaseIdToken,
      method: "POST",
    },
  );
}

export function updateWorkspaceSettings(
  firebaseIdToken: string,
  workspaceId: string,
  settings: { 
    defaultContextBundleId?: string | null; 
    profile?: WorkspaceProfile | null;
    channelsConfig?: { emailEnabled: boolean; whatsappEnabled: boolean; };
  },
) {
  return apiFetch<{ ok: boolean }>(`/workspaces/${workspaceId}`, {
    firebaseIdToken,
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function joinWorkspace(
  firebaseIdToken: string,
  input: { workspaceId: string; inviteCode: string },
) {
  return apiFetch<{ workspaceId: string; role: string; defaultWorkspaceId: string }>(
    `/workspaces/${input.workspaceId}/join`,
    {
      firebaseIdToken,
      method: "POST",
      body: JSON.stringify({ inviteCode: input.inviteCode }),
    },
  );
}
