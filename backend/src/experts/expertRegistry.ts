import type { ZodTypeAny } from "zod";

import { expertCapabilities } from "./capabilityRegistry.js";
import type {
  ExpertArtifactBehavior,
  ExpertApprovalBehavior,
  ExpertRegistryEntry,
  ExpertTypeId,
} from "./types.js";

function artifactBehavior(
  value: (typeof expertCapabilities)[number]["artifactPolicy"],
): ExpertArtifactBehavior {
  if (value === "suggest_save") return "suggest_save";
  if (value === "save_on_explicit_request") return "save_on_request";
  if (value === "artifact_friendly_report") return "artifact_friendly";
  return "none";
}

function approvalBehavior(
  value: (typeof expertCapabilities)[number]["approvalPolicy"],
): ExpertApprovalBehavior {
  return value === "none" ? "none" : "uses_existing_approval_flows";
}

const entries = expertCapabilities.flatMap((capability) => {
  if (!capability.expertType || capability.lifecycleStatus !== "active") return [];
  const entry: ExpertRegistryEntry = {
    expertType: capability.expertType,
    expertGroup: capability.group as ExpertRegistryEntry["expertGroup"],
    mappedAgents: [
      capability.agentOwner,
      ...(capability.secondaryAgents ?? []),
    ],
    rendererKey: capability.rendererKey as ExpertRegistryEntry["rendererKey"],
    schema: capability.outputSchema as ZodTypeAny,
    triggerExamples: capability.positiveExamples,
    routingHints: [{
      intentKeywords: capability.aliases,
      selectedItemProviders: capability.optionalContext.includes("gmail_thread")
        ? ["gmail", "hubspot"]
        : capability.requiredContext.includes("hubspot_record")
          ? ["hubspot"]
          : undefined,
      prefersModes: ["auto", "search", "research"],
    }],
    requiredContext: capability.requiredContext,
    preferredIntegrations: [
      ...(capability.requiredContext.includes("gmail_thread") ? ["gmail" as const] : []),
      ...(capability.requiredContext.includes("hubspot_record") ? ["hubspot" as const] : []),
    ],
    artifactBehavior: artifactBehavior(capability.artifactPolicy),
    approvalBehavior: approvalBehavior(capability.approvalPolicy),
    canSuggestWorkflow: capability.workflowPolicy !== "none",
  };
  return [[capability.expertType, entry] as const];
});

export const expertRegistry = Object.fromEntries(entries) as Record<
  ExpertTypeId,
  ExpertRegistryEntry
>;

export function getExpertRegistryEntry(expertType: ExpertTypeId) {
  return expertRegistry[expertType];
}
