import type { Firestore } from "firebase-admin/firestore";

import { IntegrationService } from "../../integrations/integrationService.js";
import { logger } from "../../observability/logger.js";
import type { CurrentWorkspace } from "../../services/currentWorkspaceService.js";

const PROVIDER_CAPABILITIES: Record<string, string> = {
  gmail: "search and read email threads; draft sends and replies through approval",
  google: "Gmail and connected Google workspace reads",
  hubspot: "bounded CRM reads across contacts, companies, deals, notes, and tasks; approval-gated writes",
};

/**
 * Compact capability manifest.
 *
 * Dynamic workspace data belongs in ContextSnapshot. This manifest only tells
 * the model who Gideon is, which providers are connected, and the invariants it
 * must never violate.
 */
export class GideonManifestService {
  private readonly integrationService: IntegrationService;

  constructor(db: Firestore) {
    this.integrationService = new IntegrationService(db);
  }

  async buildManifest(currentWorkspace: CurrentWorkspace): Promise<string> {
    const integrations = await this.integrationService.listIntegrations(currentWorkspace);
    const connected = integrations.filter(
      (integration) => integration.status === "connected" || integration.status === "syncing",
    );
    const unavailable = integrations.filter(
      (integration) =>
        integration.status === "expired" ||
        integration.status === "reconnect_needed" ||
        integration.status === "error",
    );

    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const lines = [
      "=== GIDEON CAPABILITY MANIFEST ===",
      "You are Gideon, a warm, direct AI Chief of Staff for founders and operators.",
      `Today's date is ${today}. Never assume an earlier year; treat retrieved web results as current as of today.`,
      "All research and analysis is Gideon's own work — never attribute capabilities to internal providers or models; cite the actual web sources instead.",
      "Be concise, honest about missing evidence, and prefer grounded structured results over generic claims.",
      "",
      "CORE CAPABILITIES:",
      "- Answer, analyze, draft, research public sources, summarize selected workspace context, and design workflows.",
      "- Save responses only when the user explicitly asks.",
      "- External writes are always staged as approvals and never executed from chat directly.",
      "",
      connected.length
        ? `CONNECTED INTEGRATIONS:\n${connected
            .map(
              (integration) =>
                `- ${integration.provider}: ${PROVIDER_CAPABILITIES[integration.provider] ?? (integration.capabilities.join(", ") || "connected capabilities")}`,
            )
            .join("\n")}`
        : "CONNECTED INTEGRATIONS: none",
      ...(unavailable.length
        ? [
            "",
            `UNAVAILABLE INTEGRATIONS: ${unavailable
              .map((integration) => `${integration.provider} (${integration.status})`)
              .join(", ")}`,
          ]
        : []),
      "",
      "SAFETY AND GROUNDING:",
      "- Never invent CRM records, email threads, source URLs, tool results, or action completion.",
      "- Use only integrations listed as connected above.",
      "- If required evidence is unavailable, return a clarification, not an authoritative answer.",
      "- Gmail sends and HubSpot writes require a created approval and explicit user approval.",
      "- Public web research must preserve source references and disclose partial or stale evidence.",
      "=== END MANIFEST ===",
    ];

    const manifest = lines.join("\n");
    logger.debug("Compact Gideon manifest built", {
      workspaceId: currentWorkspace.id,
      charCount: manifest.length,
      connectedCount: connected.length,
    });
    return manifest;
  }
}
