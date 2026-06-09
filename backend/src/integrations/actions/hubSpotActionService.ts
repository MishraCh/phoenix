import type { Firestore } from "firebase-admin/firestore";

import type { RouteDecision } from "../../ai/contracts/commandContracts.js";
import type { SessionStateSnapshot } from "../../ai/contracts/sessionState.js";
import type { ExpertSelectedItem } from "../../experts/types.js";
import type { CurrentWorkspace } from "../../services/currentWorkspaceService.js";
import { ApiError } from "../../utils/apiError.js";
import {
  IntegrationWorkspaceService,
  type HubSpotModule,
} from "../integrationWorkspaceService.js";
import { extractHubSpotUpdate } from "./hubSpotNlpUtils.js";

type WritableHubSpotModule = "contacts" | "companies" | "deals";

export type HubSpotActionCandidate = {
  id: string;
  label: string;
  description?: string;
};

export type HubSpotActionPreparation =
  | {
      status: "ready";
      approvalId: string;
      label: string;
      actionType:
        | "hubspot_update"
        | "hubspot_create"
        | "hubspot_note_create"
        | "hubspot_task_create"
        | "hubspot_task_update"
        | "hubspot_association_update";
      resolvedEntity?: {
        provider: "hubspot";
        objectType: string;
        id: string;
        label: string;
        aliases: string[];
        confidence: number;
        source: "selected" | "session" | "query" | "tool";
      };
    }
  | {
      status: "multiple_matches";
      message: string;
      query: string;
      module: HubSpotModule;
      candidates: HubSpotActionCandidate[];
    }
  | {
      status: "not_found" | "missing_fields" | "unsupported" | "unavailable";
      message: string;
    };

const moduleAliases: Record<string, HubSpotModule> = {
  contact: "contacts",
  contacts: "contacts",
  company: "companies",
  companies: "companies",
  deal: "deals",
  deals: "deals",
  note: "notes",
  notes: "notes",
  task: "tasks",
  tasks: "tasks",
};

// extractHubSpotUpdate is imported from hubSpotNlpUtils.ts

export function normalizeHubSpotModule(value: unknown): HubSpotModule | null {
  return typeof value === "string" ? moduleAliases[value.trim().toLowerCase()] ?? null : null;
}

function cleanTargetQuery(value: string) {
  return value
    .replace(/\b(?:in|from|on)\s+(?:hubspot|the crm|crm)\b.*$/i, "")
    .replace(/^(?:the\s+)?(?:contact|company|deal|task)\s+/i, "")
    .trim();
}

function inferTargetQuery(userInput: string, route: RouteDecision) {
  const fromRoute = route.actionInput["targetQuery"];
  if (typeof fromRoute === "string" && fromRoute.trim()) return cleanTargetQuery(fromRoute);
  const update = extractHubSpotUpdate(userInput);
  if (update?.targetQuery) return cleanTargetQuery(update.targetQuery);
  return "";
}

function inferUpdates(userInput: string, route: RouteDecision) {
  const fromRoute = route.actionInput["updates"];
  if (fromRoute && typeof fromRoute === "object" && !Array.isArray(fromRoute)) {
    return fromRoute as Record<string, unknown>;
  }
  return extractHubSpotUpdate(userInput)?.updates ?? {};
}

function selectedTarget(
  selectedItem: ExpertSelectedItem | null,
  route: RouteDecision,
  sessionState: SessionStateSnapshot | null,
) {
  if (selectedItem?.provider === "hubspot") {
    return {
      module: normalizeHubSpotModule(selectedItem.itemType),
      recordId: selectedItem.itemId,
      label: selectedItem.title,
      source: "selected" as const,
    };
  }
  const resolved = route.resolvedEntities.find((entity) => entity.provider === "hubspot");
  if (resolved) {
    return {
      module: normalizeHubSpotModule(resolved.objectType),
      recordId: resolved.id,
      label: resolved.label,
      source: resolved.source,
    };
  }
  const active = sessionState?.activeEntities.find((entity) => entity.provider === "hubspot");
  if (active && /\b(this|that|it|they|them|their)\b/i.test(route.reason)) {
    return {
      module: normalizeHubSpotModule(active.objectType),
      recordId: active.id,
      label: active.label,
      source: "session" as const,
    };
  }
  return null;
}

export class HubSpotActionService {
  private readonly workspaceService: IntegrationWorkspaceService;

  constructor(db: Firestore) {
    this.workspaceService = new IntegrationWorkspaceService(db);
  }

  async prepare(input: {
    currentWorkspace: CurrentWorkspace;
    userId: string;
    userInput: string;
    route: RouteDecision;
    selectedItem: ExpertSelectedItem | null;
    sessionState: SessionStateSnapshot | null;
  }): Promise<HubSpotActionPreparation> {
    if (/\b(delete|archive|purge)\b/i.test(input.userInput)) {
      return {
        status: "unsupported",
        message: "HubSpot record deletion is not supported in Gideon yet.",
      };
    }

    const action = input.route.action ?? "update";
    const module =
      normalizeHubSpotModule(input.route.objectType) ??
      normalizeHubSpotModule(input.route.actionInput["module"]) ??
      "contacts";

    if (action === "create") {
      const properties = input.route.actionInput["properties"];
      if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
        return {
          status: "missing_fields",
          message: "Tell me the fields for the new HubSpot record before I prepare approval.",
        };
      }
      return this.prepareCreate(input, module, properties as Record<string, unknown>);
    }

    const target = selectedTarget(input.selectedItem, input.route, input.sessionState);
    const targetQuery = inferTargetQuery(input.userInput, input.route);
    const resolution = target?.recordId && target.module
      ? {
          status: "resolved_single" as const,
          module: target.module,
          query: target.label,
          record: {
            id: target.recordId,
            title: target.label,
            subtitle: "",
            properties: {},
            updatedAt: null,
          },
        }
      : targetQuery
        ? await this.workspaceService.resolveHubSpotRecord(
            input.currentWorkspace,
            input.userId,
            { module, query: targetQuery, maxResults: 8 },
          )
        : null;

    if (!resolution) {
      return {
        status: "missing_fields",
        message: "Select a HubSpot record or name the exact record you want to change.",
      };
    }
    if (resolution.status === "multiple_matches") {
      return {
        status: "multiple_matches",
        query: resolution.query,
        module: resolution.module,
        message: `I found multiple HubSpot ${resolution.module} matching "${resolution.query}". Choose one before I prepare the change.`,
        candidates: resolution.records.map((record) => ({
          id: record.id,
          label: record.title,
          ...(record.subtitle ? { description: record.subtitle } : {}),
        })),
      };
    }
    if (resolution.status === "not_found") {
      return {
        status: "not_found",
        message: `I couldn't find a HubSpot ${module.slice(0, -1)} matching "${resolution.query}".`,
      };
    }

    const record = resolution.record;
    const writableModule = resolution.module === "contacts" ||
      resolution.module === "companies" ||
      resolution.module === "deals"
      ? resolution.module
      : null;
    const entity = {
      provider: "hubspot" as const,
      objectType: resolution.module,
      id: record.id,
      label: record.title,
      aliases: [resolution.query].filter(Boolean),
      confidence: 1,
      source: target?.source ?? "tool" as const,
    };

    try {
      if (action === "note" || /\b(add|create)\s+(?:a\s+)?note\b/i.test(input.userInput)) {
        if (!writableModule) return this.unsupportedTarget("note", resolution.module);
        const body = String(input.route.actionInput["body"] ?? "").trim();
        if (!body) {
          return { status: "missing_fields", message: "Tell me what the HubSpot note should say." };
        }
        const result = await this.workspaceService.prepareHubSpotNoteApproval(
          input.currentWorkspace,
          input.userId,
          { module: writableModule, recordId: record.id, body },
        );
        return {
          status: "ready",
          approvalId: result.approvalId,
          label: `Add HubSpot note to ${record.title}`,
          actionType: "hubspot_note_create",
          resolvedEntity: entity,
        };
      }

      if (action === "task_create" || /\b(create|add|schedule)\s+(?:a\s+)?(?:follow[- ]?up\s+)?task\b/i.test(input.userInput)) {
        if (!writableModule) return this.unsupportedTarget("task", resolution.module);
        const subject = String(
          input.route.actionInput["subject"] ??
          input.route.actionInput["title"] ??
          `Follow up with ${record.title}`,
        ).trim();
        const result = await this.workspaceService.prepareHubSpotTaskCreateApproval(
          input.currentWorkspace,
          input.userId,
          {
            module: writableModule,
            recordId: record.id,
            subject,
            ...(typeof input.route.actionInput["body"] === "string"
              ? { body: input.route.actionInput["body"] }
              : {}),
            ...(typeof input.route.actionInput["dueAt"] === "string"
              ? { dueAt: input.route.actionInput["dueAt"] }
              : {}),
          },
        );
        return {
          status: "ready",
          approvalId: result.approvalId,
          label: `Create HubSpot task for ${record.title}`,
          actionType: "hubspot_task_create",
          resolvedEntity: entity,
        };
      }

      const updates = inferUpdates(input.userInput, input.route);
      if (!writableModule || !Object.keys(updates).length) {
        return {
          status: "missing_fields",
          message: "Tell me exactly which HubSpot field and value you want to update.",
        };
      }
      const result = await this.workspaceService.prepareHubSpotUpdateApproval(
        input.currentWorkspace,
        input.userId,
        {
          module: writableModule,
          recordId: record.id,
          updates,
          title: `Update ${record.title}`,
        },
      );
      return {
        status: "ready",
        approvalId: result.approvalId,
        label: `Update ${record.title}`,
        actionType: "hubspot_update",
        resolvedEntity: entity,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        return { status: "unavailable", message: error.message };
      }
      throw error;
    }
  }

  private async prepareCreate(
    input: {
      currentWorkspace: CurrentWorkspace;
      userId: string;
    },
    module: HubSpotModule,
    properties: Record<string, unknown>,
  ): Promise<HubSpotActionPreparation> {
    if (module !== "contacts" && module !== "companies" && module !== "deals") {
      return this.unsupportedTarget("record creation", module);
    }
    try {
      const result = await this.workspaceService.prepareHubSpotCreateApproval(
        input.currentWorkspace,
        input.userId,
        { module, properties },
      );
      return {
        status: "ready",
        approvalId: result.approvalId,
        label: `Create HubSpot ${module.slice(0, -1)}`,
        actionType: "hubspot_create",
      };
    } catch (error) {
      if (error instanceof ApiError) {
        return { status: "unavailable", message: error.message };
      }
      throw error;
    }
  }

  private unsupportedTarget(action: string, module: HubSpotModule): HubSpotActionPreparation {
    return {
      status: "unsupported",
      message: `HubSpot ${action} is not supported for ${module} in this flow.`,
    };
  }
}
