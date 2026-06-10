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
import { buildAgentMemoryBlock } from "../retrieval/agentMemoryContext.js";

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
  actionType?: string;
};
type LoopStep = { toolResults?: Array<{ toolName?: string; output?: unknown }> };

/** Map the (sanitized) prepare-approval tool name → the approval's real actionType,
 *  so the frontend routes the agent-path approval to the right card. */
const APPROVAL_ACTION_TYPE_BY_TOOL: Record<string, string> = {
  hubspot_prepareUpdateApproval: "hubspot_update",
  hubspot_prepareCreateApproval: "hubspot_create",
  hubspot_prepareBulkWriteApproval: "hubspot_bulk_write",
  hubspot_prepareNoteApproval: "hubspot_note_create",
  hubspot_prepareTaskCreateApproval: "hubspot_task_create",
  hubspot_prepareTaskUpdateApproval: "hubspot_task_update",
  hubspot_prepareAssociationApproval: "hubspot_association_update",
  gmail_prepareSendApproval: "email_send",
  stripe_preparePaymentLinkApproval: "stripe_payment_link",
};

type CollectorState = {
  sourceRefs: SourceRef[];
  proposedActions: Array<Record<string, unknown>>;
  createdApproval: Record<string, unknown> | null;
  createdArtifact: Record<string, unknown> | null;
  createdWorkflow: Record<string, unknown> | null;
};

/** Accumulates sources + created entities from the agent's tool steps (result parity). */
function createCollector() {
  const state: CollectorState = {
    sourceRefs: [],
    proposedActions: [],
    createdApproval: null,
    createdArtifact: null,
    createdWorkflow: null,
  };
  const collectSteps = (steps: LoopStep[] | undefined) => {
    for (const step of steps ?? []) {
      for (const tr of step.toolResults ?? []) {
        const out = tr.output as ToolResultOutput | undefined;
        if (!out) continue;
        if (out.sourceRefs?.length) state.sourceRefs.push(...out.sourceRefs);
        if (out.approvalId) {
          const actionType =
            typeof out.actionType === "string" ? out.actionType : APPROVAL_ACTION_TYPE_BY_TOOL[tr.toolName ?? ""];
          state.createdApproval = { ...out, ...(actionType ? { actionType } : {}) };
          state.proposedActions.push({
            id: out.approvalId,
            label: out.label ?? "Proposed action",
            riskLevel: out.riskLevel ?? "medium",
            requiresApproval: out.requiresApproval ?? true,
            ...(actionType ? { actionType } : {}),
          });
        }
        if (out.artifactId) state.createdArtifact = out;
        if (out.workflowId) state.createdWorkflow = out;
      }
    }
  };
  return { state, collectSteps };
}

/**
 * Multi-step autonomous agent (Vercel AI SDK ToolLoopAgent) used for `auto`/`research`
 * commands when AGENTIC_TOOLLOOP_V1 is enabled. Returns the same response shape as
 * CommandGraphService.run so commandService and the frontend stay agnostic.
 */
export class ToolLoopAgentService {
  constructor(private readonly db: Firestore) {}

  /** Build the agent + working-memory messages shared by run() and runStream(). */
  private async prepare(input: AgentRunInput) {
    const agentRunId = `run_${randomUUID()}`;
    const execution = getAiExecutionContext();
    const maxSteps = Math.max(2, execution?.budget.remaining().llmCalls ?? 6);

    const context = {
      db: this.db,
      currentWorkspace: input.currentWorkspace,
      userId: input.userId,
      contextPacket: { sessionContext: input.sessionContext } as Record<string, unknown>,
    } as Parameters<typeof adaptToolForAgent>[1];

    const registry = new ToolRegistryService(this.db);
    const defs = await registry.listTools(input.currentWorkspace, input.agentAllowedTools ?? undefined);
    const available = defs.filter((d) => d.available);

    // Model tool-name schema only allows [a-zA-Z0-9_-]; dotted registry names are sanitized.
    const tools: Record<string, ReturnType<typeof adaptToolForAgent>> = {};
    for (const def of available) {
      tools[sanitizeToolName(def.name)] = adaptToolForAgent(def, context);
    }

    // Tier-1 working memory + the new user turn.
    const messages = [...(input.messages ?? []), { role: "user" as const, content: input.input }];
    // Tier-3 long-term memory: relevant workspace facts/prior work.
    const memoryBlock = await buildAgentMemoryBlock(this.db, input.currentWorkspace.id, input.input);

    const agent = new ToolLoopAgent({
      model: env.GATEWAY_DEFAULT_MODEL,
      instructions: buildToolLoopInstructions(input, memoryBlock),
      tools,
      stopWhen: stepCountIs(maxSteps),
    });

    return { agentRunId, execution, agent, messages };
  }

  /** Non-streaming run (used by tests + non-streaming callers). */
  async run(input: AgentRunInput): Promise<Record<string, unknown>> {
    const { agentRunId, execution, agent, messages } = await this.prepare(input);
    const { state, collectSteps } = createCollector();
    try {
      const { text, steps } = await agent.generate({
        messages,
        ...(execution ? { abortSignal: execution.signal } : {}),
      });
      collectSteps(steps as LoopStep[] | undefined);
      logger.info("ToolLoopAgent run completed", {
        agentRunId,
        steps: steps?.length ?? 0,
        sources: state.sourceRefs.length,
        proposedActions: state.proposedActions.length,
      });
      return this.buildResponse(agentRunId, input, state, text || "I couldn't complete that request.");
    } catch (error) {
      logger.warn("ToolLoopAgent run failed", {
        agentRunId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.buildResponse(
        agentRunId,
        input,
        state,
        "I ran into a problem completing that request. Please try rephrasing or narrowing it.",
      );
    }
  }

  /** Streaming run: emits answer-token deltas via onToken; returns the same response shape. */
  async runStream(
    input: AgentRunInput,
    onToken: (delta: string) => void,
  ): Promise<Record<string, unknown>> {
    const { agentRunId, execution, agent, messages } = await this.prepare(input);
    const { state, collectSteps } = createCollector();
    try {
      const result = await agent.stream({
        messages,
        ...(execution ? { abortSignal: execution.signal } : {}),
      });

      let streamed = "";
      for await (const delta of result.textStream) {
        streamed += delta;
        onToken(delta);
      }

      collectSteps((await result.steps) as LoopStep[] | undefined);
      const finalText = (await result.text) || streamed || "I couldn't complete that request.";
      logger.info("ToolLoopAgent stream completed", {
        agentRunId,
        sources: state.sourceRefs.length,
        proposedActions: state.proposedActions.length,
      });
      return this.buildResponse(agentRunId, input, state, finalText);
    } catch (error) {
      logger.warn("ToolLoopAgent stream failed", {
        agentRunId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.buildResponse(
        agentRunId,
        input,
        state,
        "I ran into a problem completing that request. Please try rephrasing or narrowing it.",
      );
    }
  }

  private buildResponse(
    agentRunId: string,
    input: AgentRunInput,
    state: CollectorState,
    answer: string,
  ): Record<string, unknown> {
    const sourceRefs = dedupeSources(state.sourceRefs);
    return {
      answer,
      agentRunId,
      resolvedMode: input.mode ?? "auto",
      resultType: "answer",
      result: null,
      proposedActions: state.proposedActions,
      artifactDrafts: [],
      createdArtifact: state.createdArtifact,
      createdApproval: state.createdApproval,
      createdWorkflow: state.createdWorkflow,
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

/** Model tool names must match ^[a-zA-Z0-9_-]+$ — registry names use dots. */
export function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
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
