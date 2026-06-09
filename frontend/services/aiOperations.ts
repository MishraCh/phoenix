import { apiFetch } from "./apiClient";

export type AiOperationsTrace = {
  id: string;
  requestId?: string;
  sessionId?: string;
  status?: "completed" | "failed" | "partial";
  resultKind?: string | null;
  routeDecision?: {
    intent?: string;
    provider?: string;
    confidence?: number;
    reason?: string;
  } | null;
  totals?: {
    durationMs?: number;
    llmCalls?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  createdAt?: { _seconds?: number; seconds?: number } | string;
};

export type AiOperationsOverview = {
  requestVolume: number;
  latencyMs: { p50: number; p95: number };
  errorRate: number;
  partialResultRate: number;
  routingEvaluation: {
    comparisons: number;
    agreementRate: number;
    providerFalseTriggerRate: number;
  };
  routeDistribution: Record<string, number>;
  usage: {
    llmCalls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
  recentTraces: AiOperationsTrace[];
};

export function getAiOperationsOverview(firebaseIdToken: string) {
  return apiFetch<AiOperationsOverview>("/internal/ai-operations", {
    method: "GET",
    firebaseIdToken,
  });
}

export function getAiOperationTrace(firebaseIdToken: string, traceId: string) {
  return apiFetch<AiOperationsTrace>(`/internal/ai-operations/traces/${traceId}`, {
    method: "GET",
    firebaseIdToken,
  });
}
