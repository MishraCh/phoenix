import { randomUUID } from "node:crypto";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import type { RouteDecision } from "../contracts/commandContracts.js";
import type { AiUsageObservation } from "../execution/aiExecutionBudget.js";
import { logger } from "../../observability/logger.js";

type TraceStep = {
  name: string;
  durationMs: number;
  status: "completed" | "failed" | "skipped";
  metadata?: Record<string, unknown>;
};

export class AiTraceService {
  readonly traceId = randomUUID();
  private readonly startedAt = Date.now();
  private readonly steps: TraceStep[] = [];
  private readonly usage: AiUsageObservation[] = [];
  private routeDecision?: RouteDecision;
  private routeComparison?: {
    liveIntent: string;
    v2Intent: string;
    v2ToolStrategy: string;
    agreement: boolean;
    providerFalseTrigger: boolean;
  };

  constructor(
    private readonly db: Firestore,
    private readonly identity: {
      workspaceId: string;
      userId: string;
      requestId: string;
      sessionId: string;
      originSurface: string;
    },
  ) {}

  setRouteDecision(routeDecision: RouteDecision) {
    this.routeDecision = routeDecision;
  }

  setRouteComparison(routeComparison: NonNullable<AiTraceService["routeComparison"]>) {
    this.routeComparison = routeComparison;
  }

  recordStep(step: TraceStep) {
    this.steps.push(step);
  }

  recordUsage(usage: AiUsageObservation) {
    this.usage.push(usage);
  }

  async finish(result: {
    status: "completed" | "failed" | "partial";
    resultKind?: string;
    errorCode?: string;
    contextTokens?: number;
  }) {
    const totalInputTokens = this.usage.reduce((sum, item) => sum + item.inputTokens, 0);
    const totalOutputTokens = this.usage.reduce((sum, item) => sum + item.outputTokens, 0);
    const document = {
      id: this.traceId,
      ...this.identity,
      routeDecision: this.routeDecision ?? null,
      routeComparison: this.routeComparison ?? null,
      status: result.status,
      resultKind: result.resultKind ?? null,
      errorCode: result.errorCode ?? null,
      contextTokens: result.contextTokens ?? null,
      steps: this.steps,
      usage: this.usage,
      totals: {
        durationMs: Date.now() - this.startedAt,
        llmCalls: this.usage.length,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
      createdAt: Timestamp.now(),
    };

    try {
      await this.db
        .collection("workspaces")
        .doc(this.identity.workspaceId)
        .collection("aiTraces")
        .doc(this.traceId)
        .set(document);
    } catch (error) {
      logger.warn("Failed to persist AI trace", {
        traceId: this.traceId,
        workspaceId: this.identity.workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
