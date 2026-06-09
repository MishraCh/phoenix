import type { AutoIntegrationToolState, HubSpotAutoModule, CommandState } from "../ai/graphs/commandGraph.js";
import { commandPlanSchema } from "../ai/schemas/commandOutput.js";
import type { ExpertExecutionResult, ExpertTypeId, ExpertRendererKey, ExpertSelectedItem } from "../experts/types.js";
import { 
  buildDeterministicContactBriefPayload,
  buildExpertSuggestedActions, 
  buildExpertPlanAnswer, 
  buildExpertPlanHighlights 
} from "../ai/graphs/commandGraph.js";



export type IntegrationHandlerResult = {
  plan: any; // Type inferred from z.infer<typeof commandPlanSchema>
  expertExecution: ExpertExecutionResult | null;
  toolResult?: Record<string, unknown> | null;
  stepLogs: string[];
} | null;

export class IntegrationIntentHandler {
  /**
   * Evaluates if the current state satisfies any deterministic integration intentions,
   * bypassing the LLM planner.
   */
  handle(
    state: typeof CommandState.State, 
    expertRoute: { status: "none" | "needs_context" | "match"; expertType?: string },
    selectedItem: ExpertSelectedItem | null,
    expertConfig?: { expertType: ExpertTypeId; expertGroup: string; rendererKey: ExpertRendererKey }
  ): IntegrationHandlerResult {
    
    // 1. Handle Simple HubSpot CRM Updates directly from semantic intent
    if (
      state.semanticIntent?.intent === "crm_action" &&
      state.semanticIntent.integrationParams?.action === "write" &&
      state.semanticIntent.integrationParams?.provider === "hubspot" &&
      state.semanticIntent.integrationParams?.updates &&
      state.semanticIntent.integrationParams?.module
    ) {
      const updates = state.semanticIntent.integrationParams.updates;
      const targetModule = state.semanticIntent.integrationParams.module;
      
      const recordTitle = selectedItem ? selectedItem.title : "the HubSpot record";
      const recordId = selectedItem ? selectedItem.itemId : state.semanticIntent.integrationParams.targetRecordId;

      if (recordId) {
        const plan = commandPlanSchema.parse({
          intent: "approval",
          answer: `I prepared the HubSpot CRM update for approval based on your request.`,
          highlights: [`Target: ${recordTitle}`, `Change: Update CRM fields`],
          sections: [],
          artifact: null,
          approval: {
            title: `Update ${recordTitle}`,
            reason: "This HubSpot CRM change requires approval before Gideon writes to CRM.",
            type: "crm_update",
            actionType: "hubspot_update",
            toolName: "hubspot.prepareUpdateApproval",
            input: {
              module: targetModule as HubSpotAutoModule,
              recordId,
              title: `Update ${recordTitle}`,
              updates: updates,
            },
            riskLevel: "high",
          },
          notification: null,
          workflowDraft: null,
          requestedCapabilities: [],
          requestedTools: [],
          missingContext: [],
        });

        return {
          plan,
          expertExecution: null,
          toolResult: state.toolResult,
          stepLogs: [`planner:hubspot_update_semantic:${targetModule}`],
        };
      }
    }

    // 2. Handle Deterministic Contact/Company Brief Generation
    if (
      expertRoute.status === "match" &&
      expertConfig &&
      expertConfig.expertType === "contact_brief" &&
      state.toolResult?.status === "completed" &&
      typeof state.toolResult?.module === "string" &&
      (state.toolResult.module === "contacts" || state.toolResult.module === "companies") &&
      state.toolResult.record
    ) {
      const expertExecution: ExpertExecutionResult = {
        expertType: expertConfig.expertType,
        expertGroup: expertConfig.expertGroup as any,
        rendererKey: expertConfig.rendererKey,
        payload: buildDeterministicContactBriefPayload({
          input: state.normalizedInput || state.input,
          toolResult: state.toolResult,
        }),
        suggestedActions: buildExpertSuggestedActions(expertConfig.expertType, selectedItem),
      };

      const plan = commandPlanSchema.parse({
        intent: "brief",
        answer: buildExpertPlanAnswer(expertExecution),
        highlights: buildExpertPlanHighlights(expertExecution),
        sections: [],
        artifact: null,
        approval: null,
        notification: null,
        workflowDraft: null,
        requestedCapabilities: [],
        requestedTools: [],
        missingContext: [],
      });

      return {
        plan,
        expertExecution,
        toolResult: state.toolResult,
        stepLogs: ["expert:contact_brief:deterministic_hubspot"],
      };
    }

    // 3. Handle HubSpot Search Results Fallback
    const toolSummary = state.toolResult ? JSON.stringify(state.toolResult) : "";
    const directHubSpotUserText =
      state.resolvedMode === "auto" && typeof state.toolResult?.userText === "string"
        ? state.toolResult.userText.trim()
        : "";

    if (
      directHubSpotUserText &&
      (
        state.toolResult?.status === "unsupported" ||
        state.toolResult?.status === "error" ||
        state.toolResult?.status === "empty" ||
        state.toolResult?.status === "multiple_matches" ||
        toolSummary.includes("[hubspot-search-results:")
      )
    ) {
      const plan = commandPlanSchema.parse({
        intent: "other",
        answer: directHubSpotUserText,
        highlights: [],
        sections: [],
        artifact: null,
        approval: null,
        notification: null,
        workflowDraft: null,
        requestedCapabilities: [],
        requestedTools: [],
        missingContext:
          state.toolResult?.status === "multiple_matches" || state.toolResult?.status === "empty"
            ? [directHubSpotUserText]
            : [],
      });

      return {
        plan,
        expertExecution: null,
        toolResult: state.toolResult,
        stepLogs: [`planner:hubspot_direct:${String(state.toolResult?.status ?? "completed")}`],
      };
    }

    // No deterministic handler applies
    return null;
  }
}
