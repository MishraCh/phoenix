import { randomUUID } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";

import type { ExpertSelectedItem } from "../../experts/types.js";
import { extractHubSpotUpdate } from "../../integrations/actions/hubSpotNlpUtils.js";
import { logger } from "../../observability/logger.js";
import {
  routeDecisionSchema,
  type CommandOriginSurface,
  type RouteDecision,
} from "../contracts/commandContracts.js";
import type { SessionStateSnapshot } from "../contracts/sessionState.js";
import {
  resolveReferencedRecentResult,
  shouldEnrichResearchFollowUp,
} from "../context/recentResultResolver.js";
import { createClassifierProvider } from "../providers/providerRegistry.js";
import { isCapabilityHelpQuery } from "./capabilityHelpIntent.js";
import { IntentRouterService } from "./intentRouterService.js";
import type { SemanticIntentResult } from "./semanticIntentClassifier.js";

const classifierOutputSchema = z.object({
  intent: z.enum([
    "normal_answer",
    "integration_read",
    "integration_write",
    "expert_capability",
    "web_search",
    "deep_research",
    "workflow_create",
    "workflow_run",
    "artifact_query",
    "memory_query",
    "clarification_needed",
    "web_research",
  ]),
  provider: z.enum(["gmail", "hubspot"]).nullable(),
  objectType: z.string().nullable(),
  action: z.string().nullable(),
  actionInput: z.record(z.string(), z.unknown()).default({}),
  expertCapabilityId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  missingRequirements: z.array(z.string()),
  clarificationQuestion: z.string().nullable(),
  reason: z.string(),
});

export type CommandRouterV2Input = {
  userQuery: string;
  explicitMode: string;
  originSurface: CommandOriginSurface;
  selectedItem: ExpertSelectedItem | null;
  selectedAgentId: string | null;
  availableCapabilities: string[];
  sessionState: SessionStateSnapshot | null;
  workspaceId: string;
  userId: string;
};

const WRITE_PATTERN = /\b(update|change|edit|set|create|add|send|reply|delete|remove|associate|schedule)\b/i;
const ANALYSIS_PATTERN = /\b(brief|analy[sz]e|score|prepare|prep|risk|health|battlecard|signals?)\b/i;
const COREFERENCE_PATTERN = /\b(this|that|it|they|them|their|the contact|the company|the deal|the thread)\b/i;
const URL_PATTERN = /https?:\/\/\S+/i;

function hasCapability(capabilities: string[], provider: "gmail" | "hubspot") {
  const matcher = provider === "hubspot" ? /hubspot|crm/i : /gmail|email/i;
  return capabilities.some((capability) => matcher.test(capability));
}

function expectedResultKind(intent: z.infer<typeof classifierOutputSchema>["intent"]) {
  if (intent === "integration_read") return "integration_records" as const;
  if (intent === "integration_write") return "approval" as const;
  if (intent === "expert_capability") return "expert" as const;
  if (intent === "web_search" || intent === "deep_research") return "research" as const;
  if (intent === "workflow_create") return "workflow_draft" as const;
  if (intent === "workflow_run") return "workflow" as const;
  if (intent === "clarification_needed") return "clarification" as const;
  return "answer" as const;
}

function toolStrategy(intent: z.infer<typeof classifierOutputSchema>["intent"]) {
  if (intent === "integration_read") return "integration_read" as const;
  if (intent === "integration_write") return "external_action" as const;
  if (intent === "web_search") return "web_search" as const;
  if (intent === "deep_research") return "deep_research" as const;
  if (intent === "workflow_create" || intent === "workflow_run") return "workflow" as const;
  return "none" as const;
}

function demoteAutoDeepResearchIntent(
  result: z.infer<typeof classifierOutputSchema>,
): z.infer<typeof classifierOutputSchema> {
  let normalized = result;
  if (result.intent === "web_research") {
    normalized = { ...result, intent: "web_search" };
  }
  if (normalized.intent !== "deep_research") {
    return normalized;
  }

  return {
    ...normalized,
    intent: "web_search",
    reason: `${normalized.reason}; demoted_to_quick_search_in_auto_mode`,
  };
}

function route(
  input: Omit<z.input<typeof routeDecisionSchema>, "routeId">,
): RouteDecision {
  return routeDecisionSchema.parse({ routeId: randomUUID(), ...input });
}

function normalizeLegacyModule(
  value: string | undefined,
): "contacts" | "companies" | "deals" | "notes" | "tasks" | "threads" | null {
  if (
    value === "contacts" ||
    value === "companies" ||
    value === "deals" ||
    value === "notes" ||
    value === "tasks" ||
    value === "threads"
  ) {
    return value;
  }
  return null;
}

function activeEntityForQuery(input: CommandRouterV2Input) {
  if (!COREFERENCE_PATTERN.test(input.userQuery)) return null;
  const entities = input.sessionState?.activeEntities ?? [];
  return entities.length === 1 ? entities[0] : null;
}

function resolvePendingDisambiguation(input: CommandRouterV2Input) {
  const pending = input.sessionState?.pendingDisambiguation;
  if (!pending) return null;
  const query = input.userQuery.trim().toLowerCase();
  const ordinalWords: Record<string, number> = {
    first: 0,
    "1": 0,
    "1st": 0,
    second: 1,
    "2": 1,
    "2nd": 1,
    third: 2,
    "3": 2,
    "3rd": 2,
    fourth: 3,
    "4": 3,
    "4th": 3,
    fifth: 4,
    "5": 4,
    "5th": 4,
  };
  const ordinal = Object.entries(ordinalWords).find(([word]) =>
    new RegExp(`\\b${word}\\b`, "i").test(query),
  )?.[1];
  if (ordinal !== undefined && pending.candidates[ordinal]) {
    return pending.candidates[ordinal];
  }
  const byLabel = pending.candidates.filter((candidate) =>
    query.includes(candidate.label.toLowerCase()),
  );
  return byLabel.length === 1 ? byLabel[0] : null;
}

function isWorkflowRunIntent(query: string) {
  return /\b(run|execute|trigger|start|launch)\s+(?:the\s+|my\s+)?(?:[\w\s-]+\s+)?(workflow|automation)\b/i.test(query);
}

function isWorkflowCreateIntent(query: string) {
  if (/\b(workflow|automation|automate)\b/i.test(query)) return true;
  if (/\b(create|draft|setup|build|schedule|start)\s+(?:a\s+|an\s+)?(recurring|weekly|daily|monthly)\b/i.test(query)) return true;
  if (/\b(run|send|notify|email|alert)(?:\s+me)?\s+(every|each)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|day|week|month)\b/i.test(query)) return true;
  return false;
}

// extractHubSpotUpdate is imported from hubSpotNlpUtils.ts

export function toLegacySemanticIntent(decision: RouteDecision): SemanticIntentResult {
  const provider = decision.provider ?? null;
  const action = decision.intent === "integration_write" ? "write" : "read";
  const integrationParams =
    provider
      ? {
          provider,
          module: normalizeLegacyModule(decision.objectType),
          action: provider === "gmail" && decision.action === "draft_reply" ? "draft_reply" as const : action as "read" | "write",
          targetRecordId: decision.resolvedEntities[0]?.id ?? null,
          targetQuery:
            typeof decision.actionInput["targetQuery"] === "string"
              ? decision.actionInput["targetQuery"]
              : decision.resolvedEntities[0]?.label ?? null,
          updates:
            decision.actionInput["updates"] &&
            typeof decision.actionInput["updates"] === "object" &&
            !Array.isArray(decision.actionInput["updates"])
              ? decision.actionInput["updates"] as Record<string, unknown>
              : null,
        }
      : null;

  const intent =
    decision.intent === "expert_capability"
      ? "expert_tool"
      : decision.intent === "integration_write" && provider === "hubspot"
        ? "crm_action"
        : decision.intent === "integration_write" && provider === "gmail"
          ? "email_action"
          : decision.intent === "integration_read" && provider === "hubspot"
            ? "crm_action"
            : decision.intent === "integration_read"
              ? "integration_read"
              : decision.intent === "web_search" || decision.intent === "deep_research"
                ? "research"
                : decision.intent === "workflow_create"
                  ? "workflow_create"
                  : decision.intent === "artifact_query"
                    ? "artifact_query"
                    : decision.intent === "memory_query"
                      ? "memory_query"
                      : decision.intent === "clarification_needed"
                        ? "clarification_needed"
                        : "normal_answer";

  return {
    intent,
    expertCapabilityId: decision.expertCapabilityId ?? null,
    integrationParams,
    reason: decision.reason,
  };
}

export class CommandRouterV2 {
  constructor(private readonly db: Firestore) {}

  async route(input: CommandRouterV2Input): Promise<RouteDecision> {
    const query = input.userQuery.trim();
    const lower = query.toLowerCase();
    const hubspotConnected = hasCapability(input.availableCapabilities, "hubspot");
    const gmailConnected = hasCapability(input.availableCapabilities, "gmail");
    const activeEntity = activeEntityForQuery(input);
    const selectedProvider = input.selectedItem?.provider;
    const referencedResult = resolveReferencedRecentResult(query, input.sessionState);

    const disambiguated = resolvePendingDisambiguation(input);
    if (disambiguated) {
      const pendingAction = input.sessionState?.pendingAction;
      return route({
        intent: pendingAction ? "integration_write" : "integration_read",
        toolStrategy: pendingAction ? "external_action" : "integration_read",
        provider: disambiguated.provider,
        objectType: disambiguated.objectType,
        ...(pendingAction ? { action: pendingAction.actionType, actionInput: pendingAction.input } : {}),
        resolvedEntities: [{
          provider: disambiguated.provider,
          objectType: disambiguated.objectType,
          id: disambiguated.id,
          label: disambiguated.label,
          aliases: [],
          confidence: 1,
          source: "session",
        }],
        confidence: 1,
        missingRequirements: [],
        expectedResultKind: pendingAction ? "approval" : "integration_records",
        routeSource: "session_context",
        reason: "resolved_pending_disambiguation",
      });
    }

    if (referencedResult) {
      const referencedKind = typeof referencedResult.compactPayload["kind"] === "string"
        ? referencedResult.compactPayload["kind"]
        : referencedResult.resultKind;
      if (referencedKind === "workflow_draft") {
        return route({
          intent: "workflow_create",
          toolStrategy: "workflow",
          actionInput: {
            referencedMessageId: referencedResult.messageId,
          },
          resolvedEntities: [],
          confidence: 0.97,
          missingRequirements: [],
          expectedResultKind: "workflow_draft",
          routeSource: "session_context",
          reason: "workflow_draft_follow_up_edit",
        });
      }

      const continueResearch = shouldEnrichResearchFollowUp(query, referencedResult);
      return route({
        intent: continueResearch ? "web_search" : "normal_answer",
        toolStrategy: continueResearch ? "web_search" : "none",
        actionInput: {
          referencedMessageId: referencedResult.messageId,
        },
        resolvedEntities: [],
        confidence: 0.98,
        missingRequirements: [],
        expectedResultKind: continueResearch ? "research" : "answer",
        routeSource: "session_context",
        reason: continueResearch
          ? "explicit_follow_up_on_prior_research"
          : "explicit_follow_up_on_prior_result",
      });
    }

    if (input.explicitMode === "search") {
      return route({
        intent: "web_search",
        toolStrategy: "web_search",
        confidence: 1,
        resolvedEntities: [],
        missingRequirements: [],
        expectedResultKind: "research",
        routeSource: "hard_rule",
        reason: "explicit_search_mode",
      });
    }
    if (input.explicitMode === "research") {
      return route({
        intent: "deep_research",
        toolStrategy: "deep_research",
        confidence: 1,
        resolvedEntities: [],
        missingRequirements: [],
        expectedResultKind: "research",
        routeSource: "hard_rule",
        reason: "explicit_research_mode",
      });
    }
    if (input.explicitMode === "workflow") {
      return route({
        intent: "workflow_create",
        toolStrategy: "workflow",
        confidence: 1,
        resolvedEntities: [],
        missingRequirements: [],
        expectedResultKind: "workflow_draft",
        routeSource: "hard_rule",
        reason: "explicit_workflow_mode",
      });
    }
    if (input.explicitMode === "extract_url" || URL_PATTERN.test(query)) {
      return route({
        intent: "web_search",
        toolStrategy: "web_search",
        action: "extract_url",
        confidence: 1,
        resolvedEntities: [],
        missingRequirements: [],
        expectedResultKind: "research",
        routeSource: "hard_rule",
        reason: "url_extraction",
      });
    }

    if (isCapabilityHelpQuery(query)) {
      return route({
        intent: "normal_answer",
        toolStrategy: "none",
        confidence: 0.98,
        resolvedEntities: [],
        missingRequirements: [],
        expectedResultKind: "capability_guide",
        routeSource: "hard_rule",
        reason: "capability_help_request",
      });
    }

    const contextualEntity = input.selectedItem
      ? {
          provider: input.selectedItem.provider,
          objectType: input.selectedItem.itemType,
          id: input.selectedItem.itemId,
          label: input.selectedItem.title,
          aliases: [],
          confidence: 1,
          source: "selected" as const,
        }
      : activeEntity;

    if (contextualEntity && ANALYSIS_PATTERN.test(query)) {
      const semantic = await new IntentRouterService(this.db).matchExpertCapability({
        userQuery: query,
        selectedAgentId: input.selectedAgentId,
        selectedIntegrationContext:
          contextualEntity.provider === "gmail" || contextualEntity.provider === "hubspot"
            ? {
                provider: contextualEntity.provider,
                itemId: contextualEntity.id,
                itemType: contextualEntity.objectType,
                title: contextualEntity.label,
              }
            : undefined,
        availableCapabilities: input.availableCapabilities,
        workspaceId: input.workspaceId,
        userId: input.userId,
      });
      if (semantic?.expertCapabilityId) {
        return route({
          intent: "expert_capability",
          toolStrategy: "integration_read",
          provider:
            contextualEntity.provider === "gmail" || contextualEntity.provider === "hubspot"
              ? contextualEntity.provider
              : undefined,
          objectType: contextualEntity.objectType,
          expertCapabilityId: semantic.expertCapabilityId,
          resolvedEntities: [contextualEntity],
          confidence: semantic.confidence,
          missingRequirements: [],
          expectedResultKind: "expert",
          routeSource: contextualEntity.source === "selected" ? "selected_context" : "session_context",
          reason: semantic.reason,
        });
      }
    }

    if (contextualEntity && WRITE_PATTERN.test(query)) {
      const provider =
        contextualEntity.provider === "gmail" || contextualEntity.provider === "hubspot"
          ? contextualEntity.provider
          : undefined;
      if (provider) {
        return route({
          intent: "integration_write",
          toolStrategy: "external_action",
          provider,
          objectType: contextualEntity.objectType,
          action: provider === "gmail" ? "draft_reply" : "update",
          resolvedEntities: [contextualEntity],
          confidence: 0.96,
          missingRequirements: [],
          expectedResultKind: "approval",
          routeSource: contextualEntity.source === "selected" ? "selected_context" : "session_context",
          reason: "write_against_resolved_context",
        });
      }
    }

    const explicitlyHubSpot = /\b(hubspot|crm)\b/i.test(query);
    const explicitlyGmail = /\b(gmail|email|inbox|thread)\b/i.test(query);
    const genericCrmRead = /\b(my|our|the|available|open|all)\s+(contacts?|companies|deals?|tasks?|notes?)\b/i.test(query);

    if (isWorkflowRunIntent(query)) {
      return route({
        intent: "workflow_run",
        toolStrategy: "workflow",
        confidence: 0.94,
        resolvedEntities: [],
        missingRequirements: [],
        expectedResultKind: "workflow",
        routeSource: "hard_rule",
        reason: "workflow_run_language",
      });
    }

    if (isWorkflowCreateIntent(query)) {
      return route({
        intent: "workflow_create",
        toolStrategy: "workflow",
        confidence: 0.95,
        resolvedEntities: [],
        missingRequirements: [],
        expectedResultKind: "workflow_draft",
        routeSource: "hard_rule",
        reason: "workflow_language",
      });
    }

    if ((explicitlyHubSpot || (hubspotConnected && genericCrmRead)) && !/\bhow (do|can) i\b/i.test(lower)) {
      const actionInput = extractHubSpotUpdate(query) ?? {};
      const module =
        /\bcompan(?:y|ies)\b/i.test(query) ? "companies"
          : /\bdeals?\b/i.test(query) ? "deals"
            : /\btasks?\b/i.test(query) ? "tasks"
              : /\bnotes?\b/i.test(query) ? "notes"
                : "contacts";
      return route({
        intent: WRITE_PATTERN.test(query) ? "integration_write" : "integration_read",
        toolStrategy: WRITE_PATTERN.test(query) ? "external_action" : "integration_read",
        provider: "hubspot",
        objectType: module,
        action: WRITE_PATTERN.test(query) ? "write" : "read",
        actionInput,
        resolvedEntities: [],
        confidence: explicitlyHubSpot ? 0.98 : 0.86,
        missingRequirements: hubspotConnected ? [] : ["connected_hubspot"],
        ...(!hubspotConnected
          ? { clarificationQuestion: "Connect HubSpot before I access CRM records." }
          : {}),
        expectedResultKind: hubspotConnected
          ? WRITE_PATTERN.test(query) ? "approval" : "integration_records"
          : "clarification",
        routeSource: explicitlyHubSpot ? "hard_rule" : "classifier",
        reason: explicitlyHubSpot ? "explicit_hubspot_intent" : "connected_hubspot_business_query",
      });
    }

    if (explicitlyGmail) {
      return route({
        intent: WRITE_PATTERN.test(query) ? "integration_write" : "integration_read",
        toolStrategy: WRITE_PATTERN.test(query) ? "external_action" : "integration_read",
        provider: "gmail",
        objectType: "threads",
        action: WRITE_PATTERN.test(query) ? "draft_reply" : "read",
        resolvedEntities: [],
        confidence: 0.95,
        missingRequirements: gmailConnected ? [] : ["connected_gmail"],
        ...(!gmailConnected
          ? { clarificationQuestion: "Connect Gmail before I access email." }
          : {}),
        expectedResultKind: gmailConnected
          ? WRITE_PATTERN.test(query) ? "approval" : "integration_records"
          : "clarification",
        routeSource: "hard_rule",
        reason: "explicit_gmail_intent",
      });
    }

    if (/\b(latest|current|recent|recently|today|news|research|search the web|look up|competitors?|market analysis)\b/i.test(query)) {
      return route({
        intent: "web_search",
        toolStrategy: "web_search",
        confidence: 0.9,
        resolvedEntities: [],
        missingRequirements: [],
        expectedResultKind: "research",
        routeSource: "hard_rule",
        reason: "fresh_or_competitive_quick_search_request",
      });
    }

    return this.classifyAmbiguous(input);
  }

  private async classifyAmbiguous(input: CommandRouterV2Input): Promise<RouteDecision> {
    const classifier = createClassifierProvider();
    const sessionEntities = (input.sessionState?.activeEntities ?? [])
      .map((entity) => `${entity.label} [${entity.provider ?? "internal"}:${entity.objectType}:${entity.id}]`)
      .join(", ");
    const prompt =
      `Origin: ${input.originSurface}\n` +
      `Connected capabilities: ${input.availableCapabilities.join(", ") || "none"}\n` +
      `Active session entities: ${sessionEntities || "none"}\n` +
      `Selected agent: ${input.selectedAgentId ?? "none"}\n` +
      `User request: ${input.userQuery}`;

    try {
      const result = await Promise.race([
        classifier.generateStructured({
          schema: classifierOutputSchema,
          maxOutputTokens: 500,
          budgetScope: "routing",
          systemPrompt:
            "Classify one Gideon request. Do not activate Gmail or HubSpot unless explicitly requested, selected by the origin/context, or clearly implied by a connected business-data request. Prefer normal_answer when no external data or action is needed. Use clarification_needed when required targets are ambiguous. Return only the schema.",
          userPrompt: prompt,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ROUTER_TIMEOUT")), 15_000),
        ),
      ]);

      const normalizedResult = demoteAutoDeepResearchIntent(result);

      return route({
        intent: normalizedResult.intent as any,
        toolStrategy: toolStrategy(normalizedResult.intent),
        ...(normalizedResult.provider ? { provider: normalizedResult.provider } : {}),
        ...(normalizedResult.objectType ? { objectType: normalizedResult.objectType } : {}),
        ...(normalizedResult.action ? { action: normalizedResult.action } : {}),
        actionInput: normalizedResult.actionInput,
        ...(normalizedResult.expertCapabilityId ? { expertCapabilityId: normalizedResult.expertCapabilityId } : {}),
        resolvedEntities: [],
        confidence: normalizedResult.confidence,
        missingRequirements: normalizedResult.missingRequirements,
        ...(normalizedResult.clarificationQuestion
          ? { clarificationQuestion: normalizedResult.clarificationQuestion }
          : {}),
        expectedResultKind: expectedResultKind(normalizedResult.intent),
        routeSource: "classifier",
        reason: normalizedResult.reason,
      });
    } catch (error) {
      logger.warn("Route V2 classifier failed; degrading to normal answer", {
        workspaceId: input.workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
      return route({
        intent: "normal_answer",
        toolStrategy: "none",
        resolvedEntities: [],
        confidence: 0.3,
        missingRequirements: [],
        expectedResultKind: "answer",
        routeSource: "fallback",
        reason: "classifier_timeout_or_failure",
      });
    }
  }
}
