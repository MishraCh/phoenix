import { apiFetch } from "./apiClient";

export type AgentStatus = "active" | "disabled" | "needs_setup";

export type VisibleAgent = {
  id: string;
  name: string;
  type: string;
  status: AgentStatus;
  description?: string;
  systemPromptAddition?: string | null;
  contextBundleId?: string | null;
};

export type UpdateAgentConfigInput = {
  status?: AgentStatus;
  systemPromptAddition?: string | null;
  allowedTools?: string[] | null;
  contextBundleId?: string | null;
};

export const fallbackAgents: VisibleAgent[] = [
  {
    id: "executive",
    name: "Executive Assistant",
    type: "executive",
    status: "needs_setup",
    description: "Priorities, briefings, meeting prep, and operating rhythm support.",
  },
  {
    id: "sales",
    name: "Sales Assistant",
    type: "sales",
    status: "needs_setup",
    description: "Lead follow-up, CRM context, drafts, and pipeline nudges.",
  },
  {
    id: "research",
    name: "Research Assistant",
    type: "research",
    status: "needs_setup",
    description: "Company, person, market, and public web research.",
  },
  {
    id: "operations",
    name: "Operations Assistant",
    type: "operations",
    status: "needs_setup",
    description: "Workflow hygiene, open loops, process checks, and internal reminders.",
  },
  {
    id: "customer",
    name: "Customer Assistant",
    type: "customer",
    status: "needs_setup",
    description: "Customer escalations, account context, open loops, and response drafts.",
  },
  {
    id: "recruiting",
    name: "Recruiting Assistant",
    type: "recruiting",
    status: "needs_setup",
    description: "Candidate context, interview prep, follow-ups, and recruiting open loops.",
  },
];

export function fetchAgents(firebaseIdToken: string) {
  return apiFetch<{ agents: VisibleAgent[] }>("/agents", {
    firebaseIdToken,
    method: "GET",
  });
}

export function updateAgentConfig(
  firebaseIdToken: string,
  agentId: string,
  updates: UpdateAgentConfigInput,
) {
  return apiFetch<VisibleAgent>(`/agents/${agentId}`, {
    firebaseIdToken,
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}
