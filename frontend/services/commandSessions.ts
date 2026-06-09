import type { CommandResponse, CommandSourceRef } from "./command";
import { apiFetch } from "./apiClient";
import type { SessionMessage } from "@/components/app-shell/command-center/types";
import type { SavedItem } from "./savedItems";

export type SessionListItem = {
  id: string;
  title: string;
  mode: string;
  source: string;
  status: "active" | "archived";
  pinned: boolean;
  bookmarked: boolean;
  firstQuery: string;
  lastMessagePreview: string;
  turnCount: number;
  artifactIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type SessionMessage_Backend = {
  id: string;
  role: "user" | "assistant";
  content: string;
  responseJson?: string;
  mode: string;
  agentId: string | null;
  agentName: string | null;
  sourceRefs: CommandSourceRef[];
  artifactIds: string[];
  starredByUserIds?: string[];
  savedItemId?: string | null;
  createdAt: string;
};

export type SessionDetail = SessionListItem & {
  messages: SessionMessage_Backend[];
};

export function fetchCommandSessions(
  firebaseIdToken: string,
  limit = 20,
  source = "web",
): Promise<{ sessions: SessionListItem[] }> {
  return apiFetch<{ sessions: SessionListItem[] }>(`/command-sessions?limit=${limit}&source=${source}`, {
    firebaseIdToken,
    method: "GET",
  });
}

export function fetchCommandSession(firebaseIdToken: string, sessionId: string): Promise<SessionDetail> {
  return apiFetch<SessionDetail>(`/command-sessions/${sessionId}`, {
    firebaseIdToken,
    method: "GET",
  });
}

export function updateCommandSession(
  firebaseIdToken: string,
  sessionId: string,
  updates: { title?: string; pinned?: boolean; bookmarked?: boolean; status?: "active" | "archived" },
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/command-sessions/${sessionId}`, {
    firebaseIdToken,
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function bookmarkCommandSession(firebaseIdToken: string, sessionId: string): Promise<{ bookmarked: boolean }> {
  return apiFetch<{ bookmarked: boolean }>(`/command-sessions/${sessionId}/bookmark`, {
    firebaseIdToken,
    method: "POST",
  });
}

export function pinCommandSession(firebaseIdToken: string, sessionId: string): Promise<{ pinned: boolean }> {
  return apiFetch<{ pinned: boolean }>(`/command-sessions/${sessionId}/pin`, {
    firebaseIdToken,
    method: "POST",
  });
}

export function starCommandSessionMessage(firebaseIdToken: string, sessionId: string, messageId: string) {
  return apiFetch<{ starred: boolean }>(`/command-sessions/${sessionId}/messages/${messageId}/star`, {
    firebaseIdToken,
    method: "POST",
  });
}

export function unstarCommandSessionMessage(firebaseIdToken: string, sessionId: string, messageId: string) {
  return apiFetch<{ starred: boolean }>(`/command-sessions/${sessionId}/messages/${messageId}/star`, {
    firebaseIdToken,
    method: "DELETE",
  });
}

export function saveCommandSessionMessage(firebaseIdToken: string, sessionId: string, messageId: string) {
  return apiFetch<{ savedItem: SavedItem }>(`/command-sessions/${sessionId}/messages/${messageId}/save`, {
    firebaseIdToken,
    method: "POST",
  });
}

export function createArtifactFromCommandSessionMessage(
  firebaseIdToken: string,
  sessionId: string,
  messageId: string,
  input: {
    title?: string;
    artifactType: "report" | "draft" | "summary" | "data" | "document";
  },
) {
  return apiFetch<{ artifactId: string }>(`/command-sessions/${sessionId}/messages/${messageId}/create-artifact`, {
    firebaseIdToken,
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function backendMessagesToSessionMessages(
  messages: SessionMessage_Backend[],
  currentUserId?: string | null,
): SessionMessage[] {
  const result: SessionMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "user") {
      const nextMsg = messages[i + 1]?.role === "assistant" ? messages[i + 1] : undefined;
      let response: CommandResponse | null = null;

      if (nextMsg?.responseJson) {
        try {
          response = JSON.parse(nextMsg.responseJson) as CommandResponse;
        } catch {
          response = null;
        }
      }

      const mode = (msg.mode ?? "auto") as SessionMessage["mode"];
      // Agent metadata comes from the assistant message (stored by commandService) or the user message as fallback
      const agentId = nextMsg?.agentId ?? msg.agentId ?? null;
      const agentName = nextMsg?.agentName ?? null;

      result.push({
        id: msg.id,
        assistantMessageId: nextMsg?.id ?? null,
        userQuery: msg.content,
        response,
        status: nextMsg ? "completed" : "error",
        mode,
        agentId,
        agentName,
        statusCopy: "",
        starred: Boolean(currentUserId && nextMsg?.starredByUserIds?.includes(currentUserId)),
        savedItemId: nextMsg?.savedItemId ?? null,
      });

      if (nextMsg) {
        i++;
      }
    }
  }

  return result;
}
