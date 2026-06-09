import { apiFetch } from "./apiClient";

export type AuthMe = {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    photoURL: string | null;
    defaultWorkspaceId: string | null;
  };
};

export function fetchAuthMe(firebaseIdToken: string) {
  return apiFetch<AuthMe>("/auth/me", {
    firebaseIdToken,
    method: "GET",
  });
}
