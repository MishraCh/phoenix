import { apiFetch } from "./apiClient";

export type MemoryNodeType = "fact" | "preference" | "pattern" | "contact" | "decision";
export type MemoryNodeStatus = "active" | "needs_review" | "archived";
export type MemoryNodeSource = "session" | "user" | "command" | "workflow";

export type MemoryNode = {
  id: string;
  type: MemoryNodeType;
  content: string;
  source: MemoryNodeSource;
  sourceId: string | null;
  confidence: number;
  status: MemoryNodeStatus;
  createdAt: string;
  updatedAt: string;
};

export type ListMemoryOptions = {
  status?: MemoryNodeStatus;
  type?: MemoryNodeType;
};

export async function fetchMemory(
  token: string,
  options: ListMemoryOptions = {},
): Promise<{ memory: MemoryNode[] }> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.type) params.set("type", options.type);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<{ memory: MemoryNode[] }>(`/memory${qs}`, {
    method: "GET",
    firebaseIdToken: token,
  });
}

export async function updateMemoryNode(
  token: string,
  id: string,
  updates: { status?: MemoryNodeStatus; content?: string; confidence?: number },
): Promise<MemoryNode> {
  return apiFetch<MemoryNode>(`/memory/${id}`, {
    method: "PATCH",
    firebaseIdToken: token,
    body: JSON.stringify(updates),
  });
}

export async function deleteMemoryNode(token: string, id: string): Promise<void> {
  await apiFetch<void>(`/memory/${id}`, {
    method: "DELETE",
    firebaseIdToken: token,
  });
}

export async function createMemoryNode(
  token: string,
  input: { type: MemoryNodeType; content: string },
): Promise<MemoryNode> {
  return apiFetch<MemoryNode>("/memory", {
    method: "POST",
    firebaseIdToken: token,
    body: JSON.stringify({ type: input.type, content: input.content, status: "active" }),
  });
}

export const memoryTypeLabels: Record<MemoryNodeType, string> = {
  fact: "Fact",
  preference: "Preference",
  pattern: "Pattern",
  contact: "Contact",
  decision: "Decision",
};

export const memorySourceLabels: Record<MemoryNodeSource, string> = {
  session: "Session",
  user: "User",
  command: "Command",
  workflow: "Workflow",
};
