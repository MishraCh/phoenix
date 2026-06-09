import { tool } from "ai";

import { PolicyService } from "../../policy/policyService.js";
import type { ToolDefinition, ToolExecutionContext } from "../../tools/toolRegistry.js";

/** Keep only tools safe to expose to an autonomous loop. */
export function filterToolsForAgent(
  defs: ToolDefinition[],
  allowedToolNames?: string[],
): ToolDefinition[] {
  return defs
    .filter((d) => d.exposedToPlanner !== false)
    .filter(
      (d) => !allowedToolNames || allowedToolNames.length === 0 || allowedToolNames.includes(d.name),
    );
}

/**
 * Adapt a ToolDefinition to a Vercel AI SDK tool, enforcing policy guardrails.
 * External writes are never executed in-loop: tools whose policy requires
 * approval return a structured "approval_required" result instead of running.
 */
export function adaptToolForAgent(toolDef: ToolDefinition, context: ToolExecutionContext) {
  const policy = new PolicyService();
  const built = toolDef.buildTool(context);

  return tool({
    description: toolDef.description,
    inputSchema: toolDef.inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const decision = policy.evaluateAction({
        currentWorkspace: context.currentWorkspace,
        toolName: toolDef.name,
        actionType: typeof input.actionType === "string" ? input.actionType : "default",
        requestedRiskLevel: toolDef.riskLevel,
        requestedRequiresApproval: toolDef.requiresApproval,
      });

      if (decision.status === "blocked") {
        return { status: "blocked", reason: decision.reason };
      }
      if (decision.status === "approval_required" || decision.requiresApproval) {
        return {
          status: "approval_required",
          reason: decision.reason,
          note: "This action needs human approval. Use a prepare*Approval tool to propose it, or stop and summarize.",
        };
      }

      return built.invoke(input);
    },
  });
}
