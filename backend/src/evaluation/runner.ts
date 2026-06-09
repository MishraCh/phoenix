import type { Firestore } from "firebase-admin/firestore";

import { getVisibleAgent } from "../agents/agentRegistry.js";
import { CommandGraphService } from "../ai/graphs/commandGraph.js";
import {
  AiExecutionRuntime,
  runWithAiExecutionContext,
} from "../ai/execution/aiExecutionBudget.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import type { CommandMode } from "../ai/schemas/commandOutput.js";
import type { EvalCase, EvalReport, EvalResult } from "./types.js";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export type RunnerOptions = {
  currentWorkspace: CurrentWorkspace;
  userId: string;
  timeoutMs?: number;
};

export class EvaluationRunner {
  private readonly graph: CommandGraphService;
  private readonly currentWorkspace: CurrentWorkspace;
  private readonly userId: string;
  private readonly timeoutMs: number;

  constructor(db: Firestore, options: RunnerOptions) {
    this.graph = new CommandGraphService(db);
    this.currentWorkspace = options.currentWorkspace;
    this.userId = options.userId;
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async runCase(evalCase: EvalCase): Promise<EvalResult> {
    const start = Date.now();

    let agentSystemPromptAddition: string | null = null;
    let agentAllowedTools: string[] | null = null;

    if (evalCase.selectedAgentId) {
      const agent = getVisibleAgent(evalCase.selectedAgentId);
      if (agent) {
        agentSystemPromptAddition = agent.instructions;
        agentAllowedTools = agent.toolsAllowed;
      }
    }

    const executionRuntime = new AiExecutionRuntime();
    if (evalCase.mode === "search") executionRuntime.applyIntent("web_search");
    if (evalCase.mode === "research") executionRuntime.applyIntent("deep_research");

    try {
      const result = await withTimeout(
        runWithAiExecutionContext(
          {
            requestId: `eval:${evalCase.id}:${Date.now()}`,
            workspaceId: this.currentWorkspace.id,
            userId: this.userId,
            budget: executionRuntime.budget,
            signal: executionRuntime.signal,
            applyBudgetProfile: (intent) => executionRuntime.applyIntent(intent),
            recordUsage: () => undefined,
          },
          () =>
            this.graph.run({
              input: evalCase.input,
              userId: this.userId,
              currentWorkspace: this.currentWorkspace,
              mode: evalCase.mode as CommandMode | undefined,
              agentId: evalCase.selectedAgentId ?? null,
              sessionContext: evalCase.sessionContext,
              agentSystemPromptAddition,
              agentAllowedTools,
            }),
        ),
        this.timeoutMs,
      );

      // Score against the full answer text + structured result JSON
      const corpus = [result.answer, JSON.stringify(result.result ?? {})].join(" ").toLowerCase();

      const missingSignals = evalCase.requiredSignals.filter(
        (sig) => !corpus.includes(sig.toLowerCase()),
      );
      const foundProhibited = evalCase.prohibitedClaims.filter((claim) =>
        corpus.includes(claim.toLowerCase()),
      );

      return {
        caseId: evalCase.id,
        caseName: evalCase.name,
        category: evalCase.category,
        pass: missingSignals.length === 0 && foundProhibited.length === 0,
        resolvedMode: result.resolvedMode,
        resultType: result.resultType,
        answerExcerpt: result.answer.slice(0, 400).replace(/\n+/g, " "),
        missingSignals,
        foundProhibited,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        caseId: evalCase.id,
        caseName: evalCase.name,
        category: evalCase.category,
        pass: false,
        resolvedMode: "error",
        resultType: "error",
        answerExcerpt: "",
        missingSignals: evalCase.requiredSignals,
        foundProhibited: [],
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      executionRuntime.dispose();
    }
  }

  async runAll(cases: EvalCase[], log = true): Promise<EvalReport> {
    const runStart = Date.now();
    const results: EvalResult[] = [];

    for (const evalCase of cases) {
      if (log) {
        process.stdout.write(`  ⏳ [${evalCase.id}] ${evalCase.name}…`);
      }

      const result = await this.runCase(evalCase);
      results.push(result);

      if (log) {
        const icon = result.error ? "💥" : result.pass ? "✓ " : "✗ ";
        const dur = `${result.durationMs}ms`;
        process.stdout.write(`\r  ${icon} [${evalCase.id}] ${evalCase.name} — ${result.resolvedMode} (${dur})\n`);
        if (!result.pass && !result.error) {
          if (result.missingSignals.length > 0)
            console.log(`       ↳ missing signals : ${result.missingSignals.join(", ")}`);
          if (result.foundProhibited.length > 0)
            console.log(`       ↳ prohibited found: ${result.foundProhibited.join(", ")}`);
        }
        if (result.error) {
          console.log(`       ↳ error: ${result.error.slice(0, 200)}`);
        }
      }
    }

    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass && !r.error).length;
    const errored = results.filter((r) => Boolean(r.error)).length;

    const byCategory: EvalReport["byCategory"] = {};
    for (const r of results) {
      byCategory[r.category] ??= { total: 0, passed: 0 };
      byCategory[r.category]!.total++;
      if (r.pass) byCategory[r.category]!.passed++;
    }

    return {
      runAt: new Date().toISOString(),
      workspaceId: this.currentWorkspace.id,
      workspaceName: this.currentWorkspace.workspace.name,
      totalCases: results.length,
      passed,
      failed,
      errored,
      durationMs: Date.now() - runStart,
      byCategory,
      results,
    };
  }
}
