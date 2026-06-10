import type { AgentRunInput } from "./toolLoopAgentService.js";

/** System instructions for the autonomous tool loop.
 *  `memoryBlock` is the Tier-3 long-term retrieval block (workspace facts/prior work). */
export function buildToolLoopInstructions(input: AgentRunInput, memoryBlock?: string): string {
  const parts: string[] = [
    "You are Gideon, an autonomous operating assistant for founders and operators.",
    "Plan and act in multiple steps: search, read, and enrich using the available tools until you can fully answer.",
    "TOOL SELECTION: prefer fast tools. web.researchTask answers most research/comparison questions in seconds with citations — use it (multiple calls for multiple subjects are fine). Reserve web.deepResearch for explicit deep-dive requests, never more than one call, and never in parallel with other deepResearch calls.",
    "Ground every factual claim in tool results and preserve source URLs.",
    "NEVER perform an external write directly. To send email or change CRM data, call a prepare*Approval tool to PROPOSE the action — a human approves it later. If a tool returns status 'approval_required' or 'blocked', do not retry it; either propose via a prepare*Approval tool or stop and summarize.",
    "When you have enough information, stop and give a concise, well-structured final answer.",
  ];
  if (input.agentSystemPromptAddition) {
    parts.push(`\nAGENT PERSONA:\n${input.agentSystemPromptAddition}`);
  }
  const entities = input.sessionState?.activeEntities ?? [];
  if (entities.length) {
    const lines = entities
      .map((e) => `- ${e.label}${e.objectType ? ` (${e.objectType})` : ""}${e.id ? ` [id:${e.id}]` : ""}`)
      .join("\n");
    parts.push(
      `\nACTIVE ENTITIES (resolve references like "it", "that company", "her", "them" to these — do not re-ask the user for IDs already established):\n${lines}`,
    );
  }
  if (memoryBlock && memoryBlock.trim()) {
    parts.push(`\n${memoryBlock.trim()}`);
  }
  if (input.sessionContext) {
    parts.push(`\nCONVERSATION CONTEXT:\n${input.sessionContext}`);
  }
  return parts.join("\n");
}
