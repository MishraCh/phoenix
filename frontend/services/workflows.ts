import { apiFetch } from "./apiClient";

export type WorkflowListItem = {
  id: string;
  name: string;
  type: "template" | "custom";
  status: "draft" | "active" | "paused" | "archived";
  triggerType: string;
  nextRunAt: string | null;
};

export type WorkflowStep = {
  id: string;
  type: "context" | "agent" | "tool" | "approval" | "action" | "notification" | "artifact" | "monitor" | "conditional" | "fetch_url" | "integration.read" | "integration.action";
  name: string;
  config: Record<string, unknown>;
  order: number;
};

export type WorkflowDetail = WorkflowListItem & {
  description: string | null;
  trigger: Record<string, unknown>;
  steps: WorkflowStep[];
  approvalPolicy: Record<string, unknown>;
  notificationPolicy: Record<string, unknown>;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  lastRunAt: string | null;
};

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowRunStepResult = {
  stepId: string;
  name: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  outputSummary: string | null;
  error: string | null;
  approvalId: string | null;
};

export type WorkflowRunDetail = {
  runId: string;
  status: WorkflowRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  stepResults: WorkflowRunStepResult[];
  error: string | null;
  outputSummary: string | null;
  artifactIds: string[];
};

export type WorkflowRunListItem = {
  runId: string;
  status: WorkflowRunStatus;
  triggeredBy: string;
  scheduledForAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  stepCount: number;
  outputSummary: string | null;
  error: string | null;
};


export function fetchWorkflows(firebaseIdToken: string) {
  return apiFetch<{ workflows: WorkflowListItem[] }>("/workflows", {
    firebaseIdToken,
    method: "GET",
  });
}

export function fetchWorkflow(firebaseIdToken: string, workflowId: string) {
  return apiFetch<WorkflowDetail>(`/workflows/${workflowId}`, {
    firebaseIdToken,
    method: "GET",
  });
}

export function createWorkflow(input: {
  firebaseIdToken: string;
  name: string;
  description?: string;
  steps?: WorkflowStep[];
  trigger?: Record<string, unknown>;
}) {
  return apiFetch<{ workflowId: string }>("/workflows", {
    firebaseIdToken: input.firebaseIdToken,
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      type: "custom",
      trigger: input.trigger ?? { type: "manual", config: {} },
      steps: input.steps ?? [],
      approvalPolicy: { default: "external_only" },
      notificationPolicy: { channel: "in_app" },
    }),
  });
}

export function updateWorkflowStatus(input: {
  firebaseIdToken: string;
  workflowId: string;
  status: "draft" | "active" | "paused";
}) {
  return apiFetch<{ workflowId: string }>(`/workflows/${input.workflowId}`, {
    firebaseIdToken: input.firebaseIdToken,
    method: "PUT",
    body: JSON.stringify({ status: input.status }),
  });
}

export function runWorkflow(input: {
  firebaseIdToken: string;
  workflowId: string;
  input?: Record<string, string>;
}) {
  return apiFetch<{ runId: string; status: "queued" | "running" }>(`/workflows/${input.workflowId}/run`, {
    firebaseIdToken: input.firebaseIdToken,
    method: "POST",
    body: JSON.stringify({ input: input.input ?? { source: "workflow_page" } }),
  });
}

export function saveWorkflow(input: {
  firebaseIdToken: string;
  workflowId: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  trigger?: Record<string, unknown>;
}) {
  return apiFetch<{ workflowId: string }>(`/workflows/${input.workflowId}`, {
    firebaseIdToken: input.firebaseIdToken,
    method: "PUT",
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      steps: input.steps,
      ...(input.trigger ? { trigger: input.trigger } : {}),
    }),
  });
}

export function deleteWorkflow(input: { firebaseIdToken: string; workflowId: string }) {
  return apiFetch<void>(`/workflows/${input.workflowId}`, {
    firebaseIdToken: input.firebaseIdToken,
    method: "DELETE",
  });
}

export function fetchWorkflowRun(firebaseIdToken: string, workflowId: string, runId: string) {
  return apiFetch<WorkflowRunDetail>(`/workflows/${workflowId}/runs/${runId}`, {
    firebaseIdToken,
    method: "GET",
  });
}

export function fetchWorkflowRuns(firebaseIdToken: string, workflowId: string, limit = 20) {
  return apiFetch<{ runs: WorkflowRunListItem[] }>(
    `/workflows/${workflowId}/runs?limit=${limit}`,
    { firebaseIdToken, method: "GET" },
  );
}

export function cancelWorkflowRun(input: {
  firebaseIdToken: string;
  workflowId: string;
  runId: string;
}) {
  return apiFetch<void>(`/workflows/${input.workflowId}/runs/${input.runId}/cancel`, {
    firebaseIdToken: input.firebaseIdToken,
    method: "POST",
  });
}

export function fetchWorkflowPlaceholders(firebaseIdToken: string, workflowId: string) {
  return apiFetch<{ placeholders: string[] }>(`/workflows/${workflowId}/placeholders`, {
    firebaseIdToken,
    method: "GET",
  });
}
