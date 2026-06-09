import { apiFetch } from "./apiClient";
import type { CommandMode, CommandSourceRef } from "./command";

export type SavedItem = {
  id: string;
  sourceType: "command_response" | "workflow_run";
  sourceSessionId: string | null;
  sourceAssistantMessageId: string | null;
  sourceWorkflowRunId: string | null;
  itemType: "saved_response";
  title: string;
  previewText: string;
  contentText: string;
  responseJson: string | null;
  mode: Exclude<CommandMode, "auto" | "extract_url"> | "default" | "extract" | null;
  sourceRefs: CommandSourceRef[];
  createdByUserId: string;
  promotedArtifactId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function fetchSavedItems(firebaseIdToken: string) {
  return apiFetch<{ savedItems: SavedItem[] }>("/saved-items", {
    firebaseIdToken,
    method: "GET",
  });
}

export function fetchSavedItem(firebaseIdToken: string, savedItemId: string) {
  return apiFetch<{ savedItem: SavedItem }>(`/saved-items/${savedItemId}`, {
    firebaseIdToken,
    method: "GET",
  });
}

export function deleteSavedItem(firebaseIdToken: string, savedItemId: string) {
  return apiFetch<void>(`/saved-items/${savedItemId}`, {
    firebaseIdToken,
    method: "DELETE",
  });
}

export function promoteSavedItem(
  firebaseIdToken: string,
  savedItemId: string,
  input: {
    title?: string;
    artifactType: "report" | "draft" | "summary" | "data" | "document";
  },
) {
  return apiFetch<{ artifactId: string }>(`/saved-items/${savedItemId}/promote`, {
    firebaseIdToken,
    method: "POST",
    body: JSON.stringify(input),
  });
}
