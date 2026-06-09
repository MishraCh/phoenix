import { apiFetch } from "./apiClient";

export type GideonNotification = {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
  actionUrl: string | null;
};

export function fetchNotifications(firebaseIdToken: string) {
  return apiFetch<{ notifications: GideonNotification[] }>("/notifications?limit=20", {
    firebaseIdToken,
    method: "GET",
  });
}

export function markNotificationRead(firebaseIdToken: string, notificationId: string) {
  return apiFetch<{ notificationId: string; read: true }>(`/notifications/${notificationId}/read`, {
    firebaseIdToken,
    method: "POST",
  });
}

export function markAllNotificationsRead(firebaseIdToken: string) {
  return apiFetch<{ count: number }>("/notifications/read-all", {
    firebaseIdToken,
    method: "POST",
  });
}

export function clearNotification(firebaseIdToken: string, notificationId: string) {
  return apiFetch<{ notificationId: string; deleted: true }>(`/notifications/${notificationId}`, {
    firebaseIdToken,
    method: "DELETE",
  });
}

export function clearAllNotifications(firebaseIdToken: string) {
  return apiFetch<{ count: number }>("/notifications", {
    firebaseIdToken,
    method: "DELETE",
  });
}
