import { apiFetch } from "./apiClient";

export type ActivityEvent = {
  id: string;
  eventType: string;
  summary: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
};

export function fetchActivity(firebaseIdToken: string) {
  return apiFetch<{ events: ActivityEvent[] }>("/activity?limit=20", {
    firebaseIdToken,
    method: "GET",
  });
}
