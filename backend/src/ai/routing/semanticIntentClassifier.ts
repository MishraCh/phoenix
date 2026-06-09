import { z } from "zod";
import { createLlmProvider } from "../providers/providerRegistry.js";
import { logger } from "../../observability/logger.js";
import type { RouteIntent } from "./intentRouterService.js";
import type { ExpertSelectedItem } from "../../experts/types.js";
import type { HubSpotAutoModule } from "../graphs/commandGraph.js";

export const semanticIntentSchema = z.object({
  intent: z.enum([
    "normal_answer",
    "expert_tool",
    "integration_read",
    "crm_action",
    "email_action",
    "workflow_create",
    "research",
    "analyze_company",
    "evaluate_website",
    "artifact_query",
    "memory_query",
    "clarification_needed"
  ] as const),
  expertCapabilityId: z.string().nullable().describe("ID of the expert tool SOP to use, if the intent is expert_tool"),
  integrationParams: z.object({
    provider: z.enum(["hubspot", "gmail"]).nullable(),
    module: z.enum(["contacts", "companies", "deals", "notes", "tasks", "threads"]).nullable(),
    action: z.enum(["read", "write", "draft_reply"]).nullable(),
    targetRecordId: z.string().nullable(),
    targetQuery: z.string().nullable(),
    updates: z.record(z.string(), z.any()).nullable().describe("Key-value pairs of fields to update or create"),
  }).nullable(),
  reason: z.string().describe("Explanation for why this intent was chosen"),
});

export type SemanticIntentResult = z.infer<typeof semanticIntentSchema>;

export type SemanticIntentClassifierInput = {
  userQuery: string;
  selectedItem: ExpertSelectedItem | null;
  availableCapabilities: string[];
  retrievedExpertSopMetadata: Array<{
    capabilityId: string;
    description: string;
  }>;
};

export class SemanticIntentClassifier {
  async classify(input: SemanticIntentClassifierInput): Promise<SemanticIntentResult> {
    const llm = createLlmProvider("fast");
    
    let contextStr = "Context:\n";
    if (input.selectedItem) {
      contextStr += `- Selected Item: ${input.selectedItem.provider} ${input.selectedItem.itemType} (${input.selectedItem.itemId}) "${input.selectedItem.title}"\n`;
    }
    
    if (input.availableCapabilities.length > 0) {
      contextStr += `- Available Capabilities: ${input.availableCapabilities.join(", ")}\n`;
    }

    if (input.retrievedExpertSopMetadata.length > 0) {
      contextStr += `- Retrieved Expert SOPs:\n`;
      input.retrievedExpertSopMetadata.forEach(sop => {
        contextStr += `  * ${sop.capabilityId}: ${sop.description}\n`;
      });
    }

    const systemPrompt = `You are an intent classification router for an AI Chief of Staff.
Your job is to classify the user's intent into exactly one of the allowed categories.

${contextStr}

Rules:
1. If the user wants to update or change a CRM record, return intent="crm_action", integrationParams.action="write".
   - Extract the exact fields they want to change into integrationParams.updates (e.g. {"dealstage": "closedwon"}).
   - Infer the target module (contacts, companies, deals, notes, tasks).
2. If the user wants to read or search a CRM, return intent="crm_action", integrationParams.action="read", and provide targetQuery if applicable.
2b. **CRITICAL NEGATIVE CONSTRAINT**: DO NOT assume a request needs CRM data unless the user explicitly mentions "HubSpot", "CRM", "deals", "contacts", or "companies". Generic terms like "score", "evaluate", or "normalize" must use intent="normal_answer" or "research".
3. If the user is asking for general market, competitor, or web research (e.g. "research our competitors", "find startups"), return intent="research", NOT "expert_tool".
4. ONLY use intent="expert_tool" if the user explicitly asks for a specific proprietary output (e.g. "build a battlecard", "score this deal") OR if they are asking to analyze a specific CRM record that directly maps to an expert tool.
   - **CRITICAL**: Even if intent is "expert_tool", you MUST still output integrationParams (provider="hubspot", module="contacts", action="read", targetQuery) if the expert tool requires looking up CRM records.
5. Do not invent a targetRecordId if it's not provided in the selected item context.
8. If the request is generic chat or out of scope, return "normal_answer".
9. **AMBIGUITY CHECK**: If the user asks for a specific CRM or Email related task (like a summary, scorecard, draft reply, or brief) but does NOT provide a target name, company, or record, and there is no Selected Item in the Context, DO NOT assume a target. Return intent="clarification_needed" and use the 'reason' field to ask them to specify who or what they are referring to (e.g. "Which email thread?" or "Which contact?").
10. If the user asks about Gideon itself, its features, their workspace, or their profile on the platform, return intent="normal_answer". DO NOT use "expert_tool" or "crm_action" for meta-questions about the app.
11. **MEMORY OVERRIDE**: If the user explicitly asks you to base your answer on their "workspace", "profile", "memory", "documents", or "internal data", DO NOT use "expert_tool" or "crm_action". HOWEVER, if they are ALSO asking about an external company or topic (e.g. "What does XFactor AI do based on my profile?"), return intent="research" or "analyze_company". Otherwise, return intent="memory_query" or "normal_answer".`;

    try {
      const result = await llm.generateStructured({
        schema: semanticIntentSchema,
        systemPrompt,
        userPrompt: input.userQuery,
        budgetScope: "routing",
      });

      return result;
    } catch (err) {
      logger.error("SemanticIntentClassifier failed", { error: err });
      return {
        intent: "normal_answer",
        expertCapabilityId: null,
        integrationParams: null,
        reason: "fallback due to classifier error",
      };
    }
  }
}
