import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { ToolLoopAgent, stepCountIs } from "ai";

import { env } from "../../config/env.js";
import { logger } from "../../observability/logger.js";
import { getAiExecutionContext } from "../execution/aiExecutionBudget.js";
import { ToolRegistryService } from "../../tools/toolRegistryService.js";
import type { CurrentWorkspace } from "../../services/currentWorkspaceService.js";
import type { SourceRef } from "../../schemas/coreSchemas.js";
import { adaptToolForAgent } from "./toolLoopToolAdapter.js";
import { buildToolLoopInstructions } from "./toolLoopPrompts.js";

/** Input subset the agentic path needs (structurally compatible with the command graph input). */
export type AgentRunInput = {
  input: string;
  mode?: string;
  userId: string;
  currentWorkspace: CurrentWorkspace;
  sessionContext?: string;
  agentSystemPromptAddition?: string | null;
  agentAllowedTools?: string[] | null;
};

type LoopStep = { toolResults?: Array<{ toolName?: string; output?: unknown }> };

/**
 * Multi-step autonomous agent (Vercel AI SDK ToolLoopAgent) used for `auto`/`research`
 * commands when AGENTIC_TOOLLOOP_V1 is enabled. Returns the same response shape as
 * CommandGraphService.run so commandService and the frontend stay agnostic.
 */
export class ToolLoopAgentService {
  constructor(private readonly db: Firestore) {}

  async run(input: AgentRunInput): Promise<Record<string, unknown>> {
    const agentRunId = `run_${randomUUID()}`;
    const execution = getAiExecutionContext();
    const maxSteps = Math.max(2, execution?.budget.remaining().llmCalls ?? 6);

    const context = {
      db: this.db,
      currentWorkspace: input.currentWorkspace,
      userId: input.userId,
      contextPacket: {
        sessionContext: input.sessionContext,
      } as Record<string, unknown>,
    } as Parameters<typeof adaptToolForAgent>[1];

    const registry = new ToolRegistryService(this.db);
    const defs = await registry.listTools(input.currentWorkspace, input.agentAllowedTools ?? undefined);
    const available = defs.filter((d) => d.available);

    const tools: Record<string, ReturnType<typeof adaptToolForAgent>> = {};
    for (const def of available) {
      tools[def.name] = adaptToolForAgent(def, context);
    }

    const sourceRefs: SourceRef[] = [];
    const collectSources = (step: LoopStep) => {
      for (const tr of step.toolResults ?? []) {
        const out = tr.output as { sourceRefs?: SourceRef[] } | undefined;
        if (out?.sourceRefs?.length) sourceRefs.push(...out.sourceRefs);
      }
    };

    try {
      const agent = new ToolLoopAgent({
        model: env.GATEWAY_DEFAULT_MODEL,
        instructions: buildToolLoopInstructions(input),
        tools,
        stopWhen: stepCountIs(maxSteps),
        onStepFinish: collectSources,
      });

      const { text, steps } = await agent.generate({
        prompt: input.input,
        ...(execution ? { abortSignal: execution.signal } : {}),
      });
      for (const step of (steps ?? []) as LoopStep[]) collectSources(step);

      logger.info("ToolLoopAgent run completed", {
        agentRunId,
        steps: steps?.length ?? 0,
        sources: sourceRefs.length,
      });

      return this.buildResponse(
        agentRunId,
        input,
        text || "I couldn't complete that request.",
        dedupeSources(sourceRefs),
      );
    } catch (error) {
      logger.warn("ToolLoopAgent run failed", {
        agentRunId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.buildResponse(
        agentRunId,
        input,
        "I ran into a problem completing that request. Please try rephrasing or narrowing it.",
        dedupeSources(sourceRefs),
      );
    }
  }

  private buildResponse(
    agentRunId: string,
    input: AgentRunInput,
    answer: string,
    sourceRefs: SourceRef[],
  ): Record<string, unknown> {
    return {
      answer,
      agentRunId,
      resolvedMode: input.mode ?? "auto",
      resultType: "answer",
      result: null,
      proposedActions: [],
      artifactDrafts: [],
      createdArtifact: null,
      createdApproval: null,
      createdWorkflow: null,
      sources: sourceRefs.map((s) => ({ ...s })),
      sourceRefs,
      missingContext: [],
      creditsCharged: 0,
      routeDecision: null,
      routeComparison: null,
      partialResult: null,
    };
  }
}

function dedupeSources(refs: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = r.url ?? r.sourceId;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
