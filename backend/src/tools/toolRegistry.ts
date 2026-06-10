import { createHash } from "node:crypto";

import type { Request } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { createTool as tool, type GideonTool } from "./toolShim.js";
import { z } from "zod";

import { ApprovalService } from "../approvals/approvalService.js";
import { ArtifactService } from "../artifacts/artifactService.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { NotificationService } from "../notifications/notificationService.js";
import type { RiskLevel, SourceRef, Workspace } from "../schemas/toolTypes.js";
import type { WorkflowStep } from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";
import { ClaimSafetyService } from "../ai/safety/claimSafetyService.js";
import { IntegrationWorkspaceService } from "../integrations/integrationWorkspaceService.js";
import { WebIntelligenceService } from "../web/webIntelligenceService.js";
import { ExaSearchProvider } from "../web/providers/exaSearchProvider.js";
import { ExaResearchProvider, ResearchTimeoutError } from "../web/providers/exaResearchProvider.js";
import { ExaWebsetsProvider } from "../web/providers/exaWebsetsProvider.js";
import { JobLockService } from "../jobs/jobLockService.js";
import { createLlmProvider } from "../ai/providers/providerRegistry.js";
import { mapEnrichment } from "../integrations/providers/hubspot/crmFieldMap.js";
import { WorkflowService } from "../workflows/workflowService.js";

export type ToolExecutionContext = {
  db: Firestore;
  currentWorkspace: CurrentWorkspace;
  userId: string;
  sourceRefs?: SourceRef[];
  contextPacket?: import("../schemas/toolTypes.js").ToolContextPacket;
  request?: Request;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  permissionsRequired: string[];
  capabilitiesRequired: string[];
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  idempotencyRequired: boolean;
  exposedToPlanner?: boolean;
  buildTool: (context: ToolExecutionContext) => GideonTool;
};

const artifactCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  artifactType: z.enum(["report", "draft", "summary", "data", "document"]).default("summary"),
  content: z.string().trim().min(1),
  creationSource: z
    .enum([
      "manual",
      "command_explicit",
      "workflow_step",
      "monitor",
      "integration_workspace",
      "saved_response_promotion",
      "legacy_unknown",
    ])
    .optional(),
  sourceSessionId: z.string().trim().min(1).optional(),
  sourceAssistantMessageId: z.string().trim().min(1).optional(),
});

const approvalCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(400),
  type: z.enum(["email_send", "crm_update", "crm_create", "slack_message", "task_create", "other"]),
  preview: z.record(z.string(), z.unknown()).default({}),
  actionType: z.string().trim().min(1),
  toolName: z.string().trim().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("high"),
});

const notificationCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(400).optional(),
  actionUrl: z.string().trim().min(1).optional(),
});

const mockLeadInputSchema = z.object({
  company: z.string().trim().min(1),
  contactName: z.string().trim().min(1),
  email: z.string().email().optional(),
  notes: z.string().trim().min(1).optional(),
});

const mockEmailDraftInputSchema = z.object({
  to: z.string().email(),
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

const webResearchTaskInputSchema = z.object({
  prompt: z.string().trim().min(1),
  processor: z.enum(["lite", "base", "core", "pro", "ultra"]).default("core"),
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
  pollTimeoutSeconds: z.number().int().positive().max(300).optional(),
  maxPollAttempts: z.number().int().positive().max(150).optional(),
  pollIntervalMs: z.number().int().positive().max(10000).optional(),
});

const webExtractUrlInputSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(10),
  objective: z.string().trim().min(1).optional(),
  searchQueries: z.array(z.string().trim().min(1)).max(5).optional(),
  includeFullContent: z.boolean().default(false),
  sessionId: z.string().trim().min(1).optional(),
});

const webFindSimilarInputSchema = z.object({
  url: z.string().url(),
  numResults: z.number().int().min(1).max(20).optional(),
});

const webDeepResearchInputSchema = z.object({
  query: z.string().trim().min(1),
  effort: z.enum(["low", "medium", "high"]).optional(),
});

const crmEnrichEntityInputSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    domain: z.string().trim().min(1).optional(),
    recordId: z.string().trim().min(1).optional(),
    module: z.enum(["companies", "contacts"]).optional(),
    fields: z.array(z.string().trim().min(1)).max(15).optional(),
  })
  .refine((value) => Boolean(value.name || value.domain), {
    message: "Provide a name or domain to enrich.",
  });

const leadsBuildDatasetInputSchema = z.object({
  query: z.string().trim().min(1),
  count: z.number().int().min(1).max(50).optional(),
  entity: z.enum(["company", "person"]).optional(),
  enrichments: z
    .array(
      z.object({
        description: z.string().trim().min(1),
        format: z.enum(["text", "number", "email", "url", "date"]).optional(),
      }),
    )
    .max(10)
    .optional(),
});

const webExtractStructuredInputSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(10),
  objective: z.string().trim().min(1).optional(),
  schemaName: z.string().trim().min(1),
  schemaVersion: z.string().trim().min(1),
  fields: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        description: z.string().trim().min(1),
        required: z.boolean().optional(),
      }),
    )
    .min(1),
});

const webMonitorCheckInputSchema = z.object({
  targetType: z.enum(["url", "keyword", "company", "person"]),
  target: z.string().trim().min(1),
  objective: z.string().trim().min(1).optional(),
  processor: z.enum(["base", "core", "pro", "ultra"]).default("core"),
});

const workflowGenerateInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  triggerType: z.enum(["manual", "schedule", "integration_event"]).default("manual"),
  cron: z.string().optional(),
  steps: z.array(z.object({
    type: z.enum([
      "context",
      "agent",
      "tool",
      "approval",
      "action",
      "notification",
      "artifact",
      "monitor",
      "conditional",
      "fetch_url",
      "integration.read",
      "integration.action",
    ]),
    name: z.string(),
    config: z.record(z.string(), z.unknown())
      })).describe(
        "The steps of the workflow. Design a logical, complete pipeline that fully achieves the user's goal. Ensure all necessary steps (e.g., retrieving data, processing it, and notifying the user) are included without adding unnecessary bloat. " +
        "CRITICAL MAPPING RULES for Supported Step Types (DO NOT use 'tool' or 'action' types): " +
        "1. For AI tasks, research, search, or generation: use type='agent' and config={ task: 'detailed instructions', agentId: 'auto' }. " +
        "2. For fetching a specific URL: use type='fetch_url' and config={ url: 'https...', objective: 'what to extract' }. " +
        "3. For email notifications: use type='notification' and config={ channel: 'email' }. " +
        "4. For saving a report/summary: use type='artifact' and config={ artifactType: 'report', title: '...' }. " +
        "5. For monitoring a topic/URL: use type='monitor' and config={ targetType: 'keyword', target: '...', objective: '...' }. " +
        "6. For scheduled workflows, NEVER use {{variables}} in configs as they cannot be provided during automated runs. " +
        "NEVER invent unsupported step types or configurations."
      ),
});

const gmailSearchThreadsInputSchema = z.object({
  query: z.string().trim().optional(),
  maxResults: z.number().int().positive().max(20).optional(),
});

const gmailThreadInputSchema = z.object({
  threadId: z.string().trim().min(1),
});

const gmailDraftInputSchema = z.object({
  threadId: z.string().trim().min(1).optional(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1).optional(),
  tone: z.string().trim().min(1).optional(),
});

const gmailDraftReplyInputSchema = z.object({
  threadId: z.string().trim().min(1),
  tone: z.string().trim().min(1).optional(),
});

const gmailSendApprovedInputSchema = gmailDraftInputSchema.extend({
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

const hubspotModuleSchema = z.enum(["contacts", "companies", "deals", "notes", "tasks"]);
const hubspotWritableRecordModuleSchema = z.enum(["contacts", "companies", "deals"]);

const hubspotSearchInputSchema = z.object({
  query: z.string().trim().optional(),
  module: hubspotModuleSchema,
  maxResults: z.number().int().positive().max(20).optional(),
});

const hubspotRecordInputSchema = z.object({
  module: hubspotModuleSchema,
  recordId: z.string().trim().min(1),
});

const hubspotUpdateApprovalInputSchema = z.object({
  module: hubspotWritableRecordModuleSchema,
  recordId: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  updates: z.record(z.string(), z.unknown()),
});

const hubspotUpdateApprovedInputSchema = hubspotUpdateApprovalInputSchema;

const hubspotCreateApprovalInputSchema = z.object({
  module: hubspotWritableRecordModuleSchema,
  title: z.string().trim().min(1).optional(),
  properties: z.record(z.string(), z.unknown()),
});

const hubspotCreateApprovedInputSchema = hubspotCreateApprovalInputSchema;

const hubspotNoteApprovalInputSchema = z.object({
  module: hubspotWritableRecordModuleSchema,
  recordId: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1),
});

const hubspotNoteApprovedInputSchema = hubspotNoteApprovalInputSchema;

const hubspotTaskCreateApprovalInputSchema = z.object({
  module: hubspotWritableRecordModuleSchema,
  recordId: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(1),
  body: z.string().trim().optional(),
  dueAt: z.string().trim().optional(),
  status: z.string().trim().optional(),
  priority: z.string().trim().optional(),
});

const hubspotTaskCreateApprovedInputSchema = hubspotTaskCreateApprovalInputSchema;

const hubspotTaskUpdateApprovalInputSchema = z.object({
  recordId: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  updates: z.record(z.string(), z.unknown()),
});

const hubspotTaskUpdateApprovedInputSchema = hubspotTaskUpdateApprovalInputSchema;

const hubspotAssociationApprovalInputSchema = z.object({
  module: hubspotWritableRecordModuleSchema,
  recordId: z.string().trim().min(1),
  relatedModule: hubspotModuleSchema,
  relatedRecordId: z.string().trim().min(1),
  action: z.enum(["add", "remove"]).default("add"),
  title: z.string().trim().min(1).optional(),
});

const hubspotAssociationApprovedInputSchema = hubspotAssociationApprovalInputSchema;

function ensureIdempotencyKey(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function artifactTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      const service = new ArtifactService(context.db);
      const artifact = await service.createArtifact({
        workspace: context.currentWorkspace.workspace,
        userId: context.userId,
        title: input.title,
        artifactType: input.artifactType,
        content: input.content,
        sourceRefs: context.sourceRefs ?? [],
        creationSource: input.creationSource,
        sourceSessionId: input.sourceSessionId,
        sourceAssistantMessageId: input.sourceAssistantMessageId,
      });

      return {
        status: "completed",
        artifactId: artifact.id,
        message: `Artifact created: ${artifact.title}`,
      };
    },
    {
      name: "artifact.create",
      description: "Save a workspace artifact for a command, workflow, or structured output.",
      schema: artifactCreateInputSchema,
    },
  );
}

function approvalTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      const service = new ApprovalService(context.db);
      const approval = await service.createApproval({
        workspace: context.currentWorkspace.workspace,
        userId: context.userId,
        title: input.title,
        reason: input.reason,
        type: input.type,
        preview: input.preview,
        riskLevel: input.riskLevel,
        sourceRefs: context.sourceRefs ?? [],
        idempotencyKey: ensureIdempotencyKey(input),
        proposedAction: {
          toolName: input.toolName,
          actionType: input.actionType,
          input: input.input,
          requiresApproval: true,
          riskLevel: input.riskLevel,
        },
      });

      return {
        status: "completed",
        approvalId: approval.id,
        message: `Approval created: ${approval.title}`,
      };
    },
    {
      name: "approval.create",
      description: "Create an approval record for a risky or external write action.",
      schema: approvalCreateInputSchema,
    },
  );
}

function notificationTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      const service = new NotificationService(context.db);
      const notification = await service.createNotification({
        workspaceId: context.currentWorkspace.id,
        userId: context.userId,
        type: "report_ready",
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
      });

      return {
        status: "completed",
        notificationId: notification.id,
        message: `Notification created: ${notification.title}`,
      };
    },
    {
      name: "notification.create",
      description: "Create an in-app notification for the current workspace user.",
      schema: notificationCreateInputSchema,
    },
  );
}

function mockCrmTool() {
  return tool(
    async (input) => ({
      status: "mocked",
      message: `CRM mock tool captured ${input.contactName} at ${input.company}.`,
    }),
    {
      name: "crm.createLead.mock",
      description: "Placeholder CRM lead creation tool used before live CRM integrations exist.",
      schema: mockLeadInputSchema,
    },
  );
}

function mockEmailDraftTool() {
  return tool(
    async (input) => ({
      status: "mocked",
      draft: {
        to: input.to,
        subject: input.subject,
        body: input.body,
      },
      message: `Email draft prepared for ${input.to}.`,
    }),
    {
      name: "email.createDraft.mock",
      description: "Placeholder email draft tool used before live Gmail draft creation is enabled.",
      schema: mockEmailDraftInputSchema,
    },
  );
}

function buildWorkflowDraftSteps(agentId: string, task: string): WorkflowStep[] {
  return [
    {
      id: "context_workspace_snapshot",
      type: "context",
      name: "Gather cached workspace context",
      order: 0,
      config: { sources: ["contextBundles", "activity", "artifacts"] },
    },
    {
      id: "agent_review",
      type: "agent",
      name: "Assigned assistant prepares the workflow task",
      order: 1,
      config: { agentId, task },
    },
    {
      id: "approval_gate",
      type: "approval",
      name: "Require approval before write actions",
      order: 2,
      config: { policy: "external_only" },
    },
    {
      id: "notify_user",
      type: "notification",
      name: "Notify in app",
      order: 3,
      config: { channel: "in_app" },
    },
  ];
}

function webResearchTaskTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      const service = new WebIntelligenceService(context.db);
      const result = await service.runResearchTask({
        currentWorkspace: context.currentWorkspace,
        userId: context.userId,
        prompt: input.prompt,
        processor: input.processor,
        depth: input.depth,
        pollTimeoutSeconds: input.pollTimeoutSeconds,
        maxPollAttempts: input.maxPollAttempts,
        pollIntervalMs: input.pollIntervalMs,
        activitySource: "tool",
        contextPacket: context.contextPacket,
        request: context.request,
      });

      return {
        status: result.fromCache ? "cached" : "completed",
        provider: result.provider,
        taskRunId: result.taskRunId ?? null,
        content: result.content,
        contentText: result.contentText,
        sourceRefs: result.sourceRefs,
        citations: result.citations,
        confidence: result.confidence ?? null,
        completeness: result.completeness ?? null,
        freshness: result.freshness,
        failedSources: result.failedSources,
        partialResult: result.partialResult === true,
      };
    },
    {
      name: "web.researchTask",
      description: "Run source-backed public web research using the default research provider.",
      schema: webResearchTaskInputSchema,
    },
  );
}

function webExtractUrlTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      const service = new WebIntelligenceService(context.db);
      const result = await service.extractUrl({
        currentWorkspace: context.currentWorkspace,
        userId: context.userId,
        urls: input.urls,
        objective: input.objective,
        searchQueries: input.searchQueries,
        includeFullContent: input.includeFullContent,
        sessionId: input.sessionId,
        activitySource: "tool",
        contextPacket: context.contextPacket,
        request: context.request,
      });

      return {
        status: result.fromCache ? "cached" : "completed",
        provider: result.provider,
        url: result.url,
        title: result.title ?? null,
        publishDate: result.publishDate ?? null,
        excerpts: result.excerpts,
        fullContent: result.fullContent ?? null,
        sessionId: result.sessionId ?? null,
        sourceRefs: result.sourceRefs,
      };
    },
    {
      name: "web.extractUrl",
      description: "Extract LLM-ready content from one or more known public URLs.",
      schema: webExtractUrlInputSchema,
    },
  );
}

function crmEnrichEntityTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      void context;
      const module = input.module ?? "companies";
      const label = input.name ?? input.domain ?? "";
      const fields =
        input.fields?.length
          ? input.fields
          : module === "companies"
            ? ["industry", "employees", "domain", "description"]
            : ["email", "jobtitle", "company", "linkedin"];

      const query = `${label}${module === "companies" ? " company" : ""} — ${fields.join(", ")}`.trim();
      const searchResult = await new ExaSearchProvider().search({ query });

      const extractionSchema = z.object({
        fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]).nullable()),
      });
      const extracted = await createLlmProvider("fast").generateStructured({
        schema: extractionSchema,
        systemPrompt:
          "You extract structured facts about a business entity from web content. Only use facts present in the content; use null when a field is unknown.",
        userPrompt: `Entity: ${label}\nExtract these fields: ${fields.join(", ")}\n\nWeb content:\n${searchResult.content}\n\nReturn a JSON object 'fields' mapping each requested field name to its extracted value (or null).`,
      });

      const rawFields = (extracted as { fields?: Record<string, unknown> }).fields ?? {};
      const { properties, unmapped } = mapEnrichment(module, rawFields);

      return {
        entity: {
          name: input.name ?? null,
          domain: input.domain ?? null,
          recordId: input.recordId ?? null,
          module,
        },
        properties,
        unmapped,
        sourceRefs: searchResult.sourceRefs,
      };
    },
    {
      name: "crm.enrichEntity",
      description:
        "Enrich a single company or person with web data (via Exa) and return fields mapped to HubSpot properties, ready to propose as a CRM update. Pass the entity name/domain (and recordId to target an existing record).",
      schema: crmEnrichEntityInputSchema,
    },
  );
}

function leadsBuildDatasetTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      const { websetId } = await new ExaWebsetsProvider().create({
        query: input.query,
        count: input.count,
        entity: input.entity,
        enrichments: input.enrichments,
      });
      const label = input.query.length > 80 ? `${input.query.slice(0, 77)}…` : input.query;
      await new JobLockService(context.db).enqueueJob({
        workspaceId: context.currentWorkspace.id,
        jobType: "exa_webset_poll",
        userId: context.userId,
        input: { websetId, label, entity: input.entity ?? "company", query: input.query },
      });
      return {
        status: "started",
        websetId,
        message: `Building your enriched dataset "${label}" — I'll save it to your Library and notify you when it's ready.`,
      };
    },
    {
      name: "leads.buildDataset",
      description:
        "Build an enriched lead dataset (companies or people) from the web using Exa Websets. Runs in the background; saves a dataset to the Library and notifies when ready. Specify enrichment columns (e.g. funding, employee count, CEO email).",
      schema: leadsBuildDatasetInputSchema,
    },
  );
}

function webDeepResearchTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      void context;
      try {
        const result = await new ExaResearchProvider().research({
          query: input.query,
          effort: input.effort ?? "low",
        });
        return {
          status: "completed",
          report: result.text,
          structured: result.structured ?? null,
          sourceRefs: result.sourceRefs,
        };
      } catch (error) {
        const isTimeout =
          error instanceof ResearchTimeoutError ||
          (error instanceof Error && error.name === "ResearchTimeoutError");
        if (isTimeout) {
          return {
            status: "running",
            report: "",
            message:
              "Deep research is taking longer than expected. Summarize what you already know and suggest the user narrow the question or try again shortly.",
            sourceRefs: [],
          };
        }
        throw error;
      }
    },
    {
      name: "web.deepResearch",
      description:
        "Run deep, multi-source research on a topic and return a synthesized report (optionally structured). Use for thorough analysis beyond a quick search.",
      schema: webDeepResearchInputSchema,
    },
  );
}

function webFindSimilarTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      void context;
      const sourceRefs = await new ExaSearchProvider().findSimilar(input.url, input.numResults);
      return {
        status: "completed",
        url: input.url,
        count: sourceRefs.length,
        sourceRefs,
      };
    },
    {
      name: "web.findSimilar",
      description: "Discover web pages similar/related to a known URL (related-source enrichment).",
      schema: webFindSimilarInputSchema,
    },
  );
}

function webExtractStructuredTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      const service = new WebIntelligenceService(context.db);
      const result = await service.extractStructured({
        currentWorkspace: context.currentWorkspace,
        userId: context.userId,
        urls: input.urls,
        objective: input.objective,
        schemaName: input.schemaName,
        schemaVersion: input.schemaVersion,
        fields: input.fields,
        request: context.request,
      });

      return {
        status: result.fromCache ? "cached" : "completed",
        provider: result.provider ?? "reasoning_extract",
        schemaName: result.schemaName,
        schemaVersion: result.schemaVersion,
        output: result.output,
        sourceRefs: result.sourceRefs,
      };
    },
    {
      name: "web.extractStructured",
      description: "Extract structured facts from known public URLs using extraction plus schema shaping.",
      schema: webExtractStructuredInputSchema,
    },
  );
}

function webMonitorCheckTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      const service = new WebIntelligenceService(context.db);
      return service.monitorCheck({
        currentWorkspace: context.currentWorkspace,
        userId: context.userId,
        targetType: input.targetType,
        target: input.target,
        objective: input.objective,
        processor: input.processor,
        request: context.request,
      });
    },
    {
      name: "web.monitorCheck",
      description: "Check whether a monitored public URL, company, person, or topic has meaningfully changed.",
      schema: webMonitorCheckInputSchema,
    },
  );
}

function workflowGenerateTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      const service = new WorkflowService(context.db);
      
      const steps = input.steps.map((step, index) => ({
        id: `step-${index + 1}-${Date.now()}`,
        type: step.type,
        name: step.name,
        config: step.config,
        order: index + 1,
      }));

      const workflow = await service.createWorkflow({
        workspace: context.currentWorkspace.workspace,
        userId: context.userId,
        name: input.name,
        description: input.description,
        type: "custom",
        trigger: { 
          type: input.triggerType === "schedule" ? "schedule" : "manual",
          config: input.triggerType === "schedule" ? { cron: input.cron || "0 9 * * *" } : {} 
        },
        steps,
        approvalPolicy: { default: "external_only" },
        notificationPolicy: { channel: "in_app" },
      });

      return {
        status: "completed",
        workflowId: workflow.id,
        name: workflow.name,
        triggerType: input.triggerType,
        stepCount: workflow.steps.length,
        message: `Workflow created: ${workflow.name}`,
        workflow,
      };
    },
    {
      name: "workflow.generate",
      description: "Generate and create a fully configured custom workflow with dynamic steps based on user requirements.",
      schema: workflowGenerateInputSchema,
    },
  );
}

function gmailSearchThreadsTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      const service = new IntegrationWorkspaceService(context.db);
      const result = await service.getWorkspaceData(
        context.currentWorkspace,
        context.userId,
        "gmail",
        { query: input.query, module: undefined, maxResults: input.maxResults },
      );

      return {
        status: "completed",
        threads: Array.isArray(result.list) ? result.list : [],
      };
    },
    {
      name: "gmail.searchThreads",
      description: "Search recent Gmail threads in the connected workspace inbox.",
      schema: gmailSearchThreadsInputSchema,
    },
  );
}

function gmailReadThreadTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      const service = new IntegrationWorkspaceService(context.db);
      const result = await service.getSelectedItemDetail(context.currentWorkspace, context.userId, "gmail", {
        itemId: input.threadId,
      });

      return {
        status: "completed",
        thread: result.detail,
        contextBundleId: result.contextBundleId,
        sourceRefs: result.sourceRefs,
      };
    },
    {
      name: "gmail.readThread",
      description: "Read the full contents of a selected Gmail thread.",
      schema: gmailThreadInputSchema,
    },
  );
}

function gmailSummarizeThreadTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).summarizeGmailThread(
      context.currentWorkspace,
      context.userId,
      input.threadId,
    ),
    {
      name: "gmail.summarizeThread",
      description: "Summarize a selected Gmail thread with key points and reply focus.",
      schema: gmailThreadInputSchema,
    },
  );
}

function gmailExtractActionItemsTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).extractGmailActionItems(
      context.currentWorkspace,
      context.userId,
      input.threadId,
    ),
    {
      name: "gmail.extractActionItems",
      description: "Extract action items from a selected Gmail thread.",
      schema: gmailThreadInputSchema,
    },
  );
}

function gmailDraftReplyTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).draftGmailReply(
      context.currentWorkspace,
      context.userId,
      input.threadId,
      input.tone,
    ),
    {
      name: "gmail.draftReply",
      description: "Draft a reply to a Gmail thread without sending it.",
      schema: gmailDraftReplyInputSchema,
    },
  );
}

function gmailCreateDraftTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).createGmailDraft(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "gmail.createDraft",
      description: "Create a Gmail draft object for a prepared reply.",
      schema: gmailDraftInputSchema,
    },
  );
}

function gmailSendApprovedTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).executeApprovedGmailSend(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "gmail.sendApproved",
      description: "Send an approved Gmail reply externally using the connected mailbox.",
      schema: gmailSendApprovedInputSchema,
    },
  );
}

function gmailPrepareSendApprovalTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      if (input.body) {
        const safetyService = new ClaimSafetyService();
        const contextStr = [
          context.contextPacket?.workspaceContext,
          context.contextPacket?.sessionContext,
          context.contextPacket?.selectedItemContext,
          context.contextPacket?.retrievedContext
        ].filter(Boolean).join("\n\n");
        
        const safety = await safetyService.verifyDraftSafety(input.body, contextStr);
        if (!safety.isSafe) {
          throw new Error(`Safety Guardrail Blocked Approval: The drafted body contains fabricated claims or unsupported facts. Violations: ${safety.violatingClaims.join(", ")}. Please rewrite the draft relying only on provided context.`);
        }
      }
      return new IntegrationWorkspaceService(context.db).prepareGmailSendApproval(
        context.currentWorkspace,
        context.userId,
        input,
      );
    },
    {
      name: "gmail.prepareSendApproval",
      description: "Create an approval before Gideon sends a Gmail reply externally.",
      schema: gmailDraftInputSchema,
    },
  );
}

function gmailSaveThreadSummaryTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).saveGmailThreadSummary(
      context.currentWorkspace,
      context.userId,
      input.threadId,
    ),
    {
      name: "gmail.saveThreadSummary",
      description: "Save a Gmail thread summary into the Library.",
      schema: gmailThreadInputSchema,
    },
  );
}

function gmailCreateFollowUpWorkflowTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).createGmailFollowUpWorkflow(
      context.currentWorkspace,
      context.userId,
      input.threadId,
    ),
    {
      name: "gmail.createFollowUpWorkflow",
      description: "Create a workflow draft from the selected Gmail thread.",
      schema: gmailThreadInputSchema,
    },
  );
}

function hubspotSearchRecordsTool(context: ToolExecutionContext, module: z.infer<typeof hubspotModuleSchema>, name: string, description: string) {
  return tool(
    async (input) => {
      const result = await new IntegrationWorkspaceService(context.db).getWorkspaceData(
        context.currentWorkspace,
        context.userId,
        "hubspot",
        { query: input.query, module, maxResults: input.maxResults },
      );
      return {
        status: "completed",
        module,
        records: Array.isArray(result.list) ? result.list : [],
      };
    },
    {
      name,
      description,
      schema: hubspotSearchInputSchema.pick({ query: true, maxResults: true }).extend({ module: z.literal(module) }),
    },
  );
}

function hubspotReadRecordTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      const result = await new IntegrationWorkspaceService(context.db).getSelectedItemDetail(
        context.currentWorkspace,
        context.userId,
        "hubspot",
        { itemId: input.recordId, module: input.module },
      );
      return {
        status: "completed",
        module: input.module,
        record: result.detail,
        contextBundleId: result.contextBundleId,
        sourceRefs: result.sourceRefs,
      };
    },
    {
      name: "hubspot.readRecord",
      description: "Read a HubSpot contact, company, or deal record.",
      schema: hubspotRecordInputSchema,
    },
  );
}

function hubspotSummarizeRecordTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).summarizeHubSpotRecord(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.summarizeRecord",
      description: "Summarize a HubSpot contact, company, or deal record.",
      schema: hubspotRecordInputSchema,
    },
  );
}

function hubspotCreateNoteDraftTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).createHubSpotNoteDraft(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.createNoteDraft",
      description: "Create an internal note draft artifact from a HubSpot record without writing to HubSpot.",
      schema: hubspotRecordInputSchema,
    },
  );
}

function hubspotPrepareNoteApprovalTool(context: ToolExecutionContext) {
  return tool(
    async (input) => {
      if (input.body) {
        const safetyService = new ClaimSafetyService();
        const contextStr = [
          context.contextPacket?.workspaceContext,
          context.contextPacket?.sessionContext,
          context.contextPacket?.selectedItemContext,
          context.contextPacket?.retrievedContext
        ].filter(Boolean).join("\n\n");
        
        const safety = await safetyService.verifyDraftSafety(input.body, contextStr);
        if (!safety.isSafe) {
          throw new Error(`Safety Guardrail Blocked Approval: The drafted note contains fabricated claims or unsupported facts. Violations: ${safety.violatingClaims.join(", ")}. Please rewrite the note relying only on provided context.`);
        }
      }
      return new IntegrationWorkspaceService(context.db).prepareHubSpotNoteApproval(
        context.currentWorkspace,
        context.userId,
        input,
      );
    },
    {
      name: "hubspot.prepareNoteApproval",
      description: "Create an approval draft before writing a real note to HubSpot.",
      schema: hubspotNoteApprovalInputSchema,
    },
  );
}

function hubspotCreateNoteApprovedTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).executeApprovedHubSpotNoteCreate(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.createNoteApproved",
      description: "Execute a previously approved HubSpot note creation.",
      schema: hubspotNoteApprovedInputSchema,
    },
  );
}

function hubspotPrepareUpdateApprovalTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).prepareHubSpotUpdateApproval(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.prepareUpdateApproval",
      description: "Create an approval draft before updating an existing HubSpot record. Required fields: module (MUST be exactly 'contacts', 'companies', or 'deals' — never singular), recordId (exact numeric ID from tool results), updates (object of property key→value pairs to change, e.g. {\"jobtitle\": \"Secretary\"}). Do NOT use 'properties' — it must be 'updates'.",
      schema: hubspotUpdateApprovalInputSchema,
    },
  );
}

function hubspotUpdateApprovedTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).executeApprovedHubSpotUpdate(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.updateApproved",
      description: "Execute a previously approved HubSpot CRM update.",
      schema: hubspotUpdateApprovedInputSchema,
    },
  );
}

function hubspotPrepareCreateApprovalTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).prepareHubSpotCreateApproval(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.prepareCreateApproval",
      description: "Create an approval draft before creating a new HubSpot record. Required fields: module (MUST be exactly 'contacts', 'companies', or 'deals' — never singular), properties (object of HubSpot property key→value pairs, e.g. {\"firstname\": \"Jane\", \"lastname\": \"Smith\", \"email\": \"jane@acme.com\"}). Do NOT use 'updates' — it must be 'properties'.",
      schema: hubspotCreateApprovalInputSchema,
    },
  );
}

function hubspotCreateApprovedTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).executeApprovedHubSpotCreate(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.createApproved",
      description: "Execute a previously approved HubSpot CRM record creation.",
      schema: hubspotCreateApprovedInputSchema,
    },
  );
}

function hubspotPrepareTaskCreateApprovalTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).prepareHubSpotTaskCreateApproval(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.prepareTaskCreateApproval",
      description: "Create an approval draft before creating a HubSpot task.",
      schema: hubspotTaskCreateApprovalInputSchema,
    },
  );
}

function hubspotCreateTaskApprovedTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).executeApprovedHubSpotTaskCreate(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.createTaskApproved",
      description: "Execute a previously approved HubSpot task creation.",
      schema: hubspotTaskCreateApprovedInputSchema,
    },
  );
}

function hubspotPrepareTaskUpdateApprovalTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).prepareHubSpotTaskUpdateApproval(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.prepareTaskUpdateApproval",
      description: "Create an approval draft before updating a HubSpot task.",
      schema: hubspotTaskUpdateApprovalInputSchema,
    },
  );
}

function hubspotUpdateTaskApprovedTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).executeApprovedHubSpotTaskUpdate(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.updateTaskApproved",
      description: "Execute a previously approved HubSpot task update.",
      schema: hubspotTaskUpdateApprovedInputSchema,
    },
  );
}

function hubspotPrepareAssociationApprovalTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).prepareHubSpotAssociationApproval(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.prepareAssociationApproval",
      description: "Create an approval draft before adding or removing a HubSpot association.",
      schema: hubspotAssociationApprovalInputSchema,
    },
  );
}

function hubspotUpdateAssociationApprovedTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).executeApprovedHubSpotAssociationUpdate(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.updateAssociationApproved",
      description: "Execute a previously approved HubSpot association change.",
      schema: hubspotAssociationApprovedInputSchema,
    },
  );
}

function hubspotDraftFollowUpTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).draftHubSpotFollowUp(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.draftFollowUp",
      description: "Draft follow-up text from a HubSpot record without sending or writing externally.",
      schema: hubspotRecordInputSchema,
    },
  );
}

function hubspotCreateRecordWorkflowTool(context: ToolExecutionContext) {
  return tool(
    async (input) => new IntegrationWorkspaceService(context.db).createHubSpotRecordWorkflow(
      context.currentWorkspace,
      context.userId,
      input,
    ),
    {
      name: "hubspot.createRecordWorkflow",
      description: "Create a workflow draft from a HubSpot record.",
      schema: hubspotRecordInputSchema,
    },
  );
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "gmail.searchThreads",
    description: "Search recent Gmail threads in the connected workspace inbox.",
    inputSchema: gmailSearchThreadsInputSchema,
    outputSchema: z.object({
      status: z.string(),
      threads: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["email.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: gmailSearchThreadsTool,
  },
  {
    name: "gmail.readThread",
    description: "Read a Gmail thread.",
    inputSchema: gmailThreadInputSchema,
    outputSchema: z.object({
      status: z.string(),
      thread: z.record(z.string(), z.unknown()),
      contextBundleId: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["email.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: gmailReadThreadTool,
  },
  {
    name: "gmail.summarizeThread",
    description: "Summarize a Gmail thread.",
    inputSchema: gmailThreadInputSchema,
    outputSchema: z.object({
      summary: z.string(),
      keyPoints: z.array(z.string()),
      suggestedReplyFocus: z.array(z.string()),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
      contextBundleId: z.string(),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["email.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: gmailSummarizeThreadTool,
  },
  {
    name: "gmail.extractActionItems",
    description: "Extract action items from a Gmail thread.",
    inputSchema: gmailThreadInputSchema,
    outputSchema: z.object({
      summary: z.string(),
      actionItems: z.array(z.record(z.string(), z.unknown())),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
      contextBundleId: z.string(),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["email.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: gmailExtractActionItemsTool,
  },
  {
    name: "gmail.draftReply",
    description: "AI-draft a reply body for an existing Gmail thread. Use when you have a threadId and need to compose a reply.",
    inputSchema: gmailDraftReplyInputSchema,
    outputSchema: z.object({
      subject: z.string(),
      body: z.string(),
      rationale: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
      contextBundleId: z.string(),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["email.read", "email.draft"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: gmailDraftReplyTool,
  },
  {
    name: "gmail.createDraft",
    description: "Create a Gmail draft object from prepared content.",
    inputSchema: gmailDraftInputSchema,
    outputSchema: z.object({
      draftId: z.string().nullable(),
      messageId: z.string().nullable(),
      subject: z.string(),
      body: z.string(),
      to: z.array(z.string()),
      cc: z.array(z.string()),
    }),
    permissionsRequired: ["integrations.write"],
    capabilitiesRequired: ["email.draft"],
    riskLevel: "medium",
    requiresApproval: false,
    idempotencyRequired: true,
    buildTool: gmailCreateDraftTool,
  },
  {
    name: "gmail.sendApproved",
    description: "Execute an already-approved Gmail send action.",
    inputSchema: gmailSendApprovedInputSchema,
    outputSchema: z.object({
      messageId: z.string().nullable(),
      threadId: z.string().nullable(),
      labelIds: z.array(z.string()),
      subject: z.string(),
      body: z.string(),
      to: z.array(z.string()),
      cc: z.array(z.string()),
    }),
    permissionsRequired: ["integrations.write"],
    capabilitiesRequired: ["email.send"],
    riskLevel: "high",
    requiresApproval: true,
    idempotencyRequired: true,
    exposedToPlanner: false,
    buildTool: gmailSendApprovedTool,
  },
  {
    name: "gmail.prepareSendApproval",
    description: [
      "Compose and stage a Gmail message for user approval before sending.",
      "Works for BOTH new outbound emails AND replies to existing threads.",
      "For a new email (no threadId): pass {to, subject, body}.",
      "For a thread reply: pass {threadId, to} — subject and body will be auto-drafted if omitted.",
      "Always call this tool when the user asks to send, email, reach out, ping, follow up, or write to someone.",
      "Never redirect the user to the Gmail workspace UI — create the approval directly in this chat.",
    ].join(" "),
    inputSchema: gmailDraftInputSchema,
    outputSchema: z.object({
      approvalId: z.string(),
      subject: z.string(),
      body: z.string(),
      to: z.array(z.string()),
      cc: z.array(z.string()),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["approvals.write"],
    capabilitiesRequired: ["email.send"],
    riskLevel: "medium",
    requiresApproval: false,
    idempotencyRequired: true,
    buildTool: gmailPrepareSendApprovalTool,
  },
  {
    name: "gmail.saveThreadSummary",
    description: "Save a Gmail thread summary as an artifact.",
    inputSchema: gmailThreadInputSchema,
    outputSchema: z.object({
      artifactId: z.string(),
      title: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["artifacts.write"],
    capabilitiesRequired: ["email.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: gmailSaveThreadSummaryTool,
  },
  {
    name: "gmail.createFollowUpWorkflow",
    description: "Create a workflow draft from a Gmail thread.",
    inputSchema: gmailThreadInputSchema,
    outputSchema: z.object({
      workflowId: z.string(),
      name: z.string(),
    }),
    permissionsRequired: ["workflows.write"],
    capabilitiesRequired: ["email.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: gmailCreateFollowUpWorkflowTool,
  },
  {
    name: "hubspot.searchContacts",
    description: "Search HubSpot contacts.",
    inputSchema: hubspotSearchInputSchema.pick({ query: true, maxResults: true }).extend({ module: z.literal("contacts") }),
    outputSchema: z.object({
      status: z.string(),
      module: z.literal("contacts"),
      records: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["crm.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: (context) => hubspotSearchRecordsTool(context, "contacts", "hubspot.searchContacts", "Search HubSpot contacts."),
  },
  {
    name: "hubspot.searchCompanies",
    description: "Search HubSpot companies.",
    inputSchema: hubspotSearchInputSchema.pick({ query: true, maxResults: true }).extend({ module: z.literal("companies") }),
    outputSchema: z.object({
      status: z.string(),
      module: z.literal("companies"),
      records: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["crm.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: (context) => hubspotSearchRecordsTool(context, "companies", "hubspot.searchCompanies", "Search HubSpot companies."),
  },
  {
    name: "hubspot.searchDeals",
    description: "Search HubSpot deals.",
    inputSchema: hubspotSearchInputSchema.pick({ query: true, maxResults: true }).extend({ module: z.literal("deals") }),
    outputSchema: z.object({
      status: z.string(),
      module: z.literal("deals"),
      records: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["crm.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: (context) => hubspotSearchRecordsTool(context, "deals", "hubspot.searchDeals", "Search HubSpot deals."),
  },
  {
    name: "hubspot.searchNotes",
    description: "Search HubSpot notes.",
    inputSchema: hubspotSearchInputSchema.pick({ query: true, maxResults: true }).extend({ module: z.literal("notes") }),
    outputSchema: z.object({
      status: z.string(),
      module: z.literal("notes"),
      records: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["crm.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: (context) => hubspotSearchRecordsTool(context, "notes", "hubspot.searchNotes", "Search HubSpot notes."),
  },
  {
    name: "hubspot.searchTasks",
    description: "Search HubSpot tasks.",
    inputSchema: hubspotSearchInputSchema.pick({ query: true, maxResults: true }).extend({ module: z.literal("tasks") }),
    outputSchema: z.object({
      status: z.string(),
      module: z.literal("tasks"),
      records: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["crm.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: (context) => hubspotSearchRecordsTool(context, "tasks", "hubspot.searchTasks", "Search HubSpot tasks."),
  },
  {
    name: "hubspot.readRecord",
    description: "Read a HubSpot CRM record.",
    inputSchema: hubspotRecordInputSchema,
    outputSchema: z.object({
      status: z.string(),
      module: hubspotModuleSchema,
      record: z.record(z.string(), z.unknown()),
      contextBundleId: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["crm.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: hubspotReadRecordTool,
  },
  {
    name: "hubspot.summarizeRecord",
    description: "Summarize a HubSpot CRM record.",
    inputSchema: hubspotRecordInputSchema,
    outputSchema: z.object({
      summary: z.string(),
      keyPoints: z.array(z.string()),
      nextSteps: z.array(z.string()),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
      contextBundleId: z.string(),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["crm.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: hubspotSummarizeRecordTool,
  },
  {
    name: "hubspot.createNoteDraft",
    description: "Create an internal note draft artifact from a HubSpot record.",
    inputSchema: hubspotRecordInputSchema,
    outputSchema: z.object({
      artifactId: z.string(),
      title: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["artifacts.write"],
    capabilitiesRequired: ["crm.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: hubspotCreateNoteDraftTool,
  },
  {
    name: "hubspot.prepareNoteApproval",
    description: "Create an approval before writing a note to HubSpot.",
    inputSchema: hubspotNoteApprovalInputSchema,
    outputSchema: z.object({
      approvalId: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["approvals.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "medium",
    requiresApproval: false,
    idempotencyRequired: true,
    buildTool: hubspotPrepareNoteApprovalTool,
  },
  {
    name: "hubspot.createNoteApproved",
    description: "Execute a previously approved HubSpot note creation.",
    inputSchema: hubspotNoteApprovedInputSchema,
    outputSchema: z.object({
      recordId: z.string(),
      module: z.literal("notes"),
      properties: z.record(z.string(), z.unknown()),
      createdAt: z.string().nullable(),
    }),
    permissionsRequired: ["integrations.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "medium",
    requiresApproval: true,
    idempotencyRequired: true,
    exposedToPlanner: false,
    buildTool: hubspotCreateNoteApprovedTool,
  },
  {
    name: "hubspot.prepareUpdateApproval",
    description: "Create an approval before updating a HubSpot record.",
    inputSchema: hubspotUpdateApprovalInputSchema,
    outputSchema: z.object({
      approvalId: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["approvals.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "high",
    requiresApproval: false,
    idempotencyRequired: true,
    buildTool: hubspotPrepareUpdateApprovalTool,
  },
  {
    name: "hubspot.updateApproved",
    description: "Execute a previously approved HubSpot CRM update.",
    inputSchema: hubspotUpdateApprovedInputSchema,
    outputSchema: z.object({
      recordId: z.string(),
      module: hubspotModuleSchema,
      updatedProperties: z.record(z.string(), z.unknown()),
      updatedAt: z.string().nullable(),
      archived: z.boolean(),
    }),
    permissionsRequired: ["integrations.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "high",
    requiresApproval: true,
    idempotencyRequired: true,
    exposedToPlanner: false,
    buildTool: hubspotUpdateApprovedTool,
  },
  {
    name: "hubspot.prepareCreateApproval",
    description: "Create an approval before creating a HubSpot record.",
    inputSchema: hubspotCreateApprovalInputSchema,
    outputSchema: z.object({
      approvalId: z.string(),
    }),
    permissionsRequired: ["approvals.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "high",
    requiresApproval: false,
    idempotencyRequired: true,
    buildTool: hubspotPrepareCreateApprovalTool,
  },
  {
    name: "hubspot.createApproved",
    description: "Execute a previously approved HubSpot CRM record creation.",
    inputSchema: hubspotCreateApprovedInputSchema,
    outputSchema: z.object({
      recordId: z.string(),
      module: hubspotModuleSchema,
      properties: z.record(z.string(), z.unknown()),
      createdAt: z.string().nullable(),
    }),
    permissionsRequired: ["integrations.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "high",
    requiresApproval: true,
    idempotencyRequired: true,
    exposedToPlanner: false,
    buildTool: hubspotCreateApprovedTool,
  },
  {
    name: "hubspot.prepareTaskCreateApproval",
    description: "Create an approval before creating a HubSpot task.",
    inputSchema: hubspotTaskCreateApprovalInputSchema,
    outputSchema: z.object({
      approvalId: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["approvals.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "medium",
    requiresApproval: false,
    idempotencyRequired: true,
    buildTool: hubspotPrepareTaskCreateApprovalTool,
  },
  {
    name: "hubspot.createTaskApproved",
    description: "Execute a previously approved HubSpot task creation.",
    inputSchema: hubspotTaskCreateApprovedInputSchema,
    outputSchema: z.object({
      recordId: z.string(),
      module: z.literal("tasks"),
      properties: z.record(z.string(), z.unknown()),
      createdAt: z.string().nullable(),
    }),
    permissionsRequired: ["integrations.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "medium",
    requiresApproval: true,
    idempotencyRequired: true,
    exposedToPlanner: false,
    buildTool: hubspotCreateTaskApprovedTool,
  },
  {
    name: "hubspot.prepareTaskUpdateApproval",
    description: "Create an approval before updating a HubSpot task.",
    inputSchema: hubspotTaskUpdateApprovalInputSchema,
    outputSchema: z.object({
      approvalId: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["approvals.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "medium",
    requiresApproval: false,
    idempotencyRequired: true,
    buildTool: hubspotPrepareTaskUpdateApprovalTool,
  },
  {
    name: "hubspot.updateTaskApproved",
    description: "Execute a previously approved HubSpot task update.",
    inputSchema: hubspotTaskUpdateApprovedInputSchema,
    outputSchema: z.object({
      recordId: z.string(),
      module: z.literal("tasks"),
      updatedProperties: z.record(z.string(), z.unknown()),
      updatedAt: z.string().nullable(),
      archived: z.boolean(),
    }),
    permissionsRequired: ["integrations.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "medium",
    requiresApproval: true,
    idempotencyRequired: true,
    exposedToPlanner: false,
    buildTool: hubspotUpdateTaskApprovedTool,
  },
  {
    name: "hubspot.prepareAssociationApproval",
    description: "Create an approval before changing a HubSpot association.",
    inputSchema: hubspotAssociationApprovalInputSchema,
    outputSchema: z.object({
      approvalId: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["approvals.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "medium",
    requiresApproval: false,
    idempotencyRequired: true,
    buildTool: hubspotPrepareAssociationApprovalTool,
  },
  {
    name: "hubspot.updateAssociationApproved",
    description: "Execute a previously approved HubSpot association change.",
    inputSchema: hubspotAssociationApprovedInputSchema,
    outputSchema: z.object({
      action: z.enum(["add", "remove"]),
      fromObjectType: hubspotWritableRecordModuleSchema,
      fromRecordId: z.string(),
      toObjectType: hubspotModuleSchema,
      toRecordId: z.string(),
    }),
    permissionsRequired: ["integrations.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "medium",
    requiresApproval: true,
    idempotencyRequired: true,
    exposedToPlanner: false,
    buildTool: hubspotUpdateAssociationApprovedTool,
  },
  {
    name: "hubspot.draftFollowUp",
    description: "Draft follow-up text from a HubSpot record.",
    inputSchema: hubspotRecordInputSchema,
    outputSchema: z.object({
      subject: z.string(),
      body: z.string(),
      rationale: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
      contextBundleId: z.string(),
    }),
    permissionsRequired: ["integrations.read"],
    capabilitiesRequired: ["crm.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: hubspotDraftFollowUpTool,
  },
  {
    name: "hubspot.createRecordWorkflow",
    description: "Create a workflow draft from a HubSpot record.",
    inputSchema: hubspotRecordInputSchema,
    outputSchema: z.object({
      workflowId: z.string(),
      name: z.string(),
    }),
    permissionsRequired: ["workflows.write"],
    capabilitiesRequired: ["crm.read"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: hubspotCreateRecordWorkflowTool,
  },
  {
    name: "web.researchTask",
    description: "Run source-backed public web research using OpenAI Graph.",
    inputSchema: webResearchTaskInputSchema,
    outputSchema: z.object({
      status: z.string(),
      provider: z.string(),
      taskRunId: z.string().nullable(),
      content: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
      contentText: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
      citations: z.array(z.record(z.string(), z.unknown())),
      confidence: z.number().nullable(),
      completeness: z.number().nullable(),
      freshness: z.enum(["fresh", "stale", "partial", "unknown"]),
      failedSources: z.array(z.string()),
      partialResult: z.boolean(),
    }),
    permissionsRequired: ["web.read"],
    capabilitiesRequired: ["web.researchTask"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: webResearchTaskTool,
  },
  {
    name: "web.extractUrl",
    description: "Extract markdown-like content from a known public URL.",
    inputSchema: webExtractUrlInputSchema,
    outputSchema: z.object({
      status: z.string(),
      provider: z.string(),
      url: z.string(),
      title: z.string().nullable(),
      publishDate: z.string().nullable(),
      excerpts: z.array(z.string()),
      fullContent: z.string().nullable(),
      sessionId: z.string().nullable(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["web.read"],
    capabilitiesRequired: ["web.extractUrl"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: webExtractUrlTool,
  },
  {
    name: "crm.enrichEntity",
    description: "Enrich a company/person with web data and return HubSpot-mapped fields ready to propose as a CRM update.",
    inputSchema: crmEnrichEntityInputSchema,
    outputSchema: z.object({
      entity: z.object({
        name: z.string().nullable(),
        domain: z.string().nullable(),
        recordId: z.string().nullable(),
        module: z.string(),
      }),
      properties: z.record(z.string(), z.unknown()),
      unmapped: z.record(z.string(), z.unknown()),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["web.read", "crm.read"],
    capabilitiesRequired: ["crm.enrichEntity"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: crmEnrichEntityTool,
  },
  {
    name: "leads.buildDataset",
    description: "Build an enriched lead dataset (companies/people) via Exa Websets; saves to Library + notifies.",
    inputSchema: leadsBuildDatasetInputSchema,
    outputSchema: z.object({
      status: z.string(),
      websetId: z.string(),
      message: z.string(),
    }),
    permissionsRequired: ["web.read"],
    capabilitiesRequired: ["leads.buildDataset"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: leadsBuildDatasetTool,
  },
  {
    name: "web.deepResearch",
    description: "Run deep multi-source research and return a synthesized (optionally structured) report.",
    inputSchema: webDeepResearchInputSchema,
    outputSchema: z.object({
      status: z.string(),
      report: z.string(),
      structured: z.record(z.string(), z.unknown()).nullable().optional(),
      message: z.string().optional(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["web.read"],
    capabilitiesRequired: ["web.deepResearch"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: webDeepResearchTool,
  },
  {
    name: "web.findSimilar",
    description: "Find web pages similar/related to a known URL (related-source enrichment).",
    inputSchema: webFindSimilarInputSchema,
    outputSchema: z.object({
      status: z.string(),
      url: z.string(),
      count: z.number(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["web.read"],
    capabilitiesRequired: ["web.findSimilar"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: webFindSimilarTool,
  },
  {
    name: "web.extractStructured",
    description: "Extract structured facts from a known public URL.",
    inputSchema: webExtractStructuredInputSchema,
    outputSchema: z.object({
      status: z.string(),
      provider: z.string(),
      schemaName: z.string(),
      schemaVersion: z.string(),
      output: z.record(z.string(), z.unknown()),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["web.read"],
    capabilitiesRequired: ["web.extractStructured"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: webExtractStructuredTool,
  },
  {
    name: "web.monitorCheck",
    description: "Check for meaningful changes in a monitored public source.",
    inputSchema: webMonitorCheckInputSchema,
    outputSchema: z.object({
      provider: z.string(),
      targetType: z.string(),
      target: z.string(),
      changed: z.boolean(),
      previousContentHash: z.string().nullable(),
      currentContentHash: z.string(),
      sourceRefs: z.array(z.record(z.string(), z.unknown())),
    }),
    permissionsRequired: ["web.read"],
    capabilitiesRequired: ["web.monitorCheck"],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: webMonitorCheckTool,
  },
  {
    name: "artifact.create",
    description: "Save a structured artifact in the workspace library.",
    inputSchema: artifactCreateInputSchema,
    outputSchema: z.object({
      status: z.string(),
      artifactId: z.string(),
      message: z.string(),
    }),
    permissionsRequired: ["artifacts.write"],
    capabilitiesRequired: [],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: artifactTool,
  },
  {
    name: "workflow.generate",
    description: "Generate a custom automated workflow with dynamic steps.",
    inputSchema: workflowGenerateInputSchema,
    outputSchema: z.object({
      status: z.string(),
      workflowId: z.string(),
      name: z.string(),
      triggerType: z.string(),
      stepCount: z.number().int().nonnegative(),
      message: z.string(),
      workflow: z.record(z.string(), z.unknown()),
    }),
    permissionsRequired: ["workflows.write"],
    capabilitiesRequired: [],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: workflowGenerateTool,
  },
  {
    name: "approval.create",
    description: "Create an approval draft before any risky external action runs.",
    inputSchema: approvalCreateInputSchema,
    outputSchema: z.object({
      status: z.string(),
      approvalId: z.string(),
      message: z.string(),
    }),
    permissionsRequired: ["approvals.write"],
    capabilitiesRequired: [],
    riskLevel: "medium",
    requiresApproval: false,
    idempotencyRequired: true,
    buildTool: approvalTool,
  },
  {
    name: "notification.create",
    description: "Create an in-app notification tied to a command or workflow event.",
    inputSchema: notificationCreateInputSchema,
    outputSchema: z.object({
      status: z.string(),
      notificationId: z.string(),
      message: z.string(),
    }),
    permissionsRequired: ["notifications.write"],
    capabilitiesRequired: [],
    riskLevel: "low",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: notificationTool,
  },
  {
    name: "crm.createLead.mock",
    description: "Mock CRM lead creation placeholder.",
    inputSchema: mockLeadInputSchema,
    outputSchema: z.object({
      status: z.string(),
      message: z.string(),
    }),
    permissionsRequired: ["crm.write"],
    capabilitiesRequired: ["crm.write"],
    riskLevel: "high",
    requiresApproval: true,
    idempotencyRequired: true,
    buildTool: () => mockCrmTool(),
  },
  {
    name: "email.createDraft.mock",
    description: "Mock email draft creation placeholder.",
    inputSchema: mockEmailDraftInputSchema,
    outputSchema: z.object({
      status: z.string(),
      draft: z.object({
        to: z.string(),
        subject: z.string(),
        body: z.string(),
      }),
      message: z.string(),
    }),
    permissionsRequired: ["email.write"],
    capabilitiesRequired: ["email.draft"],
    riskLevel: "medium",
    requiresApproval: false,
    idempotencyRequired: false,
    buildTool: () => mockEmailDraftTool(),
  },
];

export function getToolDefinition(name: string) {
  return toolDefinitions.find((toolDefinition) => toolDefinition.name === name) ?? null;
}

export function requireToolDefinition(name: string) {
  const toolDefinition = getToolDefinition(name);

  if (!toolDefinition) {
    throw new ApiError({
      code: "TOOL_NOT_FOUND",
      message: `Tool ${name} is not registered.`,
      status: 404,
    });
  }

  return toolDefinition;
}
