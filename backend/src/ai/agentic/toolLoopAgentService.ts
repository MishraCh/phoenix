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

/** A resolved entity carried in session state for reference resolution. */
export type ActiveEntity = { label: string; objectType?: string; id?: string };

/** Input subset the agentic path needs (structurally compatible with the command graph input). */
export type AgentRunInput = {
  input: string;
  mode?: string;
  userId: string;
  currentWorkspace: CurrentWorkspace;
  /** Working memory: prior conversation turns (Tier 1 continuity). */
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  sessionContext?: string;
  /** Compressed session state incl. the active-entity register (Tier 2). */
  sessionState?: { activeEntities?: ActiveEntity[]; recentResults?: unknown[] } | null;
  agentSystemPromptAddition?: string | null;
  agentAllowedTools?: string[] | null;
};

type ToolResultOutput = {
  sourceRefs?: SourceRef[];
  approvalId?: string;
  artifactId?: string;
  workflowId?: string;
  label?: string;
  riskLevel?: string;
  requiresApproval?: boolean;
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

    // Accumulate sources + created entities from the tool loop (result parity).
    const sourceRefs: SourceRef[] = [];
    const proposedActions: Array<Record<string, unknown>> = [];
    let createdApproval: Record<string, unknown> | null = null;
    let createdArtifact: Record<string, unknown> | null = null;
    let createdWorkflow: Record<string, unknown> | null = null;

    const collectFromStep = (step: LoopStep) => {
      for (const tr of step.toolResults ?? []) {
        const out = tr.output as ToolResultOutput | undefined;
        if (!out) continue;
        if (out.sourceRefs?.length) sourceRefs.push(...out.sourceRefs);
        if (out.approvalId) {
          createdApproval = out;
          proposedActions.push({
            id: out.approvalId,
            label: out.label ?? "Proposed action",
            riskLevel: out.riskLevel ?? "medium",
            requiresApproval: out.requiresApproval ?? true,
          });
        }
        if (out.artifactId) createdArtifact = out;
        if (out.workflowId) createdWorkflow = out;
      }
    };

    // Tier-1 working memory: prior turns + the new user turn.
    const messages = [
      ...(input.messages ?? []),
      { role: "user" as const, content: input.input },
    ];

    try {
      const agent = new ToolLoopAgent({
        model: env.GATEWAY_DEFAULT_MODEL,
        instructions: buildToolLoopInstructions(input),
        tools,
        stopWhen: stepCountIs(maxSteps),
        onStepFinish: collectFromStep,
      });

      const { text, steps } = await agent.generate({
        messages,
        ...(execution ? { abortSignal: execution.signal } : {}),
      });
      for (const step of (steps ?? []) as LoopStep[]) collectFromStep(step);

      logger.info("ToolLoopAgent run completed", {
        agentRunId,
        steps: steps?.length ?? 0,
        sources: sourceRefs.length,
        proposedActions: proposedActions.length,
      });

      return this.buildResponse(agentRunId, input, {
        answer: text || "I couldn't complete that request.",
        sourceRefs: dedupeSources(sourceRefs),
        proposedActions,
        createdApproval,
        createdArtifact,
        createdWorkflow,
      });
    } catch (error) {
      logger.warn("ToolLoopAgent run failed", {
        agentRunId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.buildResponse(agentRunId, input, {
        answer: "I ran into a problem completing that request. Please try rephrasing or narrowing it.",
        sourceRefs: dedupeSources(sourceRefs),
        proposedActions,
        createdApproval,
        createdArtifact,
        createdWorkflow,
      });
    }
  }

  private buildResponse(
    agentRunId: string,
    input: AgentRunInput,
    parts: {
      answer: string;
      sourceRefs: SourceRef[];
      proposedActions: Array<Record<string, unknown>>;
      createdApproval: Record<string, unknown> | null;
      createdArtifact: Record<string, unknown> | null;
      createdWorkflow: Record<string, unknown> | null;
    },
  ): Record<string, unknown> {
    return {
      answer: parts.answer,
      agentRunId,
      resolvedMode: input.mode ?? "auto",
      resultType: "answer",
      result: null,
      proposedActions: parts.proposedActions,
      artifactDrafts: [],
      createdArtifact: parts.createdArtifact,
      createdApproval: parts.createdApproval,
      createdWorkflow: parts.createdWorkflow,
      sources: parts.sourceRefs.map((s) => ({ ...s })),
      sourceRefs: parts.sourceRefs,
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
