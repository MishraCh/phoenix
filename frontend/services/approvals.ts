import { apiFetch } from "./apiClient";

export type ApprovalListItem = {
  id: string;
  title: string;
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  status: string;
  executionStatus?: "not_started" | "executing" | "executed" | "failed";
  proposedAction: Record<string, unknown>;
  workflowId: string | null;
  workflowRunId: string | null;
  createdAt: string;
};

export const fallbackApprovals: ApprovalListItem[] = [
  {
    id: "sample-approval",
    title: "Send follow-up email to Acme Corp",
    description: "Email draft ready for review before sending to the client.",
    riskLevel: "medium",
    status: "pending",
    proposedAction: { toolName: "email.send", actionType: "send_after_approval" },
    workflowId: null,
    workflowRunId: null,
    createdAt: new Date().toISOString(),
  },
];

export function fetchApprovals(firebaseIdToken: string) {
  return apiFetch<{ approvals: ApprovalListItem[] }>("/approvals", {
    firebaseIdToken,
    method: "GET",
  });
}

export function fetchApproval(firebaseIdToken: string, approvalId: string) {
  return apiFetch<
    ApprovalListItem & {
      type: string;
      reason: string;
      preview: Record<string, unknown>;
      sourceRefs: Array<Record<string, unknown>>;
      idempotencyKey: string;
      approvedBy: string | null;
      approvedAt: string | null;
      executedAt: string | null;
      executionLockId: string | null;
      executionStartedAt: string | null;
      executionCompletedAt: string | null;
      executionAttempts: number;
      executionResult: Record<string, unknown> | null;
      externalActionId: string | null;
      error: string | null;
    }
  >(`/approvals/${approvalId}`, {
    firebaseIdToken,
    method: "GET",
  });
}

export function approveApproval(firebaseIdToken: string, approvalId: string) {
  return apiFetch<{ approvalId: string; status: "approved" | "executed" | "executing" | "failed"; error?: string }>(`/approvals/${approvalId}/approve`, {
    firebaseIdToken,
    method: "POST",
  });
}

export function retryApproval(firebaseIdToken: string, approvalId: string) {
  return apiFetch<{ approvalId: string; status: "approved" | "executed" | "executing" | "failed"; error?: string }>(`/approvals/${approvalId}/retry`, {
    firebaseIdToken,
    method: "POST",
  });
}

export function rejectApproval(firebaseIdToken: string, approvalId: string, reason: string | null) {
  return apiFetch<{ approvalId: string; status: "rejected" }>(`/approvals/${approvalId}/reject`, {
    firebaseIdToken,
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function editApproval(
  firebaseIdToken: string,
  approvalId: string,
  patch: {
    proposedAction?: Partial<ApprovalListItem["proposedAction"]>;
    preview?: Record<string, unknown>;
  },
) {
  return apiFetch<{ approvalId: string }>(`/approvals/${approvalId}`, {
    firebaseIdToken,
    method: "PUT",
    body: JSON.stringify(patch),
  });
}
