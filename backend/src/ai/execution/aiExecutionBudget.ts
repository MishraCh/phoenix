import { AsyncLocalStorage } from "node:async_hooks";

import type { CommandIntent, RouteDecision } from "../contracts/commandContracts.js";

export type AiBudgetProfile = {
  maxInputTokens: number;
  maxGeneratedTokens: number;
  maxLlmCalls: number;
  defaultOutputTokens: number;
  deadlineMs: number;
};

export type AiBudgetScope = "routing" | "execution";

const ROUTING_PROFILE = {
  maxInputTokens: 12_000,
  maxGeneratedTokens: 1_500,
  maxLlmCalls: 2,
};

export type BudgetProfileKey = CommandIntent | "workflow_agent_step" | "agentic_loop";

const PROFILES: Record<BudgetProfileKey, AiBudgetProfile> = {
  normal_answer: { maxInputTokens: 16_000, maxGeneratedTokens: 8_000, maxLlmCalls: 2, defaultOutputTokens: 1_200, deadlineMs: 25_000 },
  integration_read: { maxInputTokens: 12_000, maxGeneratedTokens: 4_000, maxLlmCalls: 2, defaultOutputTokens: 1_200, deadlineMs: 15_000 },
  integration_write: { maxInputTokens: 12_000, maxGeneratedTokens: 4_000, maxLlmCalls: 2, defaultOutputTokens: 1_200, deadlineMs: 20_000 },
  expert_capability: { maxInputTokens: 24_000, maxGeneratedTokens: 12_000, maxLlmCalls: 2, defaultOutputTokens: 2_500, deadlineMs: 30_000 },
  web_search: { maxInputTokens: 20_000, maxGeneratedTokens: 8_000, maxLlmCalls: 3, defaultOutputTokens: 2_000, deadlineMs: 30_000 },
  deep_research: { maxInputTokens: 64_000, maxGeneratedTokens: 20_000, maxLlmCalls: 5, defaultOutputTokens: 4_000, deadlineMs: 90_000 },
  workflow_create: { maxInputTokens: 20_000, maxGeneratedTokens: 8_000, maxLlmCalls: 2, defaultOutputTokens: 2_500, deadlineMs: 30_000 },
  workflow_run: { maxInputTokens: 24_000, maxGeneratedTokens: 8_000, maxLlmCalls: 2, defaultOutputTokens: 2_500, deadlineMs: 45_000 },
  artifact_query: { maxInputTokens: 20_000, maxGeneratedTokens: 8_000, maxLlmCalls: 2, defaultOutputTokens: 2_000, deadlineMs: 25_000 },
  memory_query: { maxInputTokens: 16_000, maxGeneratedTokens: 6_000, maxLlmCalls: 2, defaultOutputTokens: 1_500, deadlineMs: 25_000 },
  clarification_needed: { maxInputTokens: 8_000, maxGeneratedTokens: 1_000, maxLlmCalls: 1, defaultOutputTokens: 400, deadlineMs: 10_000 },
  workflow_agent_step: { maxInputTokens: 24_000, maxGeneratedTokens: 8_000, maxLlmCalls: 2, defaultOutputTokens: 2_500, deadlineMs: 45_000 },
  // Multi-step autonomous agent (ToolLoopAgent): tools like deep research poll
  // external services for 60s+ and the model may fan out parallel tool calls,
  // so this profile is intentionally generous. Streaming keeps the UI alive.
  agentic_loop: { maxInputTokens: 96_000, maxGeneratedTokens: 24_000, maxLlmCalls: 10, defaultOutputTokens: 4_000, deadlineMs: 240_000 },
};

export class AiBudgetExceededError extends Error {
  constructor(readonly reason: "llm_calls" | "input_tokens" | "generated_tokens" | "deadline") {
    super(`AI execution budget exhausted: ${reason}`);
    this.name = "AiBudgetExceededError";
  }
}

export class AiExecutionBudget {
  private profile: AiBudgetProfile;
  private inputTokens = 0;
  private generatedTokens = 0;
  private llmCalls = 0;
  private routingInputTokens = 0;
  private routingGeneratedTokens = 0;
  private routingLlmCalls = 0;
  private deadlineStartedAt = Date.now();

  constructor(profile: AiBudgetProfile = PROFILES.normal_answer) {
    this.profile = profile;
  }

  applyRoute(route: RouteDecision, workflowStep = false) {
    this.profile = workflowStep ? PROFILES.workflow_agent_step : PROFILES[route.intent];
    this.deadlineStartedAt = Date.now();
  }

  applyIntent(intent: BudgetProfileKey) {
    this.profile = PROFILES[intent];
    this.deadlineStartedAt = Date.now();
  }

  reserveCall(
    estimatedInputTokens: number,
    requestedOutputTokens?: number,
    scope: AiBudgetScope = "execution",
  ) {
    if (Date.now() - this.deadlineStartedAt > this.profile.deadlineMs) {
      throw new AiBudgetExceededError("deadline");
    }

    const isRouting = scope === "routing";
    const callCount = isRouting ? this.routingLlmCalls : this.llmCalls;
    const maxLlmCalls = isRouting ? ROUTING_PROFILE.maxLlmCalls : this.profile.maxLlmCalls;
    const inputTokens = isRouting ? this.routingInputTokens : this.inputTokens;
    const maxInputTokens = isRouting
      ? ROUTING_PROFILE.maxInputTokens
      : this.profile.maxInputTokens;
    const generatedTokens = isRouting
      ? this.routingGeneratedTokens
      : this.generatedTokens;
    const maxGeneratedTokens = isRouting
      ? ROUTING_PROFILE.maxGeneratedTokens
      : this.profile.maxGeneratedTokens;

    if (callCount + 1 > maxLlmCalls) {
      throw new AiBudgetExceededError("llm_calls");
    }
    if (inputTokens + estimatedInputTokens > maxInputTokens) {
      throw new AiBudgetExceededError("input_tokens");
    }

    const outputAllowance = Math.min(
      requestedOutputTokens ?? this.profile.defaultOutputTokens,
      maxGeneratedTokens - generatedTokens,
    );
    if (outputAllowance <= 0) {
      throw new AiBudgetExceededError("generated_tokens");
    }

    if (isRouting) {
      this.routingLlmCalls += 1;
      this.routingInputTokens += estimatedInputTokens;
    } else {
      this.llmCalls += 1;
      this.inputTokens += estimatedInputTokens;
    }
    return outputAllowance;
  }

  recordGeneratedTokens(tokens: number, scope: AiBudgetScope = "execution") {
    if (scope === "routing") {
      this.routingGeneratedTokens += Math.max(0, tokens);
      return;
    }
    this.generatedTokens += Math.max(0, tokens);
  }

  deadlineRemainingMs() {
    return Math.max(
      0,
      this.profile.deadlineMs - (Date.now() - this.deadlineStartedAt),
    );
  }

  remaining() {
    return {
      llmCalls: Math.max(0, this.profile.maxLlmCalls - this.llmCalls),
      routingLlmCalls: Math.max(0, ROUTING_PROFILE.maxLlmCalls - this.routingLlmCalls),
      inputTokens: Math.max(0, this.profile.maxInputTokens - this.inputTokens),
      routingInputTokens: Math.max(
        0,
        ROUTING_PROFILE.maxInputTokens - this.routingInputTokens,
      ),
      generatedTokens: Math.max(0, this.profile.maxGeneratedTokens - this.generatedTokens),
      routingGeneratedTokens: Math.max(
        0,
        ROUTING_PROFILE.maxGeneratedTokens - this.routingGeneratedTokens,
      ),
      deadlineMs: this.deadlineRemainingMs(),
    };
  }
}

export type AiUsageObservation = {
  provider: string;
  model: string;
  role?: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  estimated: boolean;
  scope?: AiBudgetScope;
};

export type AiExecutionContext = {
  requestId: string;
  workspaceId: string;
  userId: string;
  workflowStep?: boolean;
  routeDecision?: RouteDecision;
  budget: AiExecutionBudget;
  signal: AbortSignal;
  applyBudgetProfile?: (intent: BudgetProfileKey) => void;
  recordUsage: (usage: AiUsageObservation) => void;
};

export class AiExecutionRuntime {
  readonly budget: AiExecutionBudget;
  private readonly abortController = new AbortController();
  private deadline: NodeJS.Timeout | null = null;

  constructor(budget = new AiExecutionBudget()) {
    this.budget = budget;
    this.scheduleDeadline();
  }

  get signal() {
    return this.abortController.signal;
  }

  applyIntent(intent: BudgetProfileKey) {
    this.budget.applyIntent(intent);
    this.scheduleDeadline();
  }

  applyRoute(route: RouteDecision, workflowStep = false) {
    this.budget.applyRoute(route, workflowStep);
    this.scheduleDeadline();
  }

  dispose() {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
  }

  private scheduleDeadline() {
    if (this.deadline) clearTimeout(this.deadline);
    const remainingMs = this.budget.deadlineRemainingMs();
    if (remainingMs <= 0) {
      this.abortController.abort("ai_execution_deadline");
      return;
    }
    this.deadline = setTimeout(
      () => this.abortController.abort("ai_execution_deadline"),
      remainingMs,
    );
  }
}

const storage = new AsyncLocalStorage<AiExecutionContext>();

export function runWithAiExecutionContext<T>(context: AiExecutionContext, work: () => Promise<T>) {
  return storage.run(context, work);
}

export function getAiExecutionContext() {
  return storage.getStore();
}

export function runWithoutAiExecutionContext<T>(work: () => T) {
  return storage.exit(work);
}

export function estimateTokens(text?: string | null) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
