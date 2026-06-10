import type { Firestore } from "firebase-admin/firestore";

import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { ApiError } from "../utils/apiError.js";
import { IntegrationService } from "../integrations/integrationService.js";
import {
  getCachedCapabilities,
  setCachedCapabilities,
  invalidateCachedCapabilities,
} from "../cache/requestStateCache.js";
import { getToolDefinition, toolDefinitions, type ToolExecutionContext } from "./toolRegistry.js";

const builtinCapabilities = [
  "context.read",
  "web.researchTask",
  "web.extractUrl",
  "web.extractStructured",
  "web.monitorCheck",
  "web.findSimilar",
  "web.deepResearch",
  "leads.buildDataset",
  "crm.enrichEntity",
];

const usableIntegrationStatuses = new Set(["connected", "syncing"]);

const capabilitySetupHints: Record<
  string,
  {
    requiredIntegration?: string;
    setupHint: string;
  }
> = {
  "email.read": {
    requiredIntegration: "gmail",
    setupHint: "Connect Gmail to unlock email read access.",
  },
  "email.draft": {
    requiredIntegration: "gmail",
    setupHint: "Connect Gmail to unlock email draft access.",
  },
  "email.send": {
    requiredIntegration: "gmail",
    setupHint: "Connect Gmail to unlock approval-gated email sending.",
  },
  "calendar.read": {
    requiredIntegration: "gmail",
    setupHint: "Connect Gmail/Google Workspace to unlock Google Calendar context.",
  },
  "crm.read": {
    requiredIntegration: "hubspot",
    setupHint: "Connect HubSpot to unlock CRM read capabilities.",
  },
  "crm.write": {
    requiredIntegration: "hubspot",
    setupHint: "Connect HubSpot to unlock approval-gated CRM write capabilities.",
  },
};

export class ToolRegistryService {
  private readonly integrationService: IntegrationService;

  constructor(private readonly db: Firestore) {
    this.integrationService = new IntegrationService(db);
  }

  async listCapabilities(currentWorkspace: CurrentWorkspace) {
    const cached = getCachedCapabilities(currentWorkspace.id);
    if (cached) return cached;

    const integrations = await this.integrationService.listIntegrations(currentWorkspace);
    const derived = integrations.flatMap((integration) =>
      usableIntegrationStatuses.has(integration.status) ? integration.capabilities : [],
    );

    const capabilities = Array.from(new Set([...builtinCapabilities, ...derived])).sort();
    setCachedCapabilities(currentWorkspace.id, capabilities);
    return capabilities;
  }

  invalidateCapabilities(workspaceId: string) {
    invalidateCachedCapabilities(workspaceId);
  }

  async listTools(currentWorkspace: CurrentWorkspace, allowedToolNames?: string[]) {
    const capabilities = await this.listCapabilities(currentWorkspace);
    return this.listToolsFromCapabilities(capabilities, allowedToolNames);
  }

  listToolsFromCapabilities(capabilities: string[], allowedToolNames?: string[]) {
    return toolDefinitions
      .filter((toolDefinition) => toolDefinition.exposedToPlanner !== false)
      .filter((toolDefinition) =>
        allowedToolNames?.length ? allowedToolNames.includes(toolDefinition.name) : true,
      )
      .map((toolDefinition) => ({
        ...toolDefinition,
        available: toolDefinition.capabilitiesRequired.every((capability) =>
          capabilities.includes(capability),
        ),
      }));
  }

  async getMissingCapabilities(currentWorkspace: CurrentWorkspace, requiredCapabilities: string[]) {
    const capabilities = await this.listCapabilities(currentWorkspace);
    return this.getMissingCapabilitiesFromCapabilities(capabilities, requiredCapabilities);
  }

  getMissingCapabilitiesFromCapabilities(capabilities: string[], requiredCapabilities: string[]) {
    return requiredCapabilities
      .filter((capability) => !capabilities.includes(capability))
      .map((capability) => ({
        capability,
        requiredIntegration: capabilitySetupHints[capability]?.requiredIntegration ?? null,
        setupHint:
          capabilitySetupHints[capability]?.setupHint ??
          "Complete the required integration or workspace setup before retrying.",
      }));
  }

  async assertCapabilities(currentWorkspace: CurrentWorkspace, requiredCapabilities: string[]) {
    const missing = await this.getMissingCapabilities(currentWorkspace, requiredCapabilities);

    if (missing.length) {
      const [firstMissing] = missing;
      throw new ApiError({
        code: "CAPABILITY_MISSING",
        message: `${firstMissing.capability} is unavailable. ${firstMissing.setupHint}`,
        status: 409,
        details: { missingCapabilities: missing },
      });
    }
  }

  async buildToolSet(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    allowedToolNames?: string[],
    sourceRefs?: ToolExecutionContext["sourceRefs"],
  ) {
    const availableTools = await this.listTools(currentWorkspace, allowedToolNames);
    return this.buildToolSetFromDefinitions(currentWorkspace, userId, availableTools, sourceRefs);
  }

  buildToolSetFromCapabilities(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    capabilities: string[],
    allowedToolNames?: string[],
    sourceRefs?: ToolExecutionContext["sourceRefs"],
    request?: ToolExecutionContext["request"],
    contextPacket?: ToolExecutionContext["contextPacket"],
  ) {
    const availableTools = this.listToolsFromCapabilities(capabilities, allowedToolNames);
    return this.buildToolSetFromDefinitions(currentWorkspace, userId, availableTools, sourceRefs, request, contextPacket);
  }

  private buildToolSetFromDefinitions(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    availableTools: Array<(typeof toolDefinitions)[number] & { available: boolean }>,
    sourceRefs?: ToolExecutionContext["sourceRefs"],
    request?: ToolExecutionContext["request"],
    contextPacket?: ToolExecutionContext["contextPacket"],
  ) {
    return availableTools
      .filter((toolDefinition) => toolDefinition.available)
      .map((toolDefinition) =>
        toolDefinition.buildTool({
          db: this.db,
          currentWorkspace,
          userId,
          sourceRefs,
          contextPacket,
          request,
        }),
      );
  }

  requireTool(name: string) {
    return getToolDefinition(name);
  }
}
