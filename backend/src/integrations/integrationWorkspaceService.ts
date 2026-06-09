import { createHash } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import { ApprovalService } from "../approvals/approvalService.js";
import { ArtifactService } from "../artifacts/artifactService.js";
import { createLlmProvider } from "../ai/providers/providerRegistry.js";
import { ContextService } from "../context/contextService.js";
import { IntegrationItemRepository } from "../repositories/integrationItemRepository.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { WorkflowService } from "../workflows/workflowService.js";
import { ApiError } from "../utils/apiError.js";
import { logger } from "../observability/logger.js";
import { buildIntegrationContextBlock, buildIntegrationSourceRef, buildSelectedItemContext } from "./context/integrationContextAdapter.js";
import type { IntegrationItem, IntegrationProviderId, SourceRef } from "../schemas/coreSchemas.js";
import { IntegrationService } from "./integrationService.js";
import { GmailProvider, type GmailThreadDetail } from "./providers/gmail/gmailProvider.js";
import { GmailStyleProfileService } from "./providers/gmail/gmailStyleProfileService.js";
import {
  HubSpotProvider,
  type HubSpotObjectType,
  type HubSpotRecordSummary,
  type HubSpotRelatedRecord,
} from "./providers/hubspot/hubspotProvider.js";

const MAX_REASONABLE_FUTURE_MS = 1000 * 60 * 60 * 24 * 30;

const threadSummarySchema = z.object({
  summary: z.string().min(1),
  keyPoints: z.array(z.string()).default([]),
  suggestedReplyFocus: z.array(z.string()).default([]),
});

const actionItemsSchema = z.object({
  summary: z.string().min(1),
  actionItems: z.array(
    z.object({
      owner: z.string().min(1),
      task: z.string().min(1),
      dueHint: z.string().optional(),
    }),
  ).default([]),
});

const draftReplySchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  rationale: z.string().min(1),
});

const recordSummarySchema = z.object({
  summary: z.string().min(1),
  keyPoints: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
});

const followUpDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  rationale: z.string().min(1),
});

type GmailComposeInput = {
  threadId?: string;
  to: string[];
  cc?: string[];
  subject?: string;
  body?: string;
  tone?: string;
};

export type HubSpotModule = HubSpotObjectType;

export type HubSpotRecordResolution =
  | {
      status: "resolved_single";
      module: HubSpotModule;
      query: string;
      record: HubSpotRecordSummary;
    }
  | {
      status: "multiple_matches";
      module: HubSpotModule;
      query: string;
      records: HubSpotRecordSummary[];
    }
  | {
      status: "not_found";
      module: HubSpotModule;
      query: string;
    };

function createIdempotencyKey(prefix: string, payload: Record<string, unknown>) {
  return createHash("sha256").update(`${prefix}:${JSON.stringify(payload)}`).digest("hex");
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function sanitizeIntegrationTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > Date.now() + MAX_REASONABLE_FUTURE_MS) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function sanitizeCachedGmailThread(thread: GmailThreadDetail): GmailThreadDetail {
  return {
    ...thread,
    messages: thread.messages.map((message) => ({
      ...message,
      sentAt: sanitizeIntegrationTimestamp(message.sentAt),
    })),
  };
}

function toSourceRefs(provider: IntegrationProviderId, itemId: string, title: string, url?: string | null) {
  return [buildIntegrationSourceRef({ provider, sourceId: itemId, title, url: url ?? undefined })];
}

function threadToPrompt(thread: GmailThreadDetail) {
  return [
    `Thread subject: ${thread.subject}`,
    `Participants: ${thread.participants.join(", ") || "Unknown"}`,
    "",
    ...thread.messages.map((message, index) =>
      [
        `Message ${index + 1}`,
        `From: ${message.from}`,
        `To: ${message.to.join(", ") || "Unknown"}`,
        `Subject: ${message.subject}`,
        `Sent: ${message.sentAt ?? "Unknown"}`,
        `Snippet: ${message.snippet}`,
        `Body: ${message.bodyText || "[No plain-text body available]"}`,
      ].join("\n"),
    ),
  ].join("\n\n");
}

function recordToPrompt(record: { id: string; properties?: Record<string, unknown>; updatedAt?: string; createdAt?: string }) {
  return [
    `Record ID: ${record.id}`,
    `Updated at: ${record.updatedAt ?? "Unknown"}`,
    `Created at: ${record.createdAt ?? "Unknown"}`,
    "Properties:",
    compactJson(record.properties ?? {}),
  ].join("\n");
}

function hubspotSourceType(module: HubSpotModule) {
  return module === "contacts"
    ? "crm_contact" as const
    : module === "companies"
      ? "crm_company" as const
      : module === "deals"
        ? "crm_deal" as const
        : module === "notes"
          ? "crm_note" as const
          : "crm_task" as const;
}

function hubspotRecordTitle(module: HubSpotModule, properties?: Record<string, string | null | undefined>) {
  return module === "contacts"
    ? `${properties?.["firstname"] ?? ""} ${properties?.["lastname"] ?? ""}`.trim() ||
        String(properties?.["email"] ?? "Untitled contact")
    : module === "companies"
      ? String(properties?.["name"] ?? properties?.["domain"] ?? "Untitled company")
      : module === "deals"
        ? String(properties?.["dealname"] ?? "Untitled deal")
        : module === "notes"
          ? String(properties?.["hs_note_body"] ?? "Untitled note").slice(0, 80)
          : String(properties?.["hs_task_subject"] ?? properties?.["hs_task_body"] ?? "Untitled task");
}

function hubspotContextSummary(module: HubSpotModule, properties?: Record<string, string | null | undefined>) {
  return module === "contacts"
    ? [properties?.["email"], properties?.["jobtitle"], properties?.["lifecyclestage"]].filter(Boolean).join(" • ")
    : module === "companies"
      ? [properties?.["industry"], properties?.["domain"], properties?.["country"]].filter(Boolean).join(" • ")
      : module === "deals"
        ? [properties?.["dealstage"], properties?.["amount"], properties?.["pipeline"]].filter(Boolean).join(" • ")
        : module === "notes"
          ? [properties?.["hs_timestamp"]].filter(Boolean).join(" • ")
          : [properties?.["hs_task_status"], properties?.["hs_task_priority"], properties?.["hs_timestamp"]].filter(Boolean).join(" • ");
}

function formatRelatedRecords(title: string, records: HubSpotRelatedRecord[]) {
  if (!records.length) {
    return "";
  }

  return [
    title,
    ...records.map((record) => `- ${record.title}${record.subtitle ? ` — ${record.subtitle}` : ""}`),
  ].join("\n");
}

function buildWorkflowStepsForIntegration(task: string, provider: string, targetId: string, targetType: string) {
  return [
    {
      id: "integration_read",
      type: "integration.read" as const,
      name: `Read ${provider} context`,
      order: 0,
      config: {
        provider,
        targetType,
        targetId,
        operation: "selected_item",
      },
    },
    {
      id: "agent_follow_up",
      type: "agent" as const,
      name: "Prepare follow-up output",
      order: 1,
      config: { agentId: "executive", task },
    },
    {
      id: "approval_gate",
      type: "approval" as const,
      name: "Require approval before external write",
      order: 2,
      config: { policy: "external_only", actionType: `${provider}_follow_up` },
    },
    {
      id: "library_save",
      type: "artifact" as const,
      name: "Save output to Library",
      order: 3,
      config: { artifactType: "draft", contentSource: "previous_step" },
    },
  ];
}

function isGmailThreadDetail(value: unknown): value is GmailThreadDetail {
  return Boolean(
    value &&
      typeof value === "object" &&
      "threadId" in value &&
      "messages" in value &&
      Array.isArray((value as { messages?: unknown[] }).messages),
  );
}

export class IntegrationWorkspaceService {
  private readonly integrationService: IntegrationService;
  private readonly contextService: ContextService;
  private readonly itemRepository: IntegrationItemRepository;
  private readonly artifactService: ArtifactService;
  private readonly approvalService: ApprovalService;
  private readonly workflowService: WorkflowService;
  private readonly gmailStyleProfileService: GmailStyleProfileService;

  constructor(private readonly db: Firestore) {
    this.integrationService = new IntegrationService(db);
    this.contextService = new ContextService(db);
    this.itemRepository = new IntegrationItemRepository(db);
    this.artifactService = new ArtifactService(db);
    this.approvalService = new ApprovalService(db);
    this.workflowService = new WorkflowService(db);
    this.gmailStyleProfileService = new GmailStyleProfileService(db);
  }

  private createGmailProvider() {
    return new GmailProvider(this.db);
  }

  private createHubSpotProvider() {
    return new HubSpotProvider(this.db);
  }

  private buildHubSpotSummaryCacheItems(module: HubSpotModule, records: HubSpotRecordSummary[]) {
    return records.map((record) => ({
      sourceType: hubspotSourceType(module),
      externalId: record.id,
      title: record.title,
      summary: record.subtitle,
      normalizedData: {
        module,
        properties: record.properties,
        updatedAt: record.updatedAt,
      },
    }));
  }

  private normalizeHubSpotLookupValue(value: string) {
    return value.trim().replace(/^["']|["']$/g, "").toLowerCase();
  }

  private isExactHubSpotMatch(module: HubSpotModule, query: string, record: HubSpotRecordSummary) {
    const normalizedQuery = this.normalizeHubSpotLookupValue(query);
    if (!normalizedQuery) {
      return false;
    }

    const props = record.properties as Record<string, unknown>;
    const title = this.normalizeHubSpotLookupValue(record.title ?? "");

    if (module === "contacts") {
      const fullName = this.normalizeHubSpotLookupValue(
        [props["firstname"], props["lastname"]]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .join(" "),
      );
      const email = this.normalizeHubSpotLookupValue(typeof props["email"] === "string" ? props["email"] : "");
      return normalizedQuery === email || normalizedQuery === fullName || normalizedQuery === title;
    }

    if (module === "companies") {
      const name = this.normalizeHubSpotLookupValue(typeof props["name"] === "string" ? props["name"] : "");
      const domain = this.normalizeHubSpotLookupValue(typeof props["domain"] === "string" ? props["domain"] : "");
      return normalizedQuery === domain || normalizedQuery === name || normalizedQuery === title;
    }

    if (module === "deals") {
      const dealName = this.normalizeHubSpotLookupValue(typeof props["dealname"] === "string" ? props["dealname"] : "");
      return normalizedQuery === dealName || normalizedQuery === title;
    }

    if (module === "notes") {
      const noteBody = this.normalizeHubSpotLookupValue(typeof props["hs_note_body"] === "string" ? props["hs_note_body"] : "");
      return normalizedQuery === noteBody || normalizedQuery === title;
    }

    const taskSubject = this.normalizeHubSpotLookupValue(typeof props["hs_task_subject"] === "string" ? props["hs_task_subject"] : "");
    return normalizedQuery === taskSubject || normalizedQuery === title;
  }

  private summarizeHubSpotDetail(module: HubSpotModule, record: {
    id: string;
    properties?: Record<string, string | null | undefined>;
    updatedAt?: string;
    createdAt?: string;
  }): HubSpotRecordSummary {
    return {
      id: record.id,
      title: hubspotRecordTitle(module, record.properties),
      subtitle: hubspotContextSummary(module, record.properties),
      properties: record.properties ?? {},
      updatedAt:
        record.updatedAt ??
        record.properties?.["lastmodifieddate"] ??
        record.properties?.["hs_lastmodifieddate"] ??
        record.properties?.["hs_timestamp"] ??
        record.createdAt ??
        null,
    };
  }

  private async getHubSpotRecordSourceContext(
    currentWorkspace: CurrentWorkspace,
    integration: Awaited<ReturnType<IntegrationService["requireConnection"]>>,
    input: { module: "contacts" | "companies" | "deals"; recordId: string; fallbackTitle: string },
  ) {
    const cachedItem = await this.itemRepository.getByExternalId(
      currentWorkspace.id,
      integration.id,
      input.recordId,
      hubspotSourceType(input.module),
    );

    if (cachedItem) {
      const normalizedData = cachedItem.normalizedData as Record<string, unknown>;
      const props = (normalizedData.properties ?? normalizedData) as Record<string, unknown>;
      return {
        recordTitle: cachedItem.title ?? input.fallbackTitle,
        currentProperties: props,
        sourceRefs: toSourceRefs("hubspot", input.recordId, cachedItem.title ?? input.fallbackTitle),
      };
    }

    const record = await this.createHubSpotProvider().getRecord(integration, {
      objectType: input.module,
      recordId: input.recordId,
    });

    const recordTitle =
      hubspotRecordTitle(input.module, record.properties as Record<string, string | null | undefined>) || input.fallbackTitle;

    await this.itemRepository.syncItems(integration, [
      {
        sourceType: hubspotSourceType(input.module),
        externalId: record.id,
        title: recordTitle,
        summary: hubspotContextSummary(input.module, record.properties),
        normalizedData: {
          ...record,
          module: input.module,
        },
      },
    ]);

    return {
      recordTitle,
      currentProperties: record.properties ?? {},
      sourceRefs: toSourceRefs("hubspot", record.id, recordTitle),
    };
  }

  private async assertHubSpotConnectionUsable(
    integration: Awaited<ReturnType<IntegrationService["requireConnection"]>>,
    action: string,
  ) {
    const status = await this.createHubSpotProvider().getConnectionStatus(integration);

    if (status.status === "connected" || status.status === "syncing") {
      return;
    }

    throw new ApiError({
      code: "INTEGRATION_NOT_READY",
      message:
        status.reconnectReason ??
        `HubSpot must be connected and healthy before Gideon can ${action}.`,
      status: 409,
    });
  }

  private getGmailOwnerId(integration: { ownedByUserId?: string | null; connectedBy: string }) {
    return integration.ownedByUserId ?? integration.connectedBy;
  }

  private hasGmailOwnerAccess(
    userId: string,
    integration: { provider: string; ownedByUserId?: string | null; connectedBy: string },
  ) {
    if (integration.provider !== "gmail" && integration.provider !== "google") {
      return true;
    }

    return this.getGmailOwnerId(integration) === userId;
  }

  private assertGmailOwnerAccess(
    userId: string,
    integration: { provider: string; ownedByUserId?: string | null; connectedBy: string },
    action: string,
  ) {
    if (this.hasGmailOwnerAccess(userId, integration)) {
      return;
    }

    throw new ApiError({
      code: "FORBIDDEN",
      message: `Only the user who connected this Gmail account can ${action}.`,
      status: 403,
    });
  }

  private buildGmailThreadCacheItem(connection: { retentionDays?: number; id: string; workspaceId: string; provider: string }, thread: GmailThreadDetail) {
    const retentionDays = connection.retentionDays ?? 30;
    const listItem = this.createGmailProvider().buildThreadListItem(thread);
    // Gmail raw cache stays backend-only and is intentionally excluded from
    // general retrieval/embedding. Only active selected-thread context, saved
    // artifacts, and explicit memory may surface Gmail-derived content broadly.
    return {
      sourceType: "email_thread" as const,
      externalId: thread.threadId,
      title: thread.subject,
      summary: thread.snippet,
      normalizedData: {
        ...thread,
        listItem,
      },
      expiresAt: Timestamp.fromMillis(Date.now() + retentionDays * 24 * 60 * 60 * 1000),
    };
  }

  private cachedThreadDetailFromItem(item: IntegrationItem | null) {
    if (!item) {
      return null;
    }

    const normalized = item.normalizedData as Record<string, unknown>;
    if (isGmailThreadDetail(normalized)) {
      return sanitizeCachedGmailThread(normalized);
    }

    return null;
  }

  private cachedThreadListItemFromItem(item: IntegrationItem) {
    const fallbackTimestamp = item.lastSyncedAt.toDate().toISOString();
    const normalized = item.normalizedData as Record<string, unknown>;
    if (isGmailThreadDetail(normalized)) {
      const listItem = this.createGmailProvider().buildThreadListItem(sanitizeCachedGmailThread(normalized));
      return {
        ...listItem,
        lastMessageAt: sanitizeIntegrationTimestamp(listItem.lastMessageAt) ?? fallbackTimestamp,
      };
    }

    if (
      normalized["listItem"] &&
      typeof normalized["listItem"] === "object" &&
      normalized["listItem"] !== null &&
      "threadId" in (normalized["listItem"] as Record<string, unknown>)
    ) {
      const listItem = normalized["listItem"] as {
        id: string;
        threadId: string;
        subject: string;
        snippet: string;
        from: string;
        lastMessageAt: string | null;
        unread: boolean;
      };
      return {
        ...listItem,
        lastMessageAt: sanitizeIntegrationTimestamp(listItem.lastMessageAt) ?? fallbackTimestamp,
      };
    }

    if (
      typeof normalized["threadId"] === "string" &&
      typeof normalized["subject"] === "string" &&
      typeof normalized["snippet"] === "string"
    ) {
      const listItem = normalized as {
        id: string;
        threadId: string;
        subject: string;
        snippet: string;
        from: string;
        lastMessageAt: string | null;
        unread: boolean;
      };
      return {
        ...listItem,
        lastMessageAt: sanitizeIntegrationTimestamp(listItem.lastMessageAt) ?? fallbackTimestamp,
      };
    }

    return {
      id: item.externalId,
      threadId: item.externalId,
      subject: item.title ?? "Untitled Gmail thread",
      snippet: item.summary ?? "",
      from: "",
      lastMessageAt: fallbackTimestamp,
      unread: false,
    };
  }

  async resolveHubSpotRecord(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: {
      module: HubSpotModule;
      query: string;
      selectedRecordId?: string | null;
      maxResults?: number;
    },
  ): Promise<HubSpotRecordResolution> {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "hubspot");
    await this.assertHubSpotConnectionUsable(integration, "resolve HubSpot records");

    const hubspotProvider = this.createHubSpotProvider();
    const query = input.query.trim();

    if (input.selectedRecordId) {
      const detail = await hubspotProvider.getRecord(integration, {
        objectType: input.module,
        recordId: input.selectedRecordId,
      });
      const record = this.summarizeHubSpotDetail(input.module, detail);
      await this.itemRepository.syncItems(integration, this.buildHubSpotSummaryCacheItems(input.module, [record]));
      return {
        status: "resolved_single",
        module: input.module,
        query,
        record,
      };
    }

    if (/^\d+$/.test(query)) {
      try {
        const detail = await hubspotProvider.getRecord(integration, {
          objectType: input.module,
          recordId: query,
        });
        const record = this.summarizeHubSpotDetail(input.module, detail);
        await this.itemRepository.syncItems(integration, this.buildHubSpotSummaryCacheItems(input.module, [record]));
        return {
          status: "resolved_single",
          module: input.module,
          query,
          record,
        };
      } catch {
        // Fall through to bounded search.
      }
    }

    const records = await hubspotProvider.searchRecords(integration, {
      objectType: input.module,
      query,
      limit: Math.min(input.maxResults ?? 5, 8),
    });

    if (records.length) {
      await this.itemRepository.syncItems(integration, this.buildHubSpotSummaryCacheItems(input.module, records));
    }

    const exactMatches = records.filter((record) => this.isExactHubSpotMatch(input.module, query, record));
    if (exactMatches.length === 1) {
      return {
        status: "resolved_single",
        module: input.module,
        query,
        record: exactMatches[0],
      };
    }

    if (exactMatches.length > 1) {
      return {
        status: "multiple_matches",
        module: input.module,
        query,
        records: exactMatches,
      };
    }

    if (records.length === 1) {
      return {
        status: "resolved_single",
        module: input.module,
        query,
        record: records[0],
      };
    }

    if (records.length > 1) {
      return {
        status: "multiple_matches",
        module: input.module,
        query,
        records,
      };
    }

    return {
      status: "not_found",
      module: input.module,
      query,
    };
  }

  async getWorkspaceData(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    provider: string,
    input?: { query?: string; module?: HubSpotModule; maxResults?: number },
  ) {
    const integration = await this.integrationService.getIntegration(currentWorkspace, provider);

    if (!integration) {
      return {
        provider,
        connection: {
          id: provider,
          provider,
          status: "disconnected" as const,
          capabilities: [],
          scopes: [],
          scopesGranted: [],
          lastSyncedAt: null,
          syncError: null,
          ownedByUserId: null,
          connectedBy: userId,
          reconnectReason: null,
          lastErrorCode: null,
          accountEmail: null,
          watchStatus: null,
          watchExpiration: null,
          lastDeltaSyncedAt: null,
          fullResyncRequired: false,
        },
        list: [],
      };
    }

    const connection = await this.integrationService.getIntegrationDetail(currentWorkspace, provider, userId);
    const gmailOwnerAccess =
      provider === "gmail" || provider === "google"
        ? this.hasGmailOwnerAccess(userId, integration)
        : true;

    if ((provider === "gmail" || provider === "google")) {
      if (!gmailOwnerAccess) {
        return {
          provider: "gmail" as const,
          connection: {
            ...connection,
            access: "restricted" as const,
            ownerOnly: true,
          },
          list: [],
        };
      }

      const items = await this.itemRepository.listByIntegration(currentWorkspace.id, integration.id, 100);
      const filtered = items
        .map((item) => this.cachedThreadListItemFromItem(item))
        .filter((thread) => {
          const query = input?.query?.trim().toLowerCase();
          if (!query) {
            return true;
          }

          const haystack = [
            thread.subject,
            thread.snippet,
            thread.from,
          ]
            .join(" ")
            .toLowerCase();

          return haystack.includes(query);
        })
        .sort((a, b) => {
          const aIso = sanitizeIntegrationTimestamp(a.lastMessageAt);
          const bIso = sanitizeIntegrationTimestamp(b.lastMessageAt);
          const aTime = aIso ? new Date(aIso).getTime() : 0;
          const bTime = bIso ? new Date(bIso).getTime() : 0;
          return bTime - aTime;
        })
        .slice(0, Math.min(input?.maxResults ?? 50, 50));

      return {
        provider: "gmail" as const,
        connection: {
          ...connection,
          access: "owner" as const,
          ownerOnly: true,
        },
        list: filtered,
      };
    }

    if (provider === "hubspot") {
      const hubspotProvider = this.createHubSpotProvider();
      const module = input?.module ?? "contacts";
      if (connection.status !== "connected" && connection.status !== "syncing") {
        return {
          provider: "hubspot" as const,
          connection,
          module,
          list: [],
        };
      }
      const records = await hubspotProvider.searchRecords(integration, {
        objectType: module,
        query: input?.query?.trim() || undefined,
        limit: Math.min(input?.maxResults ?? 20, 20),
      });

      if (records.length) {
        await this.itemRepository.syncItems(integration, this.buildHubSpotSummaryCacheItems(module, records));
      }

      return {
        provider: "hubspot" as const,
        connection,
        module,
        list: records,
      };
    }

    throw new ApiError({
      code: "NOT_SUPPORTED",
      message: `Provider "${provider}" is not implemented for workspace mode.`,
      status: 400,
    });
  }

  async getSelectedItemDetail(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    provider: string,
    input: { itemId: string; module?: HubSpotModule },
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, provider);

    if (provider === "gmail" || provider === "google") {
      this.assertGmailOwnerAccess(userId, integration, "open Gmail thread content");
      const gmailProvider = this.createGmailProvider();
      const cachedItem = await this.itemRepository.getByExternalId(
        currentWorkspace.id,
        integration.id,
        input.itemId,
        "email_thread",
      );
      let thread = this.cachedThreadDetailFromItem(cachedItem);

      if (!thread) {
        thread = await gmailProvider.getThread(integration, input.itemId);
        await this.itemRepository.syncItems(integration, [this.buildGmailThreadCacheItem(integration, thread)]);
      }

      const sourceRefs = toSourceRefs("gmail", thread.threadId, thread.subject);
      
      // Look up HubSpot contacts matching thread participants
      const participantEmails = thread.participants
        .map(p => {
          const match = p.match(/<([^>]+)>/);
          return match ? match[1].toLowerCase() : p.toLowerCase();
        })
        .filter(email => email && email.includes("@"));
        
      const hubspotContacts: any[] = [];
      if (participantEmails.length > 0) {
        try {
          const crmContactsSnapshot = await this.db.collection("workspaces")
            .doc(currentWorkspace.id)
            .collection("integrationItems")
            .where("sourceType", "==", "crm_contact")
            .get();
            
          for (const doc of crmContactsSnapshot.docs) {
            const data = doc.data();
            const contactEmail = typeof data.normalizedData?.email === "string" 
              ? data.normalizedData.email.toLowerCase() 
              : null;
            if (contactEmail && participantEmails.includes(contactEmail)) {
              hubspotContacts.push(data);
              sourceRefs.push(buildIntegrationSourceRef({
                provider: "hubspot",
                sourceId: data.externalId,
                title: data.title ?? "HubSpot Contact",
              }));
            }
          }
        } catch (e) {
          // Ignore error, best effort append
        }
      }

      let content = threadToPrompt(thread);
      if (hubspotContacts.length > 0) {
        content += "\n\n--- HubSpot Context ---\n";
        content += hubspotContacts.map(c => `Contact: ${c.title}\nSummary: ${c.summary}`).join("\n\n");
      }

      const selected = buildSelectedItemContext({
        provider: "gmail",
        itemId: thread.threadId,
        itemType: "email_thread",
        title: thread.subject,
        summary: thread.snippet,
        content,
        metadata: {
          participants: thread.participants,
          messageCount: thread.messages.length,
          hubspotContactCount: hubspotContacts.length,
        },
        sourceRefs,
      });
      const contextBundle = await this.contextService.buildOrReuseBundle({
        workspace: currentWorkspace.workspace,
        userId,
        key: `integration-selected:gmail:${thread.threadId}`,
        purpose: "Selected Gmail thread context",
        sourceRefs,
        payload: {
          integration: buildIntegrationContextBlock({
            provider: "gmail",
            status: integration.status,
            title: "Selected Gmail thread",
            selectedItem: selected,
          }),
        },
      });

      return {
        provider: "gmail" as const,
        detail: thread,
        sourceRefs,
        contextBundleId: contextBundle.bundle.id,
        selectedContext: selected,
      };
    }

    if (provider === "hubspot") {
      const module = input.module ?? "contacts";
      const hubspotProvider = this.createHubSpotProvider();
      await this.assertHubSpotConnectionUsable(integration, "open HubSpot record details");
      const record = await hubspotProvider.getRecord(integration, {
        objectType: module,
        recordId: input.itemId,
      });
      const title = hubspotRecordTitle(module, record.properties);
      const relatedCompanies =
        module === "contacts" || module === "deals"
          ? await hubspotProvider.getRelatedRecords(integration, {
              fromObjectType: module,
              fromRecordId: input.itemId,
              toObjectType: "companies",
              limit: 5,
            })
          : [];
      const relatedContacts =
        module === "companies" || module === "deals"
          ? await hubspotProvider.getRelatedRecords(integration, {
              fromObjectType: module,
              fromRecordId: input.itemId,
              toObjectType: "contacts",
              limit: 5,
            })
          : [];
      const relatedDeals =
        module === "contacts" || module === "companies"
          ? await hubspotProvider.getRelatedRecords(integration, {
              fromObjectType: module,
              fromRecordId: input.itemId,
              toObjectType: "deals",
              limit: 5,
            })
          : [];
      const relatedNotes =
        module !== "notes"
          ? await hubspotProvider.getRelatedRecords(integration, {
              fromObjectType: module,
              fromRecordId: input.itemId,
              toObjectType: "notes",
              limit: 4,
            })
          : [];
      const relatedTasks =
        module !== "tasks"
          ? await hubspotProvider.getRelatedRecords(integration, {
              fromObjectType: module,
              fromRecordId: input.itemId,
              toObjectType: "tasks",
              limit: 4,
            })
          : [];
      const sourceRefs = toSourceRefs("hubspot", record.id, title);
      const relatedContent = [
        formatRelatedRecords("Associated companies:", relatedCompanies),
        formatRelatedRecords("Associated contacts:", relatedContacts),
        formatRelatedRecords("Associated deals:", relatedDeals),
        formatRelatedRecords("Recent notes:", relatedNotes),
        formatRelatedRecords("Open tasks:", relatedTasks),
      ]
        .filter(Boolean)
        .join("\n\n");
      const selected = buildSelectedItemContext({
        provider: "hubspot",
        itemId: record.id,
        itemType: module,
        title,
        summary: hubspotContextSummary(module, record.properties),
        content: [recordToPrompt(record), relatedContent].filter(Boolean).join("\n\n"),
        metadata: {
          module,
          propertyCount: Object.keys(record.properties ?? {}).length,
          associationCounts: {
            companies: relatedCompanies.length,
            contacts: relatedContacts.length,
            deals: relatedDeals.length,
            notes: relatedNotes.length,
            tasks: relatedTasks.length,
          },
        },
        sourceRefs,
      });
      const contextBundle = await this.contextService.buildOrReuseBundle({
        workspace: currentWorkspace.workspace,
        userId,
        key: `integration-selected:hubspot:${module}:${record.id}`,
        purpose: "Selected HubSpot record context",
        sourceRefs,
        payload: {
          integration: buildIntegrationContextBlock({
            provider: "hubspot",
            status: integration.status,
            title: "Selected HubSpot record",
            selectedItem: selected,
          }),
        },
      });

      await this.itemRepository.syncItems(integration, [
        {
          sourceType: hubspotSourceType(module),
          externalId: record.id,
          title,
          summary: compactJson(record.properties ?? {}).slice(0, 400),
          normalizedData: {
            ...record,
            module,
            associations: {
              companies: relatedCompanies,
              contacts: relatedContacts,
              deals: relatedDeals,
              notes: relatedNotes,
              tasks: relatedTasks,
            },
          },
        },
      ]);

      return {
        provider: "hubspot" as const,
        module,
        detail: {
          ...record,
          title,
          summary: hubspotContextSummary(module, record.properties),
          associations: {
            companies: relatedCompanies,
            contacts: relatedContacts,
            deals: relatedDeals,
          },
          relatedNotes,
          relatedTasks,
        },
        sourceRefs,
        contextBundleId: contextBundle.bundle.id,
        selectedContext: selected,
      };
    }

    throw new ApiError({
      code: "NOT_SUPPORTED",
      message: `Provider "${provider}" is not implemented for selected-item detail.`,
      status: 400,
    });
  }

  async summarizeGmailThread(currentWorkspace: CurrentWorkspace, userId: string, threadId: string) {
    const selected = await this.getSelectedItemDetail(currentWorkspace, userId, "gmail", { itemId: threadId });
    const llm = createLlmProvider();
    const output = await llm.generateStructured({
      schema: threadSummarySchema,
      systemPrompt:
        "You summarize Gmail threads for busy operators. Return a crisp summary, key points, and reply focus suggestions.",
      userPrompt: `Summarize this email thread for the user.\n\n${selected.selectedContext.content}`,
    });

    return { ...output, sourceRefs: selected.sourceRefs, contextBundleId: selected.contextBundleId };
  }

  async extractGmailActionItems(currentWorkspace: CurrentWorkspace, userId: string, threadId: string) {
    const selected = await this.getSelectedItemDetail(currentWorkspace, userId, "gmail", { itemId: threadId });
    const llm = createLlmProvider("reasoning");
    const output = await llm.generateStructured({
      schema: actionItemsSchema,
      systemPrompt:
        "Extract concrete action items from the email thread. Use explicit owners when possible. If no owner is obvious, use 'Unassigned'.",
      userPrompt: `Extract action items from this email thread.\n\n${selected.selectedContext.content}`,
    });

    return { ...output, sourceRefs: selected.sourceRefs, contextBundleId: selected.contextBundleId };
  }

  async draftGmailReply(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    threadId: string,
    tone = "helpful and concise",
  ) {
    const selected = await this.getSelectedItemDetail(currentWorkspace, userId, "gmail", { itemId: threadId });
    const styleProfile = await this.gmailStyleProfileService.getProfile(currentWorkspace.id, userId);
    const stylePrompt = this.gmailStyleProfileService.buildPromptBlock(styleProfile);
    const llm = createLlmProvider("reasoning");
    const output = await llm.generateStructured({
      schema: draftReplySchema,
      systemPrompt: [
        "Draft an email reply grounded in the thread. Be accurate, concise, and actionable. Do not invent commitments.",
        stylePrompt ? `[WRITING STYLE]\n${stylePrompt}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      userPrompt: `Draft a ${tone} reply to this email thread.\n\n${selected.selectedContext.content}`,
    });

    return { ...output, sourceRefs: selected.sourceRefs, contextBundleId: selected.contextBundleId };
  }

  async createGmailDraft(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: GmailComposeInput,
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "gmail");
    this.assertGmailOwnerAccess(userId, integration, "create Gmail drafts");
    const to = uniqueStrings(input.to);
    const cc = uniqueStrings(input.cc ?? []);
    let subject = input.subject?.trim();
    let body = input.body?.trim();

    if ((!subject || !body) && input.threadId) {
      const drafted = await this.draftGmailReply(currentWorkspace, userId, input.threadId);
      subject = subject ?? drafted.subject;
      body = body ?? drafted.body;
    }

    if (!to.length) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "At least one recipient is required to create a Gmail draft.",
        status: 400,
      });
    }

    if (!subject || !body) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message:
          input.threadId
            ? "Gmail reply drafts need a subject and body before they can be saved."
            : "New Gmail drafts need a subject and body before they can be saved.",
        status: 400,
      });
    }

    const gmailProvider = this.createGmailProvider();
    const draft = await gmailProvider.createDraft(integration, {
      to,
      cc,
      subject,
      body,
      threadId: input.threadId,
    });

    return {
      ...draft,
      subject,
      body,
      to,
      cc,
    };
  }

  async prepareGmailSendApproval(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: GmailComposeInput,
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "gmail");
    this.assertGmailOwnerAccess(userId, integration, "create Gmail send approvals");
    let to = uniqueStrings(input.to);
    const cc = uniqueStrings(input.cc ?? []);
    let subject = input.subject?.trim();
    let body = input.body?.trim();

    if (!to.length && input.threadId) {
      const selected = await this.getSelectedItemDetail(
        currentWorkspace,
        userId,
        "gmail",
        { itemId: input.threadId },
      );
      const ownAddress = integration.accountEmail?.toLowerCase();
      const detail = selected.detail as { participants?: unknown };
      const participants = Array.isArray(detail.participants)
        ? detail.participants.filter(
            (participant): participant is string => typeof participant === "string",
          )
        : [];
      to = uniqueStrings(
        participants
          .flatMap((participant) => participant.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
          .map((address) => address.toLowerCase())
          .filter((address) => address !== ownAddress),
      );
    }

    if ((!subject || !body) && input.threadId) {
      // Reply path: auto-draft from thread context
      const draft = await this.draftGmailReply(currentWorkspace, userId, input.threadId);
      subject = subject ?? draft.subject;
      body = body ?? draft.body;
    } else if (!body && !input.threadId) {
      // New compose path: AI drafts subject/body from whatever context was provided
      const styleProfile = await this.gmailStyleProfileService.getProfile(currentWorkspace.id, userId);
      const stylePrompt = this.gmailStyleProfileService.buildPromptBlock(styleProfile);
      const llm = createLlmProvider("reasoning");
      const drafted = await llm.generateStructured({
        schema: draftReplySchema,
        systemPrompt: [
          "You are drafting a new outbound email on behalf of a busy executive. Write a professional, concise email based on the intent provided.",
          "Return a subject line and a complete email body.",
          stylePrompt ? `[WRITING STYLE]\n${stylePrompt}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
        userPrompt: [
          `To: ${to.join(", ")}`,
          subject ? `Intended subject: ${subject}` : null,
          `Intent: ${input.tone ?? "Send a professional email based on the available context."}`,
        ]
          .filter(Boolean)
          .join("\n"),
      });
      subject = subject ?? drafted.subject;
      body = drafted.body;
    }

    if (!to.length) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "At least one recipient is required before Gideon can create a Gmail send approval.",
        status: 400,
      });
    }

    if (!subject || !body) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message:
          input.threadId
            ? "Gmail replies need final subject and body content before approval can be created."
            : "New outbound Gmail messages need a subject and body before approval can be created.",
        status: 400,
      });
    }

    const sourceRefs = input.threadId
      ? (await this.getSelectedItemDetail(currentWorkspace, userId, "gmail", { itemId: input.threadId })).sourceRefs
      : [];
    const approval = await this.approvalService.createApproval({
      workspace: currentWorkspace.workspace,
      userId,
      title: `${input.threadId ? "Send Gmail reply" : "Send Gmail email"}: ${subject}`,
      reason: input.threadId
        ? "This Gmail reply requires approval before it can be sent externally."
        : "This new outbound Gmail message requires approval before it can be sent externally.",
      type: "email_send",
      preview: {
        to,
        cc,
        subject,
        body,
      },
      proposedAction: {
        toolName: "gmail.sendApproved",
        actionType: "gmail_send",
        input: {
          threadId: input.threadId,
          to,
          cc,
          subject,
          body,
        },
        requiresApproval: true,
        riskLevel: "medium",
      },
      riskLevel: "medium",
      sourceRefs,
      idempotencyKey: createIdempotencyKey("gmail_send", {
        threadId: input.threadId ?? "outbound",
        to,
        subject,
      }),
    });

    return {
      approvalId: approval.id,
      subject,
      body,
      to,
      cc,
      sourceRefs,
    };
  }

  async executeApprovedGmailSend(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: { threadId?: string; to: string[]; cc?: string[]; subject: string; body: string },
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "gmail");
    this.assertGmailOwnerAccess(userId, integration, "send mail from it");
    const to = uniqueStrings(input.to);
    const cc = uniqueStrings(input.cc ?? []);

    if (!to.length) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "At least one recipient is required before Gmail can send this message.",
        status: 400,
      });
    }

    const gmailProvider = this.createGmailProvider();
    const result = await gmailProvider.sendMessage(integration, {
      threadId: input.threadId,
      to,
      cc,
      subject: input.subject,
      body: input.body,
    });

    return {
      ...result,
      subject: input.subject,
      body: input.body,
      to,
      cc,
    };
  }

  async saveGmailThreadSummary(currentWorkspace: CurrentWorkspace, userId: string, threadId: string) {
    const summary = await this.summarizeGmailThread(currentWorkspace, userId, threadId);
    const artifact = await this.artifactService.createArtifact({
      workspace: currentWorkspace.workspace,
      userId,
      title: `Gmail thread summary: ${threadId}`,
      artifactType: "summary",
      content: `${summary.summary}\n\nKey points:\n- ${summary.keyPoints.join("\n- ")}`,
      sourceRefs: summary.sourceRefs,
      creationSource: "integration_workspace",
    });

    return { artifactId: artifact.id, title: artifact.title, sourceRefs: summary.sourceRefs };
  }

  async createGmailFollowUpWorkflow(currentWorkspace: CurrentWorkspace, userId: string, threadId: string) {
    const workflow = await this.workflowService.createWorkflow({
      workspace: currentWorkspace.workspace,
      userId,
      name: `Gmail follow-up: ${threadId}`,
      description: "Follow up on a selected Gmail thread with approval-gated external actions.",
      type: "custom",
      trigger: { type: "manual" },
      steps: buildWorkflowStepsForIntegration(
        "Prepare a follow-up based on the selected Gmail thread.",
        "gmail",
        threadId,
        "email_thread",
      ),
      approvalPolicy: { default: "external_only" },
      notificationPolicy: { channel: "in_app" },
    });

    return { workflowId: workflow.id, name: workflow.name };
  }

  async getGmailStyleProfile(currentWorkspace: CurrentWorkspace, userId: string) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "gmail");
    this.assertGmailOwnerAccess(userId, integration, "view the Gmail writing style profile");
    return this.gmailStyleProfileService.getProfile(currentWorkspace.id, userId);
  }

  async analyzeGmailStyleProfile(currentWorkspace: CurrentWorkspace, userId: string, sampleSize?: number) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "gmail");
    this.assertGmailOwnerAccess(userId, integration, "analyze Gmail writing style");
    return this.gmailStyleProfileService.analyzeProfile(currentWorkspace, userId, sampleSize);
  }

  async deleteGmailStyleProfile(currentWorkspace: CurrentWorkspace, userId: string) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "gmail");
    this.assertGmailOwnerAccess(userId, integration, "delete the Gmail writing style profile");
    await this.gmailStyleProfileService.deleteProfile(currentWorkspace.id, userId);
    return { deleted: true as const };
  }

  async summarizeHubSpotRecord(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: { module: HubSpotModule; recordId: string },
  ) {
    await this.assertHubSpotConnectionUsable(
      await this.integrationService.requireConnection(currentWorkspace, "hubspot"),
      "summarize HubSpot records",
    );
    const selected = await this.getSelectedItemDetail(currentWorkspace, userId, "hubspot", {
      itemId: input.recordId,
      module: input.module,
    });
    const llm = createLlmProvider();
    const output = await llm.generateStructured({
      schema: recordSummarySchema,
      systemPrompt:
        "Summarize the CRM record, highlight key context, and suggest next steps. Do not invent account history.",
      userPrompt: `Summarize this HubSpot record for the user.\n\n${selected.selectedContext.content}`,
    });

    return { ...output, sourceRefs: selected.sourceRefs, contextBundleId: selected.contextBundleId };
  }

  async draftHubSpotFollowUp(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: { module: HubSpotModule; recordId: string },
  ) {
    await this.assertHubSpotConnectionUsable(
      await this.integrationService.requireConnection(currentWorkspace, "hubspot"),
      "draft HubSpot follow-ups",
    );
    const selected = await this.getSelectedItemDetail(currentWorkspace, userId, "hubspot", {
      itemId: input.recordId,
      module: input.module,
    });
    const llm = createLlmProvider("reasoning");
    const output = await llm.generateStructured({
      schema: followUpDraftSchema,
      systemPrompt:
        "Draft a professional follow-up based on the CRM record. Keep it short and grounded in the provided details.",
      userPrompt: `Draft a follow-up for this HubSpot record.\n\n${selected.selectedContext.content}`,
    });

    return { ...output, sourceRefs: selected.sourceRefs, contextBundleId: selected.contextBundleId };
  }

  async createHubSpotNoteDraft(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: { module: HubSpotModule; recordId: string },
  ) {
    await this.assertHubSpotConnectionUsable(
      await this.integrationService.requireConnection(currentWorkspace, "hubspot"),
      "prepare internal HubSpot note drafts",
    );
    const summary = await this.summarizeHubSpotRecord(currentWorkspace, userId, input);
    const artifact = await this.artifactService.createArtifact({
      workspace: currentWorkspace.workspace,
      userId,
      title: `HubSpot internal note draft: ${input.module} ${input.recordId}`,
      artifactType: "draft",
      content: `${summary.summary}\n\nKey points:\n- ${summary.keyPoints.join("\n- ")}`,
      sourceRefs: summary.sourceRefs,
      creationSource: "integration_workspace",
    });

    return { artifactId: artifact.id, title: artifact.title, sourceRefs: summary.sourceRefs };
  }

  async prepareHubSpotUpdateApproval(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: {
      module: "contacts" | "companies" | "deals";
      recordId: string;
      updates: Record<string, unknown>;
      title?: string;
    },
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "hubspot");
    await this.assertHubSpotConnectionUsable(integration, "prepare HubSpot update approval");

    // --- Cache-first: read current properties from local Firestore sync ---
    const recordContext = await this.getHubSpotRecordSourceContext(currentWorkspace, integration, {
      module: input.module,
      recordId: input.recordId,
      fallbackTitle: input.title ?? `HubSpot ${input.module} record`,
    });

    /* Legacy cache fallback removed. Deterministic recordContext above now
    guarantees that approvals only proceed with a resolved live or cached CRM record.
    if (cachedItem) {
      // Use synced cache — avoids live API call that can return 404
      const normalizedData = cachedItem.normalizedData as Record<string, unknown>;
      const props = (normalizedData.properties ?? normalizedData) as Record<string, unknown>;
      currentProperties = props;
      recordTitle = cachedItem.title ?? recordTitle;
      sourceRefs = toSourceRefs("hubspot", input.recordId, recordTitle);
      logger.info("prepareHubSpotUpdateApproval: using cached record", {
        workspaceId: currentWorkspace.id,
        module: input.module,
        recordId: input.recordId,
      });
    } else {
      // Fallback: hit the live HubSpot API if not yet cached
      logger.info("prepareHubSpotUpdateApproval: cache miss, fetching from HubSpot API", {
        workspaceId: currentWorkspace.id,
        module: input.module,
        recordId: input.recordId,
      });
      try {
        const hubspotProvider = this.createHubSpotProvider();
        const record = await hubspotProvider.getRecord(integration, {
          objectType: input.module,
          recordId: input.recordId,
        });
        currentProperties = record.properties ?? {};
        recordTitle = hubspotRecordTitle(input.module, record.properties as Record<string, string | null | undefined>) || recordTitle;
        sourceRefs = toSourceRefs("hubspot", record.id, recordTitle);
      } catch (err) {
        // If live fetch also fails, proceed with empty before-values — approval still gets created
        logger.warn("prepareHubSpotUpdateApproval: live API fetch failed, proceeding with empty before-values", {
          workspaceId: currentWorkspace.id,
          module: input.module,
          recordId: input.recordId,
          error: err instanceof Error ? err.message : String(err),
        });
        sourceRefs = toSourceRefs("hubspot", input.recordId, recordTitle);
      }
    }

    }
    */

    const beforeValues: Record<string, unknown> = {};
    for (const key of Object.keys(input.updates)) {
      beforeValues[key] = recordContext.currentProperties[key] ?? null;
    }

    const approval = await this.approvalService.createApproval({
      workspace: currentWorkspace.workspace,
      userId,
      title: input.title ?? `Update HubSpot ${input.module} record`,
      reason: "This HubSpot change requires approval before Gideon writes to CRM.",
      type: "crm_update",
      preview: {
        module: input.module,
        recordId: input.recordId,
        recordTitle: recordContext.recordTitle,
        beforeValues,
        updates: input.updates,
      },
      proposedAction: {
        toolName: "hubspot.updateApproved",
        actionType: "hubspot_update",
        input,
        requiresApproval: true,
        riskLevel: "high",
      },
      riskLevel: "high",
      sourceRefs: recordContext.sourceRefs,
      idempotencyKey: createIdempotencyKey("hubspot_update", {
        module: input.module,
        recordId: input.recordId,
        updates: input.updates,
      }),
    });

    return { approvalId: approval.id, sourceRefs: recordContext.sourceRefs };
  }

  async executeApprovedHubSpotUpdate(
    currentWorkspace: CurrentWorkspace,
    _userId: string,
    input: {
      module: HubSpotModule;
      recordId: string;
      updates: Record<string, unknown>;
      title?: string;
    },
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "hubspot");
    await this.assertHubSpotConnectionUsable(integration, "update HubSpot records");

    const hubspotProvider = this.createHubSpotProvider();
    const updatedRecord = await hubspotProvider.updateRecord(integration, {
      objectType: input.module,
      recordId: input.recordId,
      updates: input.updates,
    });
    const recordTitle =
      input.module === "contacts"
        ? `${updatedRecord.properties?.["firstname"] ?? ""} ${updatedRecord.properties?.["lastname"] ?? ""}`.trim() ||
          String(updatedRecord.properties?.["email"] ?? "Updated contact")
        : input.module === "companies"
          ? String(updatedRecord.properties?.["name"] ?? updatedRecord.properties?.["domain"] ?? "Updated company")
          : String(updatedRecord.properties?.["dealname"] ?? "Updated deal");

    await this.itemRepository.syncItems(integration, [
      {
        sourceType: hubspotSourceType(input.module),
        externalId: updatedRecord.id,
        title: recordTitle,
        summary: compactJson(updatedRecord.properties ?? {}).slice(0, 400),
        normalizedData: {
          ...updatedRecord,
          module: input.module,
        },
      },
    ]);

    return {
      recordId: updatedRecord.id,
      module: input.module,
      updatedProperties: updatedRecord.properties ?? {},
      updatedAt: updatedRecord.updatedAt ?? null,
      archived: Boolean(updatedRecord.archived),
    };
  }

  async prepareHubSpotCreateApproval(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: {
      module: HubSpotModule;
      properties: Record<string, unknown>;
      title?: string;
    },
  ) {
    const propertyKeys = Object.keys(input.properties);
    if (!propertyKeys.length) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "HubSpot record creation needs at least one property.",
        status: 400,
      });
    }

    if (
      input.module === "contacts" &&
      !["email", "firstname", "lastname"].some((key) => input.properties[key] != null && String(input.properties[key]).trim())
    ) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "New HubSpot contacts need at least an email or a first/last name.",
        status: 400,
      });
    }

    if (
      input.module === "companies" &&
      !["name", "domain"].some((key) => input.properties[key] != null && String(input.properties[key]).trim())
    ) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "New HubSpot companies need at least a company name or domain.",
        status: 400,
      });
    }

    if (input.module === "deals" && !(input.properties["dealname"] != null && String(input.properties["dealname"]).trim())) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "New HubSpot deals need a deal name before Gideon can prepare the approval.",
        status: 400,
      });
    }

    const approval = await this.approvalService.createApproval({
      workspace: currentWorkspace.workspace,
      userId,
      title: input.title ?? `Create new HubSpot ${input.module} record`,
      reason: "Creating a new HubSpot CRM record requires approval.",
      type: "crm_create",
      preview: {
        module: input.module,
        properties: input.properties,
      },
      proposedAction: {
        toolName: "hubspot.createApproved",
        actionType: "hubspot_create",
        input,
        requiresApproval: true,
        riskLevel: "high",
      },
      riskLevel: "high",
      sourceRefs: [],
      idempotencyKey: createIdempotencyKey("hubspot_create", {
        module: input.module,
        properties: input.properties,
      }),
    });

    return { approvalId: approval.id };
  }

  async executeApprovedHubSpotCreate(
    currentWorkspace: CurrentWorkspace,
    _userId: string,
    input: {
      module: HubSpotModule;
      properties: Record<string, unknown>;
    },
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "hubspot");
    await this.assertHubSpotConnectionUsable(integration, "create HubSpot records");

    const hubspotProvider = this.createHubSpotProvider();
    const createdRecord = await hubspotProvider.createRecord(integration, {
      objectType: input.module,
      properties: input.properties,
    });
    const recordTitle =
      input.module === "contacts"
        ? `${createdRecord.properties?.["firstname"] ?? ""} ${createdRecord.properties?.["lastname"] ?? ""}`.trim() ||
          String(createdRecord.properties?.["email"] ?? "New contact")
        : input.module === "companies"
          ? String(createdRecord.properties?.["name"] ?? createdRecord.properties?.["domain"] ?? "New company")
          : String(createdRecord.properties?.["dealname"] ?? "New deal");

    await this.itemRepository.syncItems(integration, [
      {
        sourceType: hubspotSourceType(input.module),
        externalId: createdRecord.id,
        title: recordTitle,
        summary: compactJson(createdRecord.properties ?? {}).slice(0, 400),
        normalizedData: {
          ...createdRecord,
          module: input.module,
        },
      },
    ]);

    return {
      recordId: createdRecord.id,
      module: input.module,
      properties: createdRecord.properties ?? {},
      createdAt: createdRecord.createdAt ?? null,
    };
  }

  async prepareHubSpotNoteApproval(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: {
      module: "contacts" | "companies" | "deals";
      recordId: string;
      body: string;
      title?: string;
    },
  ) {
    const body = input.body.trim();
    if (!body) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "HubSpot note approvals need note content.",
        status: 400,
      });
    }

    const integration = await this.integrationService.requireConnection(currentWorkspace, "hubspot");
    await this.assertHubSpotConnectionUsable(integration, "prepare HubSpot note approval");
    const recordContext = await this.getHubSpotRecordSourceContext(currentWorkspace, integration, {
      module: input.module,
      recordId: input.recordId,
      fallbackTitle: `HubSpot ${input.module.slice(0, -1)}`,
    });

    const approval = await this.approvalService.createApproval({
      workspace: currentWorkspace.workspace,
      userId,
      title: input.title ?? `Add note to HubSpot ${input.module.slice(0, -1)}`,
      reason: "This HubSpot note will be written externally after approval.",
      type: "crm_create",
      preview: {
        module: input.module,
        recordId: input.recordId,
        recordTitle: recordContext.recordTitle,
        body,
      },
      proposedAction: {
        toolName: "hubspot.createNoteApproved",
        actionType: "hubspot_note_create",
        input: { ...input, body },
        requiresApproval: true,
        riskLevel: "medium",
      },
      riskLevel: "medium",
      sourceRefs: recordContext.sourceRefs,
      idempotencyKey: createIdempotencyKey("hubspot_note_create", {
        module: input.module,
        recordId: input.recordId,
        body,
      }),
    });

    return { approvalId: approval.id, sourceRefs: recordContext.sourceRefs };
  }

  async executeApprovedHubSpotNoteCreate(
    currentWorkspace: CurrentWorkspace,
    _userId: string,
    input: {
      module: "contacts" | "companies" | "deals";
      recordId: string;
      body: string;
    },
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "hubspot");
    await this.assertHubSpotConnectionUsable(integration, "create HubSpot notes");
    const createdNote = await this.createHubSpotProvider().createAssociatedNote(integration, {
      recordType: input.module,
      recordId: input.recordId,
      body: input.body,
    });

    await this.itemRepository.syncItems(integration, [
      {
        sourceType: "crm_note",
        externalId: createdNote.id,
        title: hubspotRecordTitle("notes", createdNote.properties),
        summary: hubspotContextSummary("notes", createdNote.properties),
        normalizedData: { ...createdNote, module: "notes" },
      },
    ]);

    return {
      recordId: createdNote.id,
      module: "notes" as const,
      properties: createdNote.properties ?? {},
      createdAt: createdNote.createdAt ?? null,
    };
  }

  async prepareHubSpotTaskCreateApproval(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: {
      module: "contacts" | "companies" | "deals";
      recordId: string;
      subject: string;
      body?: string;
      dueAt?: string;
      status?: string;
      priority?: string;
      title?: string;
    },
  ) {
    const subject = input.subject.trim();
    if (!subject) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "HubSpot task approvals need a task subject.",
        status: 400,
      });
    }

    const integration = await this.integrationService.requireConnection(currentWorkspace, "hubspot");
    await this.assertHubSpotConnectionUsable(integration, "prepare HubSpot task create approval");
    const recordContext = await this.getHubSpotRecordSourceContext(currentWorkspace, integration, {
      module: input.module,
      recordId: input.recordId,
      fallbackTitle: `HubSpot ${input.module.slice(0, -1)}`,
    });

    const approval = await this.approvalService.createApproval({
      workspace: currentWorkspace.workspace,
      userId,
      title: input.title ?? `Create follow-up task for ${input.module.slice(0, -1)}`,
      reason: "This HubSpot task will be created externally after approval.",
      type: "task_create",
      preview: {
        module: input.module,
        recordId: input.recordId,
        recordTitle: recordContext.recordTitle,
        subject,
        body: input.body ?? "",
        dueAt: input.dueAt ?? null,
        status: input.status ?? "NOT_STARTED",
        priority: input.priority ?? "MEDIUM",
      },
      proposedAction: {
        toolName: "hubspot.createTaskApproved",
        actionType: "hubspot_task_create",
        input: { ...input, subject },
        requiresApproval: true,
        riskLevel: "medium",
      },
      riskLevel: "medium",
      sourceRefs: recordContext.sourceRefs,
      idempotencyKey: createIdempotencyKey("hubspot_task_create", {
        module: input.module,
        recordId: input.recordId,
        subject,
        dueAt: input.dueAt ?? null,
      }),
    });

    return { approvalId: approval.id, sourceRefs: recordContext.sourceRefs };
  }

  async executeApprovedHubSpotTaskCreate(
    currentWorkspace: CurrentWorkspace,
    _userId: string,
    input: {
      module: "contacts" | "companies" | "deals";
      recordId: string;
      subject: string;
      body?: string;
      dueAt?: string;
      status?: string;
      priority?: string;
    },
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "hubspot");
    await this.assertHubSpotConnectionUsable(integration, "create HubSpot tasks");
    const createdTask = await this.createHubSpotProvider().createAssociatedTask(integration, {
      recordType: input.module,
      recordId: input.recordId,
      subject: input.subject,
      body: input.body,
      dueAt: input.dueAt,
      status: input.status,
      priority: input.priority,
    });

    await this.itemRepository.syncItems(integration, [
      {
        sourceType: "crm_task",
        externalId: createdTask.id,
        title: hubspotRecordTitle("tasks", createdTask.properties),
        summary: hubspotContextSummary("tasks", createdTask.properties),
        normalizedData: { ...createdTask, module: "tasks" },
      },
    ]);

    return {
      recordId: createdTask.id,
      module: "tasks" as const,
      properties: createdTask.properties ?? {},
      createdAt: createdTask.createdAt ?? null,
    };
  }

  async prepareHubSpotTaskUpdateApproval(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: {
      recordId: string;
      updates: Record<string, unknown>;
      title?: string;
    },
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "hubspot");
    await this.assertHubSpotConnectionUsable(integration, "prepare HubSpot task update approval");
    const cachedItem = await this.itemRepository.getByExternalId(currentWorkspace.id, integration.id, input.recordId, "crm_task");
    let recordTitle = cachedItem?.title ?? "HubSpot task";
    if (!cachedItem) {
      const taskRecord = await this.createHubSpotProvider().getRecord(integration, {
        objectType: "tasks",
        recordId: input.recordId,
      });
      recordTitle = hubspotRecordTitle("tasks", taskRecord.properties);
      await this.itemRepository.syncItems(integration, [
        {
          sourceType: "crm_task",
          externalId: taskRecord.id,
          title: recordTitle,
          summary: hubspotContextSummary("tasks", taskRecord.properties),
          normalizedData: { ...taskRecord, module: "tasks" },
        },
      ]);
    }
    const sourceRefs = toSourceRefs("hubspot", input.recordId, recordTitle);

    const approval = await this.approvalService.createApproval({
      workspace: currentWorkspace.workspace,
      userId,
      title: input.title ?? "Update HubSpot task",
      reason: "This HubSpot task change requires approval before Gideon writes to CRM.",
      type: "task_create",
      preview: {
        module: "tasks",
        recordId: input.recordId,
        recordTitle,
        updates: input.updates,
      },
      proposedAction: {
        toolName: "hubspot.updateTaskApproved",
        actionType: "hubspot_task_update",
        input,
        requiresApproval: true,
        riskLevel: "medium",
      },
      riskLevel: "medium",
      sourceRefs,
      idempotencyKey: createIdempotencyKey("hubspot_task_update", {
        recordId: input.recordId,
        updates: input.updates,
      }),
    });

    return { approvalId: approval.id, sourceRefs };
  }

  async executeApprovedHubSpotTaskUpdate(
    currentWorkspace: CurrentWorkspace,
    _userId: string,
    input: {
      recordId: string;
      updates: Record<string, unknown>;
    },
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "hubspot");
    await this.assertHubSpotConnectionUsable(integration, "update HubSpot tasks");
    const updatedTask = await this.createHubSpotProvider().updateTask(integration, input);

    await this.itemRepository.syncItems(integration, [
      {
        sourceType: "crm_task",
        externalId: updatedTask.id,
        title: hubspotRecordTitle("tasks", updatedTask.properties),
        summary: hubspotContextSummary("tasks", updatedTask.properties),
        normalizedData: { ...updatedTask, module: "tasks" },
      },
    ]);

    return {
      recordId: updatedTask.id,
      module: "tasks" as const,
      updatedProperties: updatedTask.properties ?? {},
      updatedAt: updatedTask.updatedAt ?? null,
      archived: Boolean(updatedTask.archived),
    };
  }

  async prepareHubSpotAssociationApproval(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: {
      module: "contacts" | "companies" | "deals";
      recordId: string;
      relatedModule: HubSpotModule;
      relatedRecordId: string;
      action: "add" | "remove";
      title?: string;
    },
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "hubspot");
    await this.assertHubSpotConnectionUsable(integration, "prepare HubSpot association approval");
    const recordContext = await this.getHubSpotRecordSourceContext(currentWorkspace, integration, {
      module: input.module,
      recordId: input.recordId,
      fallbackTitle: `HubSpot ${input.module.slice(0, -1)}`,
    });

    const approval = await this.approvalService.createApproval({
      workspace: currentWorkspace.workspace,
      userId,
      title:
        input.title ??
        `${input.action === "add" ? "Add" : "Remove"} ${input.relatedModule.slice(0, -1)} association`,
      reason: "This HubSpot association change requires approval before Gideon writes to CRM.",
      type: "crm_update",
      preview: {
        ...input,
        recordTitle: recordContext.recordTitle,
      },
      proposedAction: {
        toolName: "hubspot.updateAssociationApproved",
        actionType: "hubspot_association_update",
        input,
        requiresApproval: true,
        riskLevel: "medium",
      },
      riskLevel: "medium",
      sourceRefs: recordContext.sourceRefs,
      idempotencyKey: createIdempotencyKey("hubspot_association_update", input),
    });

    return { approvalId: approval.id, sourceRefs: recordContext.sourceRefs };
  }

  async executeApprovedHubSpotAssociationUpdate(
    currentWorkspace: CurrentWorkspace,
    _userId: string,
    input: {
      module: "contacts" | "companies" | "deals";
      recordId: string;
      relatedModule: HubSpotModule;
      relatedRecordId: string;
      action: "add" | "remove";
    },
  ) {
    const integration = await this.integrationService.requireConnection(currentWorkspace, "hubspot");
    await this.assertHubSpotConnectionUsable(integration, "update HubSpot associations");
    const result = await this.createHubSpotProvider().updateAssociation(integration, {
      fromObjectType: input.module,
      fromRecordId: input.recordId,
      toObjectType: input.relatedModule,
      toRecordId: input.relatedRecordId,
      action: input.action,
    });

    return result;
  }

  async createHubSpotRecordWorkflow(
    currentWorkspace: CurrentWorkspace,
    userId: string,
    input: { module: HubSpotModule; recordId: string },
  ) {
    await this.assertHubSpotConnectionUsable(
      await this.integrationService.requireConnection(currentWorkspace, "hubspot"),
      "create HubSpot workflows from selected records",
    );
    const workflow = await this.workflowService.createWorkflow({
      workspace: currentWorkspace.workspace,
      userId,
      name: `HubSpot follow-up: ${input.module} ${input.recordId}`,
      description: "Review a selected HubSpot record and prepare a follow-up path.",
      type: "custom",
      trigger: { type: "manual" },
      steps: buildWorkflowStepsForIntegration(
        "Summarize the selected HubSpot record and prepare the next best follow-up.",
        "hubspot",
        input.recordId,
        input.module,
      ),
      approvalPolicy: { default: "external_only" },
      notificationPolicy: { channel: "in_app" },
    });

    return { workflowId: workflow.id, name: workflow.name };
  }
}
