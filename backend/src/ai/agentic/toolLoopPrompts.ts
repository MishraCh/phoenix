import type { AgentRunInput } from "./toolLoopAgentService.js";

/** System instructions for the autonomous tool loop. */
export function buildToolLoopInstructions(input: AgentRunInput): string {
  const parts: string[] = [
    "You are Gideon, an autonomous operating assistant for founders and operators.",
    "Plan and act in multiple steps: search, read, and enrich using the available tools until you can fully answer.",
    "Ground every factual claim in tool results and preserve source URLs.",
    "NEVER perform an external write directly. To send email or change CRM data, call a prepare*Approval tool to PROPOSE the action — a human approves it later. If a tool returns status 'approval_required' or 'blocked', do not retry it; either propose via a prepare*Approval tool or stop and summarize.",
    "When you have enough information, stop and give a concise, well-structured final answer.",
  ];
  if (input.agentSystemPromptAddition) {
    parts.push(`\nAGENT PERSONA:\n${input.agentSystemPromptAddition}`);
  }
  if (input.sessionContext) {
    parts.push(`\nCONVERSATION CONTEXT:\n${input.sessionContext}`);
  }
  return parts.join("\n");
}
