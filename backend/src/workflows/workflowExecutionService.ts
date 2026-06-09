import { randomUUID } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";

import { getVisibleAgent, resolveAgent } from "../agents/agentRegistry.js";
import { routeDecisionSchema } from "../ai/contracts/commandContracts.js";
import {
  AiExecutionRuntime,
  getAiExecutionContext,
  runWithAiExecutionContext,
} from "../ai/execution/aiExecutionBudget.js";
import { CommandGraphService } from "../ai/graphs/commandGraph.js";
import { AiTraceService } from "../ai/observability/aiTraceService.js";
import { AiUsageEventService } from "../ai/observability/aiUsageEventService.js";
import { AiRolloutService } from "../ai/rollout/aiRolloutService.js";
import { logger } from "../observability/logger.js";
import { AgentConfigRepository } from "../repositories/agentConfigRepository.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { UsageService } from "../usage/usageService.js";
import {
  formatWorkflowStepContext,
  type WorkflowStepOutput,
} from "./workflowStepOutput.js";

export type AgentStepResult = {
  answer: string;
  creditsCharged: number;
  createdArtifactId: string | null;
  sourceRefs: unknown[];
  resultKind: string;
  structuredPayload: Record<string, unknown>;
  compactSummary: string;
};

/**
 * The single execution path for workflow agent steps.
 *
 * Agent work remains inside CommandGraphService, while workflow continuity is
 * passed as typed step output rather than clipped transcript text.
 */
export class WorkflowExecutionService {
  constructor(private readonly db: Firestore) {}

  async runAgentStep(input: {
    currentWorkspace: CurrentWorkspace;
    userId: string;
    agentId: string | null;
    stepInput: string;
    workflowId: string;
    workflowRunId: string;
    stepId: string;
    contextBundleId?: string | null;
    extraContext?: string | WorkflowStepOutput | null;
  }): Promise<AgentStepResult> {
    let agentSystemPromptAddition: string | null = null;
    let agentAllowedTools: string[] | null = null;
    const effectiveAgentId = input.agentId && input.agentId !== "auto" ? input.agentId : null;

    if (effectiveAgentId) {
      const registryAgent = getVisibleAgent(effectiveAgentId);
      if (registryAgent) {
        const workspaceConfig = await new AgentConfigRepository(this.db).get(
          input.currentWorkspace.id,
          effectiveAgentId,
        );
        const resolved = resolveAgent(registryAgent, workspaceConfig);
        agentSystemPromptAddition = [
          registryAgent.instructions,
          resolved.systemPromptAddition,
        ]
          .filter(Boolean)
          .join("\n\n");
        agentAllowedTools = resolved.toolsAllowed ?? null;
      }
    }

    const usage = await new UsageService(this.db).chargeOperation({
      workspace: input.currentWorkspace.workspace,
      userId: input.userId,
      operationType: "workflow_agent_step",
      metadata: {
        workflowId: input.workflowId,
        workflowRunId: input.workflowRunId,
        stepId: input.stepId,
        agentId: effectiveAgentId,
      },
    });

    const sessionContext = input.extraContext
      ? `[Background execution context - previous step output]\n\n${
          typeof input.extraContext === "string"
            ? input.extraContext
            : formatWorkflowStepContext(input.extraContext)
        }`
      : "[Background execution context - no prior step output]";
    const workflowWrappedInput =
      `TASK INSTRUCTION:\n${input.stepInput}\n\n` +
      "(SYSTEM RULE: This is an automated background execution step. Complete the assigned task fully. " +
      "Do not ask follow-up questions. Do not generate conversational pleasantries. Output only the requested research or data.)";

    logger.info("Workflow agent step routed through CommandGraphService", {
      workflowId: input.workflowId,
      workflowRunId: input.workflowRunId,
      stepId: input.stepId,
      agentId: effectiveAgentId,
    });

    const requestId = randomUUID();
    const routeDecision = routeDecisionSchema.parse({
      routeId: randomUUID(),
      intent: "workflow_run",
      toolStrategy: "none",
      action: "agent_step",
      actionInput: {
        workflowId: input.workflowId,
        workflowRunId: input.workflowRunId,
        stepId: input.stepId,
      },
      resolvedEntities: [],
      confidence: 1,
      missingRequirements: [],
      expectedResultKind: "answer",
      routeSource: "hard_rule",
      reason: "workflow_agent_step",
    });
    const executionRuntime = new AiExecutionRuntime();
    executionRuntime.applyRoute(routeDecision, true);
    const budget = executionRuntime.budget;
    const traceEnabled = await new AiRolloutService(this.db).isEnabled(
      "AI_TRACE_V2",
      input.currentWorkspace.id,
    );
    const trace = traceEnabled
      ? new AiTraceService(this.db, {
          workspaceId: input.currentWorkspace.id,
          userId: input.userId,
          requestId,
          sessionId: `workflow:${input.workflowId}:${input.workflowRunId}`,
          originSurface: "workflow",
        })
      : null;
    trace?.setRouteDecision(routeDecision);
    const usageEvents = new AiUsageEventService(this.db);

    let graphResult;
    try {
      graphResult = await runWithAiExecutionContext(
        {
          requestId,
          workspaceId: input.currentWorkspace.id,
          userId: input.userId,
          workflowStep: true,
              routeDecision,
              budget,
              signal: executionRuntime.signal,
              applyBudgetProfile: (intent) => executionRuntime.applyIntent(intent),
          recordUsage: (observation) => {
            trace?.recordUsage(observation);
            const execution = getAiExecutionContext();
            void usageEvents.record({
              workspaceId: input.currentWorkspace.id,
              userId: input.userId,
              requestId,
              runId: input.workflowRunId,
              routeDecision: execution?.routeDecision ?? routeDecision,
              observation,
              budget,
            });
          },
        },
        () =>
          new CommandGraphService(this.db).run({
            input: workflowWrappedInput,
            mode: "auto",
            userId: input.userId,
            currentWorkspace: input.currentWorkspace,
            agentId: effectiveAgentId,
            contextBundleId: input.contextBundleId ?? null,
            sessionId: `workflow:${input.workflowId}:${input.workflowRunId}`,
            sessionContext,
            agentSystemPromptAddition,
            agentAllowedTools,
            requestEnvelope: {
              originSurface: "workflow_run",
              routeDecision,
              timezone: "UTC",
            } as any,
            request: undefined,
            progressEmit: undefined,
            artifactWritePolicy: "disabled",
          }),
      );
      await trace?.finish({
        status: "completed",
        resultKind: graphResult.resultType,
      });
    } catch (error) {
      await trace?.finish({
        status: "failed",
        errorCode: error instanceof Error ? error.name : "WORKFLOW_AGENT_STEP_FAILED",
      });
      throw error;
    } finally {
      executionRuntime.dispose();
    }

    const resultPayload = graphResult.result as {
      sections?: Array<{ title: string; body: string }>;
    } | null;
    const fullAnswer = [
      graphResult.answer,
      ...(resultPayload?.sections ?? []).map((section) =>
        [section.title ? `### ${section.title}` : "", section.body]
          .filter(Boolean)
          .join("\n\n"),
      ),
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      answer: fullAnswer,
      creditsCharged: usage.creditsCharged,
      createdArtifactId: graphResult.createdArtifact?.artifactId ?? null,
      sourceRefs: graphResult.sourceRefs ?? [],
      resultKind: graphResult.resultType,
      structuredPayload:
        graphResult.result && typeof graphResult.result === "object"
          ? graphResult.result
          : { answer: fullAnswer },
      compactSummary: graphResult.answer.slice(0, 800),
    };
  }
}
