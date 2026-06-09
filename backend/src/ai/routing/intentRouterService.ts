/**
 * IntentRouterService — Shadow Mode
 *
 * Implements the new semantic intent router from §6 of the migration plan.
 *
 * SHADOW MODE: This router runs alongside the existing command graph routing
 * but does NOT change any execution paths. It logs what it would have decided
 * vs what the live system decided. The comparison drives the Phase 2 cutover.
 *
 * Routing layer order (§6.4):
 *   1. Hard safety/provider guards
 *   2. Active surface + selected context
 *   3. Deterministic slash mode
 *   4. Lightweight intent classifier
 *   5. Semantic expert capability matching (via EmbeddingIndexService)
 *   6. Clarification / normal-answer fallback
 */

import type { Firestore } from "firebase-admin/firestore";

import { EmbeddingIndexService } from "../indexing/embeddingIndexService.js";
import { logger } from "../../observability/logger.js";

// ---------------------------------------------------------------------------
// Types (§6.2–6.3)
// ---------------------------------------------------------------------------

export type IntentRouterInput = {
  userQuery: string;
  originSurface?: "command_center" | "gmail_workspace" | "hubspot_workspace" | "workflow" | "library";
  selectedSurface?: "command_center" | "gmail" | "hubspot" | "workflow" | "library";
  selectedIntegrationContext?: {
    provider: "gmail" | "hubspot";
    itemId: string;
    itemType: string;
    title?: string;
    freshness?: "fresh" | "stale" | "unknown";
  };
  selectedAgentId?: string | null;
  resolvedMode?: string; // current live mode for shadow comparison
  availableCapabilities: string[];
  workspaceId: string;
  userId?: string;
};

export type RouteIntent =
  | "normal_answer"
  | "expert_tool"
  | "integration_read"
  | "integration_write"
  | "workflow_create"
  | "workflow_run"
  | "artifact_query"
  | "memory_query"
  | "research"
  | "email_action"
  | "crm_action"
  | "clarification_needed";

export type RouteEnvelope = {
  routeId: string;
  intent: RouteIntent;
  provider?: "gmail" | "hubspot";
  objectType?: string;
  action?: string;
  expertCapabilityId?: string;
  routeSource: "hard_rule" | "selected_context" | "classifier" | "semantic_match" | "fallback";
  dataAccessScope?: "workspace" | "user" | "none";
  needsApproval?: boolean;
  confidence: number;
  requiredContext?: string[];
  clarification?: string;
  reason: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Hard guard: contract / safety keywords that must never be misrouted.
 */
function applyHardGuards(text: string): RouteEnvelope | null {
  if (!text.trim()) {
    return {
      routeId: crypto.randomUUID(),
      intent: "normal_answer",
      routeSource: "hard_rule",
      confidence: 1.0,
      reason: "empty_query",
    };
  }
  return null;
}

/**
 * Deterministic slash-mode routing.
 */
function applySlashModeRouting(resolvedMode?: string): RouteEnvelope | null {
  if (!resolvedMode) return null;

  const modeMap: Record<string, RouteIntent> = {
    search: "research",
    research: "research",
    extract_url: "research",
    workflow: "workflow_create",
  };

  const intent = modeMap[resolvedMode];
  if (intent) {
    return {
      routeId: crypto.randomUUID(),
      intent,
      routeSource: "hard_rule",
      confidence: 1.0,
      reason: `slash_mode:${resolvedMode}`,
    };
  }
  return null;
}

/**
 * Selected-context routing: if a HubSpot or Gmail item is selected, bias
 * toward CRM or email intent.
 */
function applySelectedContextRouting(
  input: IntentRouterInput,
  text: string,
): RouteEnvelope | null {
  const ctx = input.selectedIntegrationContext;
  if (!ctx) return null;

  if (ctx.provider === "hubspot") {
    // Write-style verbs → crm_action
    if (
      hasAny(text, [
        /\bupdate\b/,
        /\bchange\b/,
        /\bedit\b/,
        /\bset\b/,
        /\badd note\b/,
        /\bcreate task\b/,
      ])
    ) {
      return {
        routeId: crypto.randomUUID(),
        intent: "crm_action",
        provider: "hubspot",
        action: "write",
        routeSource: "selected_context",
        dataAccessScope: "workspace",
        needsApproval: true,
        confidence: 0.9,
        reason: "selected_hubspot_write_verb",
      };
    }

    // Read/analysis → integration_read (let expert matching decide further)
    return {
      routeId: crypto.randomUUID(),
      intent: "integration_read",
      provider: "hubspot",
      objectType: ctx.itemType,
      routeSource: "selected_context",
      dataAccessScope: "workspace",
      confidence: 0.85,
      reason: "selected_hubspot_item",
    };
  }

  if (ctx.provider === "gmail") {
    if (hasAny(text, [/\breply\b/, /\bdraft\b/, /\bsend\b/, /\bfollow.?up\b/])) {
      return {
        routeId: crypto.randomUUID(),
        intent: "email_action",
        provider: "gmail",
        action: "draft_reply",
        routeSource: "selected_context",
        dataAccessScope: "user",
        needsApproval: true,
        confidence: 0.9,
        reason: "selected_gmail_reply_verb",
      };
    }

    return {
      routeId: crypto.randomUUID(),
      intent: "integration_read",
      provider: "gmail",
      objectType: ctx.itemType,
      routeSource: "selected_context",
      dataAccessScope: "user",
      confidence: 0.85,
      reason: "selected_gmail_item",
    };
  }

  return null;
}



/**
 * Semantic expert capability matching via EmbeddingIndexService.
 * Returns the best matching capability if above confidence threshold.
 */
async function applySemanticExpertMatching(
  db: Firestore,
  input: IntentRouterInput,
  text: string,
): Promise<RouteEnvelope | null> {
  try {
    const indexService = new EmbeddingIndexService(db);
    const results = await indexService.search({
      workspaceId: input.workspaceId,
      userId: input.userId,
      query: text,
      topK: 3,
      sourceTypes: ["expert_tool_sop"],
    });

    if (results.length === 0) return null;

    const best = results[0];
    const capability = best.source.metadata as {
      capabilityId?: string;
      agentOwner?: string;
      minimumConfidence?: number;
      requiredContext?: string[];
      lifecycleStatus?: string;
    };

    const minimumConfidence = capability.minimumConfidence ?? 0.72;

    // Only match active capabilities (shadow ones log but don't route)
    if (capability.lifecycleStatus !== "active") return null;

    if (best.score < minimumConfidence) {
      logger.debug("IntentRouter: semantic match below threshold", {
        workspaceId: input.workspaceId,
        capabilityId: capability.capabilityId,
        score: best.score,
        threshold: minimumConfidence,
      });
      return null;
    }

    // Agent ownership check
    if (
      input.selectedAgentId &&
      capability.agentOwner &&
      capability.agentOwner !== input.selectedAgentId
    ) {
      return null;
    }

    return {
      routeId: crypto.randomUUID(),
      intent: "expert_tool",
      expertCapabilityId: capability.capabilityId,
      routeSource: "semantic_match",
      confidence: best.score,
      requiredContext: capability.requiredContext as string[],
      reason: `semantic_match:${capability.capabilityId}:score=${best.score.toFixed(3)}`,
    };
  } catch (err) {
    logger.debug("IntentRouter: semantic matching failed", {
      workspaceId: input.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

export class IntentRouterService {
  constructor(private readonly db: Firestore) {}

  /**
   * Phase 3: Exposes semantic capability matching directly for the command graph 
   * to replace the legacy keyword-based routeExpertQuery.
   */
  async matchExpertCapability(input: IntentRouterInput): Promise<RouteEnvelope | null> {
    const text = normalize(input.userQuery);
    return applySemanticExpertMatching(this.db, input, text);
  }

  /**
   * Route a user query through all routing layers.
   * Returns a RouteEnvelope with intent, confidence, and reason.
   */
  async route(input: IntentRouterInput): Promise<RouteEnvelope> {
    const text = normalize(input.userQuery);

    // Layer 1: Hard guards
    const hardGuard = applyHardGuards(text);
    if (hardGuard) return hardGuard;

    // Layer 2: Slash mode
    const slashRoute = applySlashModeRouting(input.resolvedMode);
    if (slashRoute) return slashRoute;

    // Layer 3: Selected context
    const contextRoute = applySelectedContextRouting(input, text);
    if (contextRoute) return contextRoute;



    // Layer 5: Semantic expert matching (async)
    const semanticRoute = await applySemanticExpertMatching(this.db, input, text);
    if (semanticRoute) return semanticRoute;

    // Layer 6: Fallback — normal answer
    return {
      routeId: crypto.randomUUID(),
      intent: "normal_answer",
      routeSource: "fallback",
      confidence: 0.5,
      reason: "no_specific_route_matched",
    };
  }

  /**
   * Shadow mode: run the new router and log the comparison against the live
   * resolved mode. Does NOT affect execution.
   */
  async runShadow(
    input: IntentRouterInput,
    liveResolvedMode: string,
    liveExpertType?: string,
  ): Promise<void> {
    try {
      const shadowRoute = await this.route(input);

      logger.info("IntentRouter [shadow]", {
        workspaceId: input.workspaceId,
        liveMode: liveResolvedMode,
        liveExpertType: liveExpertType ?? "none",
        shadowIntent: shadowRoute.intent,
        shadowExpertCapabilityId: shadowRoute.expertCapabilityId ?? "none",
        shadowConfidence: shadowRoute.confidence,
        shadowRouteSource: shadowRoute.routeSource,
        shadowReason: shadowRoute.reason,
        modeMatch: shadowRoute.intent === "research" && liveResolvedMode === "research",
      });
    } catch (err) {
      logger.debug("IntentRouter [shadow] failed silently", {
        workspaceId: input.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
