import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { Firestore } from "firebase-admin/firestore";

import { publishEvent } from "../sse/eventBus.js";

import { getVisibleAgent, resolveAgent } from "../agents/agentRegistry.js";
import { CommandGraphService } from "../ai/graphs/commandGraph.js";
import { ToolLoopAgentService } from "../ai/agentic/toolLoopAgentService.js";
import { shouldUseToolLoop } from "./commandRouting.js";
import { env } from "../config/env.js";
import type { CommandOriginSurface } from "../ai/contracts/commandContracts.js";
import { commandRequestEnvelopeSchema } from "../ai/contracts/commandRequestEnvelope.js";
import {
  AiExecutionRuntime,
  getAiExecutionContext,
  runWithAiExecutionContext,
  runWithoutAiExecutionContext,
} from "../ai/execution/aiExecutionBudget.js";
import { AiTraceService } from "../ai/observability/aiTraceService.js";
import { AiUsageEventService } from "../ai/observability/aiUsageEventService.js";
import { AiRolloutService } from "../ai/rollout/aiRolloutService.js";
import { CommandSessionService, toSessionMode } from "../commandSessions/commandSessionService.js";
import { AgentConfigRepository } from "../repositories/agentConfigRepository.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { UsageService } from "../usage/usageService.js";
import { ApiError } from "../utils/apiError.js";

export type RunCommandInput = {
  input: string;
  mode?: "auto" | "search" | "research" | "extract_url" | "workflow";
  agentId?: string | null;
  contextBundleId?: string | null;
  attachments?: unknown[];
  sessionId?: string;
  timezone?: string;
  clientCommandId?: string;
  userId: string;
  currentWorkspace: CurrentWorkspace;
  request?: Request;
  source?: "web" | "email" | "whatsapp" | "api" | "slack";
  originSurface?: CommandOriginSurface;
};

export class CommandService {
  constructor(private readonly db: Firestore) {}

  async runCommand(input: RunCommandInput) {
    let agentSystemPromptAddition: string | null = null;
    let agentAllowedTools: string[] | null = null;
    let agentDisplayName: string | null = null;

    let effectiveContextBundleId = input.contextBundleId ?? null;

    if (input.agentId) {
      const registryAgent = getVisibleAgent(input.agentId);
      if (!registryAgent) {
        throw new ApiError({
          code: "NOT_FOUND",
          message: "Agent not found.",
          status: 404,
        });
      }

      const workspaceConfig = await new AgentConfigRepository(this.db).get(
        input.currentWorkspace.id,
        input.agentId,
      );
      const resolved = resolveAgent(registryAgent, workspaceConfig);

      if (resolved.status === "disabled") {
        throw new ApiError({
          code: "AGENT_DISABLED",
          message: "This agent is not currently active.",
          status: 403,
        });
      }

      agentDisplayName = registryAgent.name;

      // Merge registry instructions (baseline) with workspace systemPromptAddition (override)
      agentSystemPromptAddition = [registryAgent.instructions, resolved.systemPromptAddition]
        .filter(Boolean)
        .join("\n\n");

      // null means workspace config has no allowedTools override → registry defaults apply in graph
      agentAllowedTools = workspaceConfig?.allowedTools !== undefined
        ? (workspaceConfig.allowedTools ?? null)
        : null;

      // Agent contextBundleId is a fallback — explicit request contextBundleId still wins
      if (!effectiveContextBundleId && resolved.contextBundleId) {
        effectiveContextBundleId = resolved.contextBundleId;
      }
    }

    // Workspace default bundle is the final fallback (priority: explicit > agent > workspace default > none)
    if (!effectiveContextBundleId && input.currentWorkspace.workspace.defaultContextBundleId) {
      effectiveContextBundleId = input.currentWorkspace.workspace.defaultContextBundleId;
    }

    const usageService = new UsageService(this.db);
    if (input.agentId) {
      usageService.assertAgentAllowedForPlan(input.currentWorkspace.workspace, input.agentId);
    }
    const usage = await usageService.chargeOperation({
      workspace: input.currentWorkspace.workspace,
      userId: input.userId,
      operationType: "simple_command",
      metadata: {
        mode: input.mode ?? "auto",
        agentId: input.agentId ?? null,
      },
    });

    const sessionService = new CommandSessionService(this.db);
    const normalizedMode = toSessionMode(input.mode);

    const session = await sessionService.getOrCreate(
      input.currentWorkspace,
      input.sessionId ?? null,
      { firstQuery: input.input, mode: normalizedMode, source: input.source },
    );

    // Prior turns (before the new one is appended) = agent working memory.
    const priorMessages = await sessionService.getRecentMessages(input.currentWorkspace, session.id, 12);

    await sessionService.appendUserMessage(input.currentWorkspace, session.id, input.input, normalizedMode, input.agentId ?? null, input.source ?? "web");

    const [sessionContext, sessionState] = await Promise.all([
      sessionService.buildSessionContext(input.currentWorkspace, session.id),
      sessionService.loadSessionState(input.currentWorkspace, session.id, session),
    ]);

    const workspaceId = input.currentWorkspace.id;
    const commandId = randomUUID();
    const progressEmit = (event: string, data: Record<string, unknown>) => {
      publishEvent(
        [`workspace:${workspaceId}`, `session:${session.id}`],
        event,
        { workspaceId, sessionId: session.id, commandId, ...data, timestamp: new Date().toISOString() },
      );
    };

    progressEmit("command.started", { mode: input.mode ?? "auto", agentId: input.agentId ?? null });

    const envelope = commandRequestEnvelopeSchema.parse({
      requestId: input.request?.requestId ?? commandId,
      clientCommandId: input.clientCommandId,
      workspaceId,
      userId: input.userId,
      sessionId: session.id,
      rawInput: input.input,
      normalizedInput: input.input.trim(),
      explicitMode: input.mode,
      timezone: input.timezone,
      selectedAgentId: input.agentId ?? null,
      originSurface: input.originSurface ?? "command_center",
      contextBundleId: effectiveContextBundleId,
      selectedContext: sessionState.selectedRefs.map((reference) => ({
        provider: reference.provider,
        objectType: reference.objectType,
        id: reference.id,
        label: reference.label,
        explicitlySelected: reference.explicitlySelected,
      })),
      sessionState,
      attachments: input.attachments ?? [],
      artifactRefs: sessionState.selectedRefs
        .filter((reference) => reference.provider === "internal")
        .map((reference) => reference.id),
      availableCapabilities: [],
      createdAt: new Date().toISOString(),
    });
    const rollout = new AiRolloutService(this.db);
    const traceEnabled = await rollout.isEnabled("AI_TRACE_V2", workspaceId);
    const trace = traceEnabled
      ? new AiTraceService(this.db, {
          workspaceId,
          userId: input.userId,
          requestId: envelope.requestId,
          sessionId: session.id,
          originSurface: envelope.originSurface,
        })
      : null;
    let result;
    const executionRuntime = new AiExecutionRuntime();
    const executionBudget = executionRuntime.budget;
    if (input.mode === "search") executionRuntime.applyIntent("web_search");
    if (input.mode === "research") executionRuntime.applyIntent("deep_research");
    // The multi-step agent loop needs far more headroom than single-pass profiles:
    // tools (deep research, websets) poll external services and the model may fan
    // out parallel tool calls. Streaming keeps the UI responsive meanwhile.
    if (shouldUseToolLoop(input.mode, env.AGENTIC_TOOLLOOP_V1)) {
      executionRuntime.applyIntent("agentic_loop");
    }
    const usageEventService = new AiUsageEventService(this.db);
    try {
      result = await runWithAiExecutionContext(
        {
          requestId: envelope.requestId,
          workspaceId,
          userId: input.userId,
          budget: executionBudget,
          signal: executionRuntime.signal,
          applyBudgetProfile: (intent) => executionRuntime.applyIntent(intent),
          recordUsage: (observation) => {
            trace?.recordUsage(observation);
            const execution = getAiExecutionContext();
            void usageEventService.record({
              workspaceId,
              userId: input.userId,
              requestId: envelope.requestId,
              routeDecision: execution?.routeDecision,
              observation,
              budget: executionBudget,
            });
          },
        },
        () => {
          const runArgs = {
            ...input,
            contextBundleId: effectiveContextBundleId,
            sessionId: session.id,
            sessionContext,
            sessionState,
            messages: priorMessages,
            agentSystemPromptAddition,
            agentAllowedTools,
            progressEmit,
            artifactWritePolicy: "explicit_user_intent" as const,
            requestEnvelope: envelope,
          };
          return shouldUseToolLoop(input.mode, env.AGENTIC_TOOLLOOP_V1)
            ? (new ToolLoopAgentService(this.db).runStream(runArgs, (token) =>
                progressEmit("command.token", { token }),
              ) as ReturnType<CommandGraphService["run"]>)
            : new CommandGraphService(this.db).run(runArgs);
        },
      );
      if (result.routeDecision) {
        trace?.setRouteDecision(result.routeDecision);
      }
      if (result.routeComparison) {
        trace?.setRouteComparison(result.routeComparison);
      }
      await trace?.finish({
        status: result.partialResult ? "partial" : "completed",
        resultKind: result.resultType,
      });
    } catch (error) {
      await trace?.finish({
        status: "failed",
        errorCode: error instanceof Error ? error.name : "UNKNOWN",
      });
      throw error;
    } finally {
      executionRuntime.dispose();
    }

    const assistantMessage = await sessionService.appendAssistantMessage(
      input.currentWorkspace,
      session.id,
      result,
      normalizedMode,
      input.agentId ?? null,
      agentDisplayName,
      input.source ?? "web"
    );
    await sessionService.commitSessionState({
      workspace: input.currentWorkspace,
      session,
      assistantMessageId: assistantMessage.id,
      response: result,
    });
    await sessionService.finalizeSession(input.currentWorkspace, session.id, result, session);

    void runWithoutAiExecutionContext(() =>
      sessionService.summarizeIfNeeded(input.currentWorkspace, session.id),
    );

    return {
      ...result,
      creditsCharged: usage.creditsCharged,
      sessionId: session.id,
      assistantMessageId: assistantMessage.id,
      commandId,
    };
  }
}
