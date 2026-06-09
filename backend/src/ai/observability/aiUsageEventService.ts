import { randomUUID } from "node:crypto";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import type { AiExecutionBudget, AiUsageObservation } from "../execution/aiExecutionBudget.js";
import type { RouteDecision } from "../contracts/commandContracts.js";
import { logger } from "../../observability/logger.js";

function estimatedCost(observation: AiUsageObservation) {
  const inputRate = Number(process.env.OPENAI_INPUT_COST_PER_MILLION ?? "0");
  const outputRate = Number(process.env.OPENAI_OUTPUT_COST_PER_MILLION ?? "0");
  return (
    observation.inputTokens * inputRate / 1_000_000 +
    observation.outputTokens * outputRate / 1_000_000
  );
}

export class AiUsageEventService {
  constructor(private readonly db: Firestore) {}

  async record(input: {
    workspaceId: string;
    userId: string;
    requestId: string;
    runId?: string;
    routeDecision?: RouteDecision;
    observation: AiUsageObservation;
    budget: AiExecutionBudget;
  }) {
    const id = randomUUID();
    try {
      await this.db
        .collection("workspaces")
        .doc(input.workspaceId)
        .collection("aiUsageEvents")
        .doc(id)
        .set({
          id,
          workspaceId: input.workspaceId,
          userId: input.userId,
          requestId: input.requestId,
          runId: input.runId ?? null,
          routeId: input.routeDecision?.routeId ?? null,
          routeIntent: input.routeDecision?.intent ?? null,
          capability: input.routeDecision?.expertCapabilityId ?? null,
          modelRole: input.observation.role ?? "default",
          budgetScope: input.observation.scope ?? "execution",
          modelName: input.observation.model,
          provider: input.observation.provider,
          inputTokens: input.observation.inputTokens,
          cachedTokens: 0,
          reasoningTokens: 0,
          outputTokens: input.observation.outputTokens,
          estimatedProviderCost: estimatedCost(input.observation),
          estimatedTokens: input.observation.estimated,
          latencyMs: input.observation.latencyMs,
          retryCount: 0,
          providerRequestId: null,
          success: input.observation.success,
          errorCode: input.observation.errorCode ?? null,
          remainingBudget: input.budget.remaining(),
          createdAt: Timestamp.now(),
        });
    } catch (error) {
      logger.warn("Failed to persist AI usage event", {
        workspaceId: input.workspaceId,
        requestId: input.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
