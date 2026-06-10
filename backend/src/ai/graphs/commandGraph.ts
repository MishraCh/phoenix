import { createHash } from "node:crypto";

import type { Request } from "express";
import { END, START, Annotation, StateGraph } from "./stateGraphShim.js";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { z } from "zod";

import { getVisibleAgent } from "../../agents/agentRegistry.js";
import { ActivityService } from "../../activity/activityService.js";
import {
  commandModeClassifierSchema,
  commandPlanSchema,
  type CommandMode,
  type CommandPlan,
  type CommandResultType,
} from "../schemas/commandOutput.js";
import { parseSlashMode, shouldSkipToolExecution, toolNameForMode, buildClassifierUserPrompt, parseSelectedExpertItem } from "./commandGraphUtils.js";
import { ContextService } from "../../context/contextService.js";
import { logger } from "../../observability/logger.js";
import { RetrievalService } from "../../services/retrievalService.js";
import { timeRequestPhase } from "../../observability/requestTiming.js";
import { PolicyService, type PolicyDecision } from "../../policy/policyService.js";
import { type SourceRef } from "../../schemas/coreSchemas.js";
import type { CurrentWorkspace } from "../../services/currentWorkspaceService.js";
import { ToolRegistryService } from "../../tools/toolRegistryService.js";
import { createLlmProvider, createClassifierProvider } from "../providers/providerRegistry.js";
import { GideonManifestService } from "../manifests/gideonManifest.js";
import { WorkspaceContextService } from "../context/workspaceContextService.js";
import { ApiError } from "../../utils/apiError.js";
import { IntegrationWorkspaceService } from "../../integrations/integrationWorkspaceService.js";
import {
  GmailActionService,
  resolveGmailApprovalInput,
} from "../../integrations/actions/gmailActionService.js";
import { HubSpotActionService } from "../../integrations/actions/hubSpotActionService.js";
import { WebIntelligenceService } from "../../web/webIntelligenceService.js";
import { SopRegistryService } from "../sops/sopRegistry.js";
import { expertCapabilities } from "../../experts/capabilityRegistry.js";

import type { ExpertExecutionResult, ExpertTypeId, ExpertRendererKey } from "../../experts/types.js";
import { SemanticIntentClassifier, type SemanticIntentResult } from "../routing/semanticIntentClassifier.js";
import { IntegrationIntentHandler } from "../../integrations/integrationIntentHandler.js";
import { PromptCompilerService } from "../prompts/promptCompilerService.js";
import { formatWorkspaceIdentityBlock } from "../context/workspaceContextService.js";
import type { CommandIntent, RouteDecision } from "../contracts/commandContracts.js";
import type { CommandRequestEnvelope } from "../contracts/commandRequestEnvelope.js";
import type { SessionStateSnapshot } from "../contracts/sessionState.js";
import { CommandRouterV2, toLegacySemanticIntent } from "../routing/commandRouterV2.js";
import { AiRolloutService } from "../rollout/aiRolloutService.js";
import {
  AiBudgetExceededError,
  getAiExecutionContext,
  runWithoutAiExecutionContext,
} from "../execution/aiExecutionBudget.js";
import {
  buildResearchFollowUpPrompt,
  formatRecentResultForPrompt,
  resolveReferencedRecentResult,
  shouldEnrichResearchFollowUp,
} from "../context/recentResultResolver.js";
import { isCapabilityHelpQuery } from "../routing/capabilityHelpIntent.js";
import { postProcessWorkflowDraft } from "../../workflows/workflowDraftService.js";

const urlPattern = /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>"{}|\\^[\]`]+)?/gi;

export const CommandState = Annotation.Root({
  input: Annotation<string>(),
  normalizedInput: Annotation<string>(),
  requestedMode: Annotation<CommandMode>(),
  resolvedMode: Annotation<CommandMode>(),
  attachments: Annotation<unknown[]>(),
  userId: Annotation<string>(),
  userProfile: Annotation<{ displayName?: string; email?: string } | null>(),
  currentWorkspace: Annotation<CurrentWorkspace>(),
  selectedAgentId: Annotation<string | null>(),
  selectedAgentName: Annotation<string>(),
  availableCapabilities: Annotation<string[]>(),
  contextBundleId: Annotation<string>(),
  contextFreshness: Annotation<string>(),
  contextSummary: Annotation<string>(),
  sourceRefs: Annotation<SourceRef[]>(),
  missingContext: Annotation<string[]>(),
  semanticIntent: Annotation<SemanticIntentResult | null>(),
  plan: Annotation<CommandPlan | null>(),
  toolResult: Annotation<Record<string, unknown> | null>(),
  safety: Annotation<{
    requiresApproval: boolean;
    missingCapabilities: Array<{ capability: string; requiredIntegration: string | null; setupHint: string }>;
    policyDecisions: PolicyDecision[];
  } | null>(),
  answer: Annotation<string>(),
  artifactDrafts: Annotation<Array<{ title: string; artifactType: string; previewText: string }>>(),
  proposedActions: Annotation<
    Array<{ id: string; label: string; riskLevel: "low" | "medium" | "high" | "critical"; requiresApproval: boolean }>
  >(),
  createdArtifact: Annotation<{
    artifactId: string;
    title: string;
    artifactType: string;
    previewText: string;
  } | null>(),
  createdApproval: Annotation<{
    approvalId: string;
    label: string;
    riskLevel: "low" | "medium" | "high" | "critical";
    requiresApproval: boolean;
    status?: "pending" | "executing" | "executed" | "failed";
    actionType?: string;
  } | null>(),
  createdWorkflow: Annotation<{
    workflowId: string;
    name: string;
    triggerType: string;
    stepCount: number;
  } | null>(),
  expertExecution: Annotation<ExpertExecutionResult | null>(),
  resultType: Annotation<CommandResultType>(),
  result: Annotation<Record<string, unknown> | null>(),
  creditsCharged: Annotation<number>(),
  agentRunId: Annotation<string>(),
  stepLogs: Annotation<string[]>(),
  request: Annotation<Request | undefined>(),
  sessionId: Annotation<string>(),
  sessionContext: Annotation<string>(),
  agentSystemPromptAddition: Annotation<string>(),
  agentAllowedTools: Annotation<string[] | null>(),
  progressEmit: Annotation<((event: string, data: Record<string, unknown>) => void) | undefined>(),
  artifactWritePolicy: Annotation<"explicit_user_intent" | "disabled">(),
  retrievalContext: Annotation<string>(),
  routeDecision: Annotation<RouteDecision | null>(),
  routeComparison: Annotation<{
    liveIntent: string;
    v2Intent: string;
    v2ToolStrategy: string;
    agreement: boolean;
    providerFalseTrigger: boolean;
  } | null>(),
  sessionState: Annotation<SessionStateSnapshot | null>(),
  retrievedSopsBlock: Annotation<string>(),
  requestEnvelope: Annotation<CommandRequestEnvelope | null>(),
  rolloutFlags: Annotation<{
    routeV2Shadow: boolean;
    routeV2Active: boolean;
    contextV2: boolean;
    retrievalV2Active: boolean;
  }>(),
});

type CommandGraphInput = {
  input: string;
  mode?: CommandMode;
  attachments?: unknown[];
  userId: string;
  currentWorkspace: CurrentWorkspace;
  agentId?: string | null;
  contextBundleId?: string | null;
  request?: Request;
  sessionId?: string;
  sessionContext?: string;
  agentSystemPromptAddition?: string | null;
  agentAllowedTools?: string[] | null;
  progressEmit?: (event: string, data: Record<string, unknown>) => void;
  artifactWritePolicy?: "explicit_user_intent" | "disabled";
  requestEnvelope?: CommandRequestEnvelope;
  sessionState?: SessionStateSnapshot;
};

export type AutoIntegrationToolState = {
  input: string;
  normalizedInput: string;
  userId: string;
  currentWorkspace: CurrentWorkspace;
  selectedAgentId: string | null;
  availableCapabilities: string[];
  contextSummary: string;
  sessionContext: string;
  sourceRefs: SourceRef[];
  toolResult?: Record<string, unknown> | null;
  missingContext: string[];
  resolvedMode: string;
};

function hashInput(input: string) {
  return createHash("sha256").update(input.trim().toLowerCase()).digest("hex");
}

function budgetIntentForMode(mode: CommandMode): CommandIntent | null {
  if (mode === "search") return "web_search";
  if (mode === "research") return "deep_research";
  if (mode === "workflow") return "workflow_create";
  return null;
}

function isFreshDiscoveryQuery(input: string) {
  return (
    /\b(recent|recently|latest|current|today|news)\b/i.test(input) &&
    /\b(find|search|show|list|which|who)\b/i.test(input)
  );
}

function isWorkflowDraftQuery(input: string) {
  if (/\b(workflow|automation|automate)\b/i.test(input)) return true;
  if (/\b(create|draft|setup|build|schedule|start)\s+(?:a\s+|an\s+)?(recurring|weekly|daily|monthly)\b/i.test(input)) return true;
  if (/\b(run|send|notify|email|alert)(?:\s+me)?\s+(every|each)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|day|week|month)\b/i.test(input)) return true;
  return false;
}

function shouldPersistArtifact(input: string, policy: "explicit_user_intent" | "disabled") {
  if (policy === "disabled") return false;
  return /save|keep|persist|turn this into|store/i.test(input);
}

function extractUrls(input: string) {
  return Array.from(input.matchAll(urlPattern)).map((match) => {
    const raw = match[0];
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  });
}

function summarizeToolResult(toolResult: Record<string, unknown> | null) {
  if (!toolResult) {
    return "";
  }

  if (typeof toolResult.contentText === "string" && toolResult.contentText.trim()) {
    return toolResult.contentText;
  }

  if (Array.isArray(toolResult.excerpts) && toolResult.excerpts.length) {
    return toolResult.excerpts.join("\n\n");
  }

  if (typeof toolResult.fullContent === "string" && toolResult.fullContent.trim()) {
    return toolResult.fullContent;
  }

  return JSON.stringify(toolResult, null, 2);
}

function buildResearchPlan(
  mode: "search" | "research",
  toolResult: Record<string, unknown> | null,
): CommandPlan {
  const content =
    typeof toolResult?.contentText === "string" && toolResult.contentText.trim()
      ? toolResult.contentText.trim()
      : "";
  const status =
    typeof toolResult?.status === "string" ? toolResult.status : "unavailable";
  const unavailable = !content || status === "unavailable" || status === "error";
  const partial =
    toolResult?.partialResult === true ||
    toolResult?.freshness === "partial" ||
    status === "partial" ||
    status === "timeout";

  const answer = unavailable
    ? "Research is temporarily unavailable. Please retry in a moment."
    : content;
  const highlights = partial
    ? ["This result is partial because one or more research sources were unavailable."]
    : [];

  return {
    intent: mode === "search" ? "search" : "research",
    answer,
    clarificationQuestion: null,
    highlights,
    sections: [],
    artifact: null,
    approval: null,
    notification: null,
    workflowDraft: null,
    requestedCapabilities: [],
    requestedTools: [],
    missingContext: unavailable
      ? ["Live web research is temporarily unavailable."]
      : [],
  };
}

function buildCapabilityHelpPayload(input: string, availableCapabilities: string[], selectedAgentName: string) {
  const fundingFocused = /\b(funding|fundrais|startup|vc|investor|y\s*combinator|a16z|saas|voice)\b/i.test(input);
  const connectedIntegrations = [
    availableCapabilities.some((capability) => capability.startsWith("email.") || capability.includes("gmail"))
      ? {
          provider: "gmail",
          label: "Gmail",
          capabilities: ["Answer questions about threads", "Draft replies", "Prepare send approvals"],
          status: "connected",
        }
      : null,
    availableCapabilities.some((capability) => capability.startsWith("crm.") || capability.includes("hubspot"))
      ? {
          provider: "hubspot",
          label: "HubSpot",
          capabilities: ["Read CRM records", "Brief contacts and deals", "Prepare CRM updates for approval"],
          status: "connected",
        }
      : null,
  ].filter(Boolean);

  const categories = [
    {
      title: "Understand your workspace",
      description: "Ask Gideon to summarize priorities, explain context, analyze documents, or find what matters across saved work.",
      examples: ["Summarize my priorities", "Analyze this document", "What changed since last week?"],
    },
    {
      title: "Work with integrations",
      description: "When Gmail or HubSpot is connected, Gideon can read selected context and prepare safe actions for approval.",
      examples: ["List HubSpot contacts", "Draft a reply to this thread", "Update this deal stage after approval"],
    },
    {
      title: "Use expert lenses",
      description: "Specialized assistants can produce structured briefs, scorecards, battlecards, people insights, legal risk panels, and research reports.",
      examples: ["Brief this lead", "Score this opportunity", "Analyze these exit interviews"],
    },
    {
      title: "Create workflows",
      description: "Describe a repeatable process and Gideon can draft a workflow canvas for you to review, edit, save, and activate.",
      examples: fundingFocused
        ? ["Monitor startup funding weekly", "Email me a funding digest", "Save matching startups as a report"]
        : ["Create a follow-up workflow", "Monitor competitor news weekly", "Prepare a recurring operating brief"],
    },
  ];

  return {
    status: "ready",
    selectedAgentName,
    headline: fundingFocused
      ? "Gideon can turn funding research into a repeatable operating workflow."
      : "Gideon helps you understand, decide, and act across your workspace.",
    categories,
    connectedIntegrations,
    limitations: [
      "External sends and CRM writes require your approval.",
      "Destructive delete actions are not supported yet.",
      "If a source or integration is missing, Gideon should ask instead of guessing.",
    ],
    nextActions: [
      { label: "Create workflow", prompt: fundingFocused ? "Create a workflow to monitor startup funding weekly" : "Create a workflow from this" },
      { label: "Ask Sales Assistant", prompt: "Brief this lead" },
      { label: "Run research", prompt: "Find recent market signals" },
    ],
  };
}

function buildCapabilityHelpPlan(input: string, availableCapabilities: string[] = [], selectedAgentName = "Gideon"): CommandPlan {
  const fundingFocused = /\b(funding|fundrais|startup|vc|investor|y\s*combinator|a16z|saas|voice)\b/i.test(input);
  const workflowLabel = fundingFocused
    ? "startup funding-update workflow"
    : "recurring monitoring workflow";

  return {
    intent: "other",
    answer: fundingFocused
      ? "Yes. I can help turn this into a recurring startup-funding intelligence workflow instead of a one-off search."
      : "Yes. I can help turn recurring research or operating updates into a monitored workflow.",
    clarificationQuestion: null,
    highlights: [
      "Monitor public sources on a schedule, summarize what changed, and produce a clean update.",
      "Filter by sector, investor, geography, round type, and recency.",
      "Save reports to Library or create workflow runs without taking external write actions silently.",
    ],
    sections: [
      {
        title: "What I can automate",
        body: fundingFocused
          ? [
              "- Track newly funded startups in target categories like productivity SaaS, voice agents, AI workflow tools, or any custom theme.",
              "- Prioritize rounds backed by specific investors such as YC, a16z, Sequoia, Founders Fund, or your own watchlist.",
              "- Produce a ranked update with company, round, amount, investors, category, why it matters, and source links.",
              "- Highlight high-signal companies for follow-up, competitive tracking, or CRM enrichment.",
            ].join("\n")
          : [
              "- Monitor a topic, company set, competitor list, or URL set on a recurring schedule.",
              "- Summarize changes, risks, opportunities, and recommended next actions.",
              "- Save outputs as reports or route them into workflow notifications.",
            ].join("\n"),
      },
      {
        title: "How the workflow would run",
        body: [
          `1. Trigger: run the ${workflowLabel} daily, weekly, or manually.`,
          "2. Search: gather fresh public evidence from trusted web sources.",
          "3. Filter: remove stale or irrelevant results and keep only matching signals.",
          "4. Synthesize: produce a concise update with citations and confidence.",
          "5. Deliver: show it in Command Center, save it to Library, or notify you.",
        ].join("\n"),
      },
      {
        title: "What I need from you",
        body: [
          "- Cadence: daily, weekly, or on demand.",
          "- Focus: sectors, keywords, geographies, and investors to watch.",
          "- Output style: short digest, ranked table, deep report, or CRM-ready lead list.",
          "- Delivery: Command Center only, Library report, notification, or workflow run history.",
        ].join("\n"),
      },
    ],
    artifact: null,
    approval: null,
    notification: null,
    workflowDraft: null,
    requestedCapabilities: ["web.researchTask", "workflow.generate"],
    requestedTools: ["capability.guide"],
    missingContext: [],
  };
}

function buildSelectedContextPromptBlock(contextSummary: string) {
  if (!contextSummary?.trim()) {
    return "";
  }

  try {
    const parsed = JSON.parse(contextSummary) as {
      payload?: {
        integration?: {
          title?: string;
          selectedItem?: {
            title?: string;
            itemType?: string;
            summary?: string;
            content?: string;
            metadata?: Record<string, unknown>;
          };
        };
      };
    };
    const integration = parsed.payload?.integration;
    const selectedItem = integration?.selectedItem;

    if (!selectedItem) {
      return "";
    }

    return [
      `Workspace: ${integration?.title ?? "Selected integration item"}`,
      `Item: ${selectedItem.title ?? "Untitled"}`,
      `Type: ${selectedItem.itemType ?? "unknown"}`,
      `Summary: ${selectedItem.summary ?? ""}`,
      "",
      selectedItem.content ?? "",
      selectedItem.metadata ? `Metadata:\n${JSON.stringify(selectedItem.metadata, null, 2)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

type SelectedIntegrationItem = {
  provider: string;
  itemId: string;
  title: string;
  itemType: string;
  summary?: string;
};

type ParsedEmailDraft = {
  subject: string | null;
  body: string | null;
};

export type HubSpotAutoModule = "contacts" | "companies" | "deals" | "notes" | "tasks";

type GmailApprovalResolution =
  | {
      status: "ready";
      input: {
        threadId?: string;
        to: string[];
        cc?: string[];
        subject: string;
        body: string;
      };
    }
  | {
      status: "missing_fields";
      message: string;
    };

function parseSelectedIntegrationItem(contextSummary: string): SelectedIntegrationItem | null {
  if (!contextSummary?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(contextSummary) as {
      payload?: {
        integration?: {
          provider?: string;
          selectedItem?: {
            itemId?: string;
            title?: string;
            itemType?: string;
            summary?: string;
          };
        };
      };
    };

    const integration = parsed.payload?.integration;
    const selectedItem = integration?.selectedItem;

    if (!integration?.provider || !selectedItem?.itemId) {
      return null;
    }

    return {
      provider: integration.provider,
      itemId: selectedItem.itemId,
      title: selectedItem.title ?? "Selected item",
      itemType: selectedItem.itemType ?? "unknown",
      summary: selectedItem.summary,
    };
  } catch {
    return null;
  }
}

function gmailWorkspaceComposeHint(contextSummary: string) {
  const selectedItem = parseSelectedIntegrationItem(contextSummary);
  if (selectedItem?.provider === "gmail" && selectedItem.itemType === "email_thread") {
    return "Use Reply for a response on the selected thread, or Compose in the Gmail workspace for a brand-new outbound email. Gideon can prepare the approval there once the recipients and final copy are locked in.";
  }

  return "Use Compose in the Gmail workspace to review the recipients, subject, and body, then send it for approval from there.";
}

function formatHubSpotSearchResult(
  module: HubSpotAutoModule,
  records: Array<{ title?: string; subtitle?: string; id?: string }>,
  query: string,
) {
  const singularLabel =
    module === "contacts"
      ? "contact"
      : module === "companies"
        ? "company"
        : module === "deals"
          ? "deal"
          : module === "notes"
            ? "note"
            : "task";

  const systemInstruction = `\n\n[SYSTEM INSTRUCTION: Present these records naturally to the user. If you need to perform any action (update, create approval, etc.) on any of these records, you MUST use the exact numeric recordId value shown above — do NOT invent, guess, or substitute any other value for recordId. Do NOT instruct the user to use the HubSpot UI or API manually.]`;
  const emptyInstruction = `\n\n[SYSTEM INSTRUCTION: Inform the user naturally that no matching records were found in their cached workspace. Do NOT provide instructions on how to manually use the HubSpot UI or API to find them.]`;

  if (!records.length) {
    const emptyMsg = query
      ? `I couldn't find a HubSpot ${singularLabel} matching "${query}" in the current workspace.`
      : `I couldn't find any cached HubSpot ${module} in the current workspace yet.`;
    return emptyMsg + emptyInstruction;
  }

  const header = query
    ? `I found ${records.length} HubSpot ${records.length === 1 ? singularLabel : module} matching "${query}".`
    : `Here are the available HubSpot ${module} I found.`;

  const lines = records.slice(0, 8).map((record, index) => {
    const title = record.title?.trim() || `Untitled ${singularLabel}`;
    const subtitle = record.subtitle?.trim();
    // Include the real numeric record ID so the LLM can use it verbatim in approvals
    const idAnnotation = record.id ? ` [recordId: ${record.id}]` : "";
    return `${index + 1}. ${title}${subtitle ? ` — ${subtitle}` : ""}${idAnnotation}`;
  });

  return [header, ...lines].join("\n") + systemInstruction;
}

function formatHubSpotSearchUserText(
  module: HubSpotAutoModule,
  records: Array<{ title?: string; subtitle?: string; id?: string }>,
  query: string,
  options?: { multiple?: boolean },
) {
  const singularLabel =
    module === "contacts"
      ? "contact"
      : module === "companies"
        ? "company"
        : module === "deals"
          ? "deal"
          : module === "notes"
            ? "note"
            : "task";

  if (!records.length) {
    return query
      ? `I couldn't find a HubSpot ${singularLabel} matching "${query}".`
      : `I couldn't find any available HubSpot ${module} right now.`;
  }

  const header = options?.multiple
    ? `I found multiple HubSpot ${module} matching "${query}".`
    : query
      ? `I found ${records.length} HubSpot ${records.length === 1 ? singularLabel : module} matching "${query}".`
      : `Here are the available HubSpot ${module} I found.`;

  const lines = records.slice(0, 8).map((record, index) => {
    const title = record.title?.trim() || `Untitled ${singularLabel}`;
    const subtitle = record.subtitle?.trim();
    return `${index + 1}. ${title}${subtitle ? ` — ${subtitle}` : ""}`;
  });

  return [header, ...lines].join("\n");
}

function extractEmailAddresses(input: string) {
  const matches = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return Array.from(new Set(matches.map((value) => value.trim().replace(/[>,.;:]+$/g, ""))));
}

function cleanDraftBody(body: string) {
  return body
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/^(draft email content|proposed email draft|draft email to.+|email draft to.+)\s*$/gim, "")
    .replace(/\n(?:next steps|why this draft works|notes?)\b[\s\S]*$/i, "")
    .trim();
}

function parseEmailDraftFromText(text: string): ParsedEmailDraft {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
  if (!normalized) {
    return { subject: null, body: null };
  }

  const subjectMatch = normalized.match(/(?:^|\n)subject:\s*(.+)$/im);
  const subject = subjectMatch?.[1]?.trim() || null;

  let bodyCandidate = normalized;
  if (subjectMatch?.[0]) {
    bodyCandidate = normalized.replace(subjectMatch[0], "").trim();
  }

  const body = cleanDraftBody(bodyCandidate);
  return {
    subject,
    body: body || null,
  };
}

function extractEmailDraftFromPlan(plan: CommandPlan, sessionContext: string): ParsedEmailDraft {
  const preferredSections = plan.sections
    .filter(
      (section) =>
        /\b(draft|email|reply|message)\b/i.test(section.title) ||
        /(?:^|\n)subject:\s*/i.test(section.body) ||
        /\b(dear|hi|hello)\b/i.test(section.body),
    )
    .map((section) => section.body);

  const candidates = [
    ...preferredSections,
    plan.artifact?.content ?? "",
    plan.answer,
    sessionContext,
  ].filter((value) => value.trim());

  for (const candidate of candidates) {
    const parsed = parseEmailDraftFromText(candidate);
    if (parsed.subject && parsed.body) {
      return parsed;
    }
  }

  for (const candidate of candidates) {
    const parsed = parseEmailDraftFromText(candidate);
    if (parsed.body) {
      return parsed;
    }
  }

  return { subject: null, body: null };
}

function firstMeaningfulLine(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .find(Boolean) ?? "";
}

function resolveGmailApprovalFromCommand(params: {
  input: string;
  sessionContext: string;
  plan: CommandPlan;
  contextSummary: string;
}): GmailApprovalResolution {
  const selectedItem = parseSelectedIntegrationItem(params.contextSummary);
  const resolved = resolveGmailApprovalInput({
    userInput: params.input,
    sessionContext: params.sessionContext,
    plan: params.plan,
    selectedItem:
      selectedItem?.provider === "gmail"
        ? {
            provider: "gmail",
            itemId: selectedItem.itemId,
            title: selectedItem.title,
            itemType: selectedItem.itemType,
            summary: selectedItem.summary,
          }
        : null,
  });
  if ("message" in resolved) {
    return {
      status: "missing_fields",
      message: resolved.message,
    };
  }

  return {
    status: "ready",
    input: resolved,
  };
}

function formatGmailSearchResult(threads: Array<{ subject?: string; snippet?: string; from?: string; threadId?: string }>, query: string) {
  if (!threads.length) {
    return `I couldn't find a cached Gmail thread matching "${query}" right now. Try Refresh in the Gmail workspace if you expect a newer message.`;
  }

  const lines = threads.slice(0, 5).map((thread, index) => {
    const subject = thread.subject?.trim() || "Untitled thread";
    const from = thread.from?.trim() || "Unknown sender";
    const snippet = thread.snippet?.trim() || "No cached snippet available.";
    return `${index + 1}. ${subject} — ${from}\n${snippet}`;
  });

  return [`I found ${threads.length} cached Gmail thread${threads.length === 1 ? "" : "s"} matching "${query}".`, ...lines].join("\n\n");
}

function normalizeApprovalToolName(toolName: string, actionType: string) {
  const normalized = toolName.trim();

  if (
    actionType === "gmail_send" ||
    actionType === "email_send" ||
    /email/i.test(normalized) ||
    /^gmail$/i.test(normalized) ||
    /^gmail[._-]?send$/i.test(normalized) ||
    /^gmail[._-]?reply$/i.test(normalized) ||
    /^email$/i.test(normalized) ||
    /^email[._-]?send$/i.test(normalized) ||
    /^email[._-]?draft$/i.test(normalized) ||
    /^email[._-]?reply$/i.test(normalized)
  ) {
    return "gmail.prepareSendApproval";
  }

  if (actionType === "hubspot_update" || /^hubspot$/i.test(normalized) || /^hubspot[._-]?update$/i.test(normalized)) {
    return "hubspot.prepareUpdateApproval";
  }

  if (actionType === "hubspot_create" || /^hubspot[._-]?create$/i.test(normalized)) {
    return "hubspot.prepareCreateApproval";
  }

  if (actionType === "hubspot_note_create" || /^hubspot[._-]?note$/i.test(normalized)) {
    return "hubspot.prepareNoteApproval";
  }

  if (actionType === "hubspot_task_create" || /^hubspot[._-]?task(?:[._-]?create)?$/i.test(normalized)) {
    return "hubspot.prepareTaskCreateApproval";
  }

  if (actionType === "hubspot_task_update" || /^hubspot[._-]?task[._-]?update$/i.test(normalized)) {
    return "hubspot.prepareTaskUpdateApproval";
  }

  if (actionType === "hubspot_association_update" || /^hubspot[._-]?association$/i.test(normalized)) {
    return "hubspot.prepareAssociationApproval";
  }

  return normalized;
}

function serializeSourceRef(source: SourceRef) {
  return {
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    title: source.title ?? null,
    url: source.url ?? null,
    provider: source.provider ?? null,
    freshness: source.freshness ?? null,
    confidence: typeof source.confidence === "number" ? source.confidence : null,
    fetchedAt: source.fetchedAt ? source.fetchedAt.toDate().toISOString() : null,
    citations: source.citations?.map((citation) => ({
      title: citation.title ?? null,
      url: citation.url ?? null,
    })) ?? [],
    taskRunId: source.taskRunId ?? null,
    sessionId: source.sessionId ?? null,
  };
}

function firstArrayItems(values: unknown, limit = 3) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, limit);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringProp(props: Record<string, unknown>, key: string) {
  const value = props[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function buildDeterministicContactBriefPayload(params: {
  input: string;
  toolResult: Record<string, unknown>;
}) {
  const record = asRecord(params.toolResult.record);
  const props = asRecord(record.properties);
  const module = typeof params.toolResult.module === "string" ? params.toolResult.module : "contacts";
  const title =
    (typeof params.toolResult.recordTitle === "string" && params.toolResult.recordTitle.trim()) ||
    (typeof record.title === "string" && record.title.trim()) ||
    [stringProp(props, "firstname"), stringProp(props, "lastname")].filter(Boolean).join(" ") ||
    stringProp(props, "name") ||
    "HubSpot contact";
  const email = stringProp(props, "email");
  const company = stringProp(props, "company") || stringProp(props, "name");
  const jobTitle = stringProp(props, "jobtitle");
  const lifecycleStage = stringProp(props, "lifecyclestage");
  const phone = stringProp(props, "phone");

  const signals = [
    email ? `Email on file: ${email}` : null,
    company ? `Associated company: ${company}` : null,
    jobTitle ? `Role: ${jobTitle}` : null,
    lifecycleStage ? `Lifecycle stage: ${lifecycleStage}` : null,
    phone ? `Phone number available` : null,
  ].filter((value): value is string => Boolean(value));

  const painPoints = [
    !jobTitle ? "Role/title is missing from the CRM record." : null,
    !company && module === "contacts" ? "Company association is unclear from the CRM record." : null,
    !phone ? "No phone number is stored for direct outreach." : null,
  ].filter((value): value is string => Boolean(value));

  const nextActions = [
    email ? `Use ${email} for a tailored follow-up.` : "Verify the best contact email before outreach.",
    company ? `Review recent CRM activity and any open work tied to ${company}.` : "Confirm the company/account context before advancing outreach.",
    "Update any missing CRM fields before the next step if the record is incomplete.",
  ];

  return {
    status: "success" as const,
    searchMetadata: {
      query: params.input || title,
      sourceUsed: `hubspot-record-detail:${module}`,
    },
    summary:
      module === "companies"
        ? `${title} is a HubSpot company record${company ? ` associated with ${company}` : ""}.`
        : `${title} is a HubSpot contact${company ? ` at ${company}` : ""}${jobTitle ? ` working as ${jobTitle}` : ""}.`,
    buyerContext: [
      jobTitle ? `${title} is listed as ${jobTitle}.` : `${title}'s role is not fully specified in HubSpot yet.`,
      company ? `The record is connected to ${company}.` : "The account/company context needs confirmation.",
      lifecycleStage ? `Current lifecycle stage: ${lifecycleStage}.` : null,
    ].filter(Boolean).join(" "),
    painPoints,
    signals,
    recommendedAngle:
      company || jobTitle
        ? `Anchor the conversation around ${jobTitle || "their role"}${company ? ` at ${company}` : ""} and confirm the immediate business priority before proposing next steps.`
        : "Start by confirming the contact's current role and company context before moving into a tailored pitch.",
    risks: [
      !email ? "Primary email is missing or unclear." : null,
      !company && module === "contacts" ? "Company context is incomplete." : null,
    ].filter((value): value is string => Boolean(value)),
    nextActions,
    confidence: 0.88,
  };
}

function extractSimpleHubSpotUpdates(input: string) {
  const titleMatch = input.match(/\b(?:job\s*title|title|occupation)\b.*?\b(?:to|as|=)\s+["“]?([^"”.,\n]+)["”]?/i);
  if (titleMatch?.[1]?.trim()) {
    return {
      updates: { jobtitle: titleMatch[1].trim() },
      summary: `job title to ${titleMatch[1].trim()}`,
    };
  }

  const lifecycleMatch = input.match(/\b(?:lifecycle\s*stage|stage)\b.*?\b(?:to|as|=)\s+["“]?([^"”.,\n]+)["”]?/i);
  if (lifecycleMatch?.[1]?.trim()) {
    return {
      updates: { lifecyclestage: lifecycleMatch[1].trim() },
      summary: `lifecycle stage to ${lifecycleMatch[1].trim()}`,
    };
  }

  return null;
}

// Per-type friendly preamble templates for expert plan answers.
// These are the first thing the user reads before seeing the card, so they should
// feel like a real Gideon message — not just an echo of the payload summary.
const EXPERT_PREAMBLE_TEMPLATES: Partial<Record<ExpertTypeId, (payload: Record<string, unknown>) => string>> = {
  contact_brief: (p) => {
    const summary = typeof p.summary === "string" ? p.summary.trim() : "";
    if (summary) return summary;
    return "Here's the contact brief I put together for you — key signals, pain points, and the recommended angle.";
  },
  pre_call_brief: (p) => {
    const objective = typeof p.objective === "string" ? p.objective.trim() : "";
    if (objective) return `Here's your pre-call brief. Objective: ${objective}`;
    return "Here's your pre-call brief — objectives, likely objections, and suggested opening lines to set you up for a strong conversation.";
  },
  opportunity_scorecard: (p) => {
    const score = typeof p.opportunityScore === "number" ? p.opportunityScore : null;
    const summary = typeof p.summary === "string" ? p.summary.trim() : "";
    if (score !== null && summary) return `Opportunity scored at ${score}/100. ${summary}`;
    if (score !== null) return `I scored this opportunity at ${score}/100. Here's the full breakdown.`;
    if (summary) return summary;
    return "Here's the opportunity scorecard — score, signals, recommended play, and next steps.";
  },
  outreach_draft: (p) => {
    const audience = typeof p.audience === "string" ? p.audience.trim() : "";
    const summary = typeof p.summary === "string" ? p.summary.trim() : "";
    if (summary) return summary;
    if (audience) return `Here's an outreach draft tailored for ${audience}.`;
    return "Here's an outreach draft ready for your review — feel free to adapt the tone before sending.";
  },
  competitor_battlecard: (p) => {
    const overview = typeof p.competitorOverview === "string" ? p.competitorOverview.trim() : "";
    const summary = typeof p.summary === "string" ? p.summary.trim() : "";
    if (summary) return summary;
    if (overview) return overview;
    return "Here's the competitive battlecard — strengths, weaknesses, positioning gaps, and attack angles.";
  },
  signal_radar: (p) => {
    const urgency = typeof p.urgency === "string" ? p.urgency : null;
    const summary = typeof p.summary === "string" ? p.summary.trim() : "";
    const urgencyLabel = urgency === "critical" ? "⚡ Critical urgency" : urgency === "high" ? "High urgency" : null;
    if (urgencyLabel && summary) return `${urgencyLabel}. ${summary}`;
    if (summary) return summary;
    return "Here are the key signals on my radar for this account — sorted by urgency and what each one means for you.";
  },
  document_analysis: (p) => {
    const summary = typeof p.summary === "string" ? p.summary.trim() : "";
    if (summary) return summary;
    return "Here's my analysis of the document.";
  },
  sales_intelligence: (p) => {
    const summary = typeof p.summary === "string" ? p.summary.trim() : "";
    if (summary) return summary;
    return "Here's the sales intelligence I assembled — firmographics, tech stack, and hiring signals to help you approach this target.";
  },
  account_snapshot: (p) => {
    const summary = typeof p.summary === "string" ? p.summary.trim() : "";
    const health = typeof p.crmHealth === "string" ? p.crmHealth : null;
    const healthLabel = health === "healthy" ? "This account looks healthy" : health === "at_risk" ? "This account is at risk" : health === "churned" ? "This account has churned" : null;
    if (healthLabel && summary) return `${healthLabel}. ${summary}`;
    if (summary) return summary;
    return "Here's a snapshot of this account — CRM health, deal stage, recent activity, and open tasks.";
  },
  pipeline_health: (p) => {
    const summary = typeof p.summary === "string" ? p.summary.trim() : "";
    const dealCount = typeof p.dealCount === "number" ? p.dealCount : null;
    const atRisk = typeof p.atRiskDeals === "number" ? p.atRiskDeals : null;
    if (dealCount !== null && atRisk !== null) {
      return summary || `You have ${dealCount} active deals, ${atRisk} flagged at risk. Here's the full pipeline breakdown.`;
    }
    if (summary) return summary;
    return "Here's your pipeline health report — deal counts, total value, velocity, and funnel-stage breakdown.";
  },
  deal_risk: (p) => {
    const summary = typeof p.summary === "string" ? p.summary.trim() : "";
    const riskScore = typeof p.riskScore === "number" ? p.riskScore : null;
    if (riskScore !== null && summary) return `Risk score: ${riskScore}/100. ${summary}`;
    if (riskScore !== null) return `I assessed this deal at a risk score of ${riskScore}/100. Here are the factors.`;
    if (summary) return summary;
    return "Here's the deal risk analysis — risk score, red flags, mitigating factors, and recommended action.";
  },
  meeting_summary: (p) => {
    const summary = typeof p.summary === "string" ? p.summary.trim() : "";
    const actionCount = Array.isArray(p.actionItems) ? p.actionItems.length : null;
    if (summary && actionCount !== null) return `${summary} ${actionCount} action item${actionCount !== 1 ? "s" : ""} captured.`;
    if (summary) return summary;
    return "Here's the meeting summary — decisions, action items, and a follow-up draft ready to go.";
  },
};

export function buildExpertPlanAnswer(expertExecution: ExpertExecutionResult) {
  const payload = expertExecution.payload as Record<string, unknown>;
  const template = EXPERT_PREAMBLE_TEMPLATES[expertExecution.expertType as ExpertTypeId];

  if (template) {
    try {
      const result = template(payload);
      if (result?.trim()) return result;
    } catch {
      // fall through to defaults
    }
  }

  // Generic fallbacks
  if (typeof payload.summary === "string" && payload.summary.trim()) {
    return payload.summary;
  }
  if (typeof payload.objective === "string" && payload.objective.trim()) {
    return payload.objective;
  }
  if (typeof payload.competitorOverview === "string" && payload.competitorOverview.trim()) {
    return payload.competitorOverview;
  }

  return "Here's the expert report I put together for you.";
}

export function buildExpertPlanHighlights(expertExecution: ExpertExecutionResult) {
  const payload = expertExecution.payload as Record<string, unknown>;

  switch (expertExecution.expertType) {
    case "contact_brief":
      return firstArrayItems(payload.signals);
    case "pre_call_brief":
      return firstArrayItems(payload.successCriteria);
    case "opportunity_scorecard":
      return firstArrayItems(payload.whyNow);
    case "outreach_draft":
      return firstArrayItems(payload.rationale);
    case "competitor_battlecard":
      return firstArrayItems(payload.attackAngles);
    case "signal_radar":
      return firstArrayItems(payload.suggestedMoves);
    case "sales_intelligence":
      return firstArrayItems(payload.hiringSignals);
    case "account_snapshot":
      return firstArrayItems(payload.openTasks);
    case "pipeline_health":{
      const stages = Array.isArray(payload.funnelStages) ? payload.funnelStages as Array<{stageName: string; count: number}> : [];
      return stages.slice(0, 3).map(s => `${s.stageName}: ${s.count}`);
    }
    case "deal_risk":
      return firstArrayItems(payload.riskFactors);
    case "meeting_summary":
      return firstArrayItems(payload.decisions);
    default:
      return [];
  }
}

function buildExpertResult(expertExecution: ExpertExecutionResult) {
  return {
    resultType: "expert" as const,
    result: {
      kind: "expert" as const,
      expertType: expertExecution.expertType,
      expertGroup: expertExecution.expertGroup,
      rendererKey: expertExecution.rendererKey,
      payload: expertExecution.payload,
      suggestedActions: expertExecution.suggestedActions,
    },
  };
}

function buildIntegrationRecordsResult(plan: CommandPlan, toolResult: Record<string, unknown>) {
  const module = typeof toolResult.module === "string" ? toolResult.module : "records";
  const provider =
    module === "threads" || Array.isArray(toolResult.threads)
      ? "gmail"
      : "hubspot";
  const rawRecords =
    Array.isArray(toolResult.records)
      ? toolResult.records
      : Array.isArray(toolResult.candidates)
        ? toolResult.candidates
        : Array.isArray(toolResult.threads)
          ? toolResult.threads
          : toolResult.record && typeof toolResult.record === "object"
            ? [toolResult.record]
            : [];
  const deriveRecordTitle = (record: Record<string, unknown>) => {
    const properties =
      record.properties && typeof record.properties === "object"
        ? (record.properties as Record<string, unknown>)
        : record;
    const firstName = typeof properties.firstname === "string" ? properties.firstname : "";
    const lastName = typeof properties.lastname === "string" ? properties.lastname : "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
    const company = typeof properties.company === "string" ? properties.company : "";
    const dealName = typeof properties.dealname === "string" ? properties.dealname : "";
    const subject = typeof properties.subject === "string" ? properties.subject : "";
    const email = typeof properties.email === "string" ? properties.email : "";

    const candidates = [
      record.title,
      record.label,
      record.subject,
      fullName,
      company,
      dealName,
      subject,
      email,
      "Untitled record",
    ];
    const title = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
    return String(title ?? "Untitled record");
  };
  const deriveRecordSubtitle = (record: Record<string, unknown>) => {
    const properties =
      record.properties && typeof record.properties === "object"
        ? (record.properties as Record<string, unknown>)
        : record;
    const email = typeof properties.email === "string" ? properties.email : null;
    const jobTitle = typeof properties.jobtitle === "string" ? properties.jobtitle : null;
    const domain = typeof properties.domain === "string" ? properties.domain : null;
    const stage = typeof properties.dealstage === "string" ? properties.dealstage : null;

    if (typeof record.subtitle === "string") return record.subtitle;
    if (typeof record.description === "string") return record.description;
    if (typeof record.snippet === "string") return record.snippet;
    return [jobTitle, email, domain, stage].filter(Boolean).join(" · ") || null;
  };
  const records = rawRecords
    .filter((record): record is Record<string, unknown> => Boolean(record) && typeof record === "object")
    .map((record) => ({
      id: String(record.id ?? record.recordId ?? record.threadId ?? ""),
      title: deriveRecordTitle(record),
      subtitle: deriveRecordSubtitle(record),
      url: typeof record.url === "string" ? record.url : null,
      metadata: record,
    }));
  const status =
    typeof toolResult.status === "string"
      ? toolResult.status
      : records.length
        ? "completed"
        : "empty";

  return {
    resultType: "integration_records" as const,
    result: {
      kind: "integration_records" as const,
      provider,
      module,
      query: typeof toolResult.query === "string" ? toolResult.query : null,
      status,
      summary: plan.answer,
      records,
      availableActions: provider === "hubspot"
        ? ["Brief", "Create task", "Add note", "Prepare update"]
        : ["Summarize", "Draft reply", "Prepare send approval"],
    },
  };
}

export function buildExpertSuggestedActions(
  expertType: ExpertExecutionResult["expertType"],
  selectedItem: ReturnType<typeof parseSelectedExpertItem>,
) {
  const actions: ExpertExecutionResult["suggestedActions"] = [];

  if (expertType === "outreach_draft" && selectedItem?.provider === "gmail") {
    actions.push({
      id: "prepare-gmail-send",
      label: "Prepare Gmail approval",
      actionType: "prepare_gmail_send",
      requiresApproval: true,
      riskLevel: "medium",
    });
  }

  if (expertType === "opportunity_scorecard" && selectedItem?.provider === "hubspot") {
    actions.push({
      id: "prepare-hubspot-update",
      label: "Prepare HubSpot update",
      actionType: "prepare_hubspot_update",
      requiresApproval: true,
      riskLevel: "medium",
    });
  }

  const workflowEligible = expertType !== "outreach_draft";
  if (workflowEligible) {
    actions.push({
      id: "suggest-workflow",
      label: "Turn this into a workflow",
      actionType: "create_workflow",
      requiresApproval: false,
      riskLevel: "low",
    });
  }

  return actions;
}

function buildResult(
  mode: CommandMode,
  plan: CommandPlan,
  toolResult: Record<string, unknown> | null,
  createdWorkflow: {
    workflowId: string;
    name: string;
    triggerType: string;
    stepCount: number;
  } | null,
  createdArtifact: {
    artifactId: string;
    title: string;
    artifactType: string;
    previewText: string;
  } | null,
  expertExecution: ExpertExecutionResult | null,
) {
  if (toolResult?.capabilityGuide && typeof toolResult.capabilityGuide === "object") {
    return {
      resultType: "capability_guide" as const,
      result: {
        kind: "capability_guide" as const,
        ...(toolResult.capabilityGuide as Record<string, unknown>),
      },
    };
  }

  if (
    toolResult &&
    (
      Array.isArray(toolResult.records) ||
      Array.isArray(toolResult.candidates) ||
      Array.isArray(toolResult.threads) ||
      Boolean(toolResult.record && typeof toolResult.record === "object") ||
      (typeof toolResult.module === "string" && typeof toolResult.status === "string" && ["empty", "not_found", "multiple_matches"].includes(toolResult.status))
    )
  ) {
    return buildIntegrationRecordsResult(plan, toolResult);
  }

  if (expertExecution) {
    return buildExpertResult(expertExecution);
  }

  const shared = {
    summary: plan.answer,
    highlights: plan.highlights,
    sections: plan.sections,
    ...(Array.isArray(toolResult?.candidates) ? { candidates: toolResult.candidates } : {}),
    ...(typeof toolResult?.status === "string" ? { status: toolResult.status } : {}),
    ...(typeof toolResult?.completeness === "number"
      ? { completeness: toolResult.completeness }
      : {}),
    ...(typeof toolResult?.freshness === "string"
      ? { freshness: toolResult.freshness }
      : {}),
    ...(Array.isArray(toolResult?.failedSources)
      ? { failedSources: toolResult.failedSources }
      : {}),
    ...(toolResult?.partialResult === true ? { partialResult: true } : {}),
  };

  if (plan.workflowDraft && !createdWorkflow) {
    const workflowDraft = plan.workflowDraft;
    return {
      resultType: "workflow_draft" as const,
      result: {
        kind: "workflow_draft" as const,
        summary: plan.answer,
        sections: plan.sections,
        draft: {
          draftId: workflowDraft.draftId ?? hashInput(JSON.stringify(workflowDraft)),
          name: workflowDraft.name,
          description: workflowDraft.description ?? null,
          trigger: {
            type: workflowDraft.triggerType,
            config: workflowDraft.triggerType === "schedule"
              ? { cron: workflowDraft.cron ?? "0 9 * * *", timezone: workflowDraft.timezone ?? "UTC" }
              : {},
          },
          deliveryIntent: workflowDraft.deliveryIntent ?? "in_app",
          steps: workflowDraft.steps.map((step, index) => ({
            id: step.id ?? `draft-step-${index + 1}`,
            type: step.type,
            name: step.name,
            config: {
              ...step.config,
              ...(step.inputStepIds?.length ? { inputStepIds: step.inputStepIds } : {}),
            },
            order: step.order ?? index,
          })),
          validationIssues: workflowDraft.validationIssues ?? [],
          clarificationQuestions: [
            ...(workflowDraft.clarificationQuestions ?? []),
            ...(plan.clarificationQuestion ? [plan.clarificationQuestion] : []),
          ],
        },
      },
    };
  }

  if (mode === "search") {
    return {
      resultType: "search" as const,
      result: {
        kind: "search",
        ...shared,
        provider: typeof toolResult?.provider === "string" ? toolResult.provider : null,
        confidence: typeof toolResult?.confidence === "number" ? toolResult.confidence : null,
      },
    };
  }

  if (mode === "research") {
    return {
      resultType: "research" as const,
      result: {
        kind: "research",
        ...shared,
        provider: typeof toolResult?.provider === "string" ? toolResult.provider : null,
        confidence: typeof toolResult?.confidence === "number" ? toolResult.confidence : null,
        artifactTitle: createdArtifact?.title ?? plan.artifact?.title ?? null,
      },
    };
  }

  if (mode === "extract_url") {
    return {
      resultType: "extract_url" as const,
      result: {
        kind: "extract_url",
        summary: plan.answer,
        sections: plan.sections,
        page: {
          url: typeof toolResult?.url === "string" ? toolResult.url : null,
          title: typeof toolResult?.title === "string" ? toolResult.title : null,
          publishDate: typeof toolResult?.publishDate === "string" ? toolResult.publishDate : null,
          provider: typeof toolResult?.provider === "string" ? toolResult.provider : null,
          sessionId: typeof toolResult?.sessionId === "string" ? toolResult.sessionId : null,
        },
        excerpts: Array.isArray(toolResult?.excerpts)
          ? toolResult.excerpts.filter((excerpt): excerpt is string => typeof excerpt === "string")
          : [],
      },
    };
  }

  if (mode === "workflow") {
    return {
      resultType: "workflow" as const,
      result: {
        kind: "workflow",
        summary: plan.answer,
        sections: plan.sections,
        workflow: createdWorkflow
          ? createdWorkflow
          : plan.workflowDraft
            ? {
                workflowId: null,
                name: plan.workflowDraft.name,
                triggerType: "manual",
                stepCount: 4,
              }
            : null,
      },
    };
  }

  if (plan.clarificationQuestion) {
    return {
      resultType: "clarification" as const,
      result: {
        kind: "clarification",
        summary: plan.answer,
        question: plan.clarificationQuestion,
      },
    };
  }

  return {
    resultType: "answer" as const,
    result: {
      kind: "answer",
      ...shared,
    },
  };
}

export class CommandGraphService {
  private readonly contextService: ContextService;
  private readonly activityService: ActivityService;
  private readonly toolRegistryService: ToolRegistryService;
  private readonly policyService: PolicyService;
  private readonly manifestService: GideonManifestService;
  private readonly workspaceContextService: WorkspaceContextService;

  constructor(private readonly db: Firestore) {
    this.contextService = new ContextService(db);
    this.activityService = new ActivityService(db);
    this.toolRegistryService = new ToolRegistryService(db);
    this.policyService = new PolicyService();
    this.manifestService = new GideonManifestService(db);
    this.workspaceContextService = new WorkspaceContextService(db);
  }

  private buildGraph() {
    const llmProvider = createLlmProvider();
    const classifierProvider = createClassifierProvider();

    const graph = new StateGraph(CommandState)
      .addNode("parseInput", async (state) => {
        return timeRequestPhase(state.request, "command.parse_input", async () => {
          const selectedAgent = state.selectedAgentId ? getVisibleAgent(state.selectedAgentId) : null;
          const slash = parseSlashMode(state.input);
          const requestedMode = slash.mode ?? state.requestedMode;
          const rollout = new AiRolloutService(this.db);
          const [routeV2Shadow, routeV2Active, contextV2, retrievalV2Active] = await Promise.all([
            rollout.isEnabled("ROUTE_V2_SHADOW", state.currentWorkspace.id),
            rollout.isEnabled("ROUTE_V2_ACTIVE", state.currentWorkspace.id),
            rollout.isEnabled("CONTEXT_V2", state.currentWorkspace.id),
            rollout.isEnabled("RETRIEVAL_V2_ACTIVE", state.currentWorkspace.id),
          ]);

          return {
            normalizedInput: slash.normalizedInput,
            requestedMode,
            selectedAgentName: selectedAgent?.name ?? "Gideon Orchestrator",
            rolloutFlags: { routeV2Shadow, routeV2Active, contextV2, retrievalV2Active },
            stepLogs: [`parse:${slash.mode ?? "none"}:${requestedMode}`],
          };
        });
      })
      .addNode("resolveMode", async (state) => {
        return timeRequestPhase(state.request, "command.resolve_mode", async () => {
          if (state.requestedMode !== "auto") {
            const budgetIntent = budgetIntentForMode(state.requestedMode);
            const execution = getAiExecutionContext();
            if (budgetIntent && !execution?.workflowStep) {
              execution?.applyBudgetProfile?.(budgetIntent);
            }
            return {
              resolvedMode: state.requestedMode,
              stepLogs: [`mode:${state.requestedMode}:requested`],
            };
          }

          if (state.rolloutFlags.routeV2Active) {
            return {
              resolvedMode: "auto" as const,
              stepLogs: ["mode:auto:route_v2_deferred"],
            };
          }

          const normalizedInput = state.normalizedInput || state.input;
          const isWorkflowRun = state.sessionId?.startsWith("workflow:");

          if (!isWorkflowRun && isWorkflowDraftQuery(normalizedInput)) {
            const execution = getAiExecutionContext();
            if (!execution?.workflowStep) {
              execution?.applyBudgetProfile?.("workflow_create");
            }
            return {
              resolvedMode: "workflow" as const,
              stepLogs: ["mode:workflow:deterministic_draft"],
            };
          }

          if (isCapabilityHelpQuery(normalizedInput)) {
            return {
              resolvedMode: "auto" as const,
              stepLogs: ["mode:auto:capability_help"],
            };
          }
          const referencedRecentResult = resolveReferencedRecentResult(
            normalizedInput,
            state.sessionState,
          );
          if (referencedRecentResult) {
            if (shouldEnrichResearchFollowUp(normalizedInput, referencedRecentResult)) {
              const execution = getAiExecutionContext();
              if (!execution?.workflowStep) {
                execution?.applyBudgetProfile?.("web_search");
              }
              return {
                resolvedMode: "search" as const,
                stepLogs: ["mode:search:typed_research_follow_up"],
              };
            }
            return {
              resolvedMode: "auto" as const,
              stepLogs: ["mode:auto:typed_result_follow_up"],
            };
          }
          const isFreshDiscovery = isFreshDiscoveryQuery(normalizedInput);
          if (isFreshDiscovery) {
            const execution = getAiExecutionContext();
            if (!execution?.workflowStep) {
              execution?.applyBudgetProfile?.("web_search");
            }
            return {
              resolvedMode: "search" as const,
              stepLogs: ["mode:search:fresh_discovery"],
            };
          }

          try {
            const isFollowUp = Boolean(state.sessionContext?.trim());
            const classification = await classifierProvider.generateStructured({
              schema: commandModeClassifierSchema,
              budgetScope: "routing",
              systemPrompt:
                "Classify the user request into the correct Gideon command mode. Default to auto — only use another mode when it clearly applies.\n\n" +
                "- auto: Use for follow-ups, clarifications, task requests, drafting, summarising existing data, or anything conversational. When uncertain, always pick auto.\n" +
                "- search: Only when the user explicitly wants a lightweight discovery or list of recent information, or says 'search for...'.\n" +
                "- research: Do not choose this in auto mode. It is reserved for explicit /research or manual Research mode selection.\n" +
                "- extract_url: Use whenever the user provides a URL and wants its contents read, analyzed, extracted, or summarised. Prioritize this if a URL is the main focus.\n" +
                "- workflow: Only when the user wants to build an automation, workflow, or recurring routine.\n\n" +
                "When in doubt, use auto. For fresh/current public-web discovery in auto mode, use search. Never silently escalate to research.",
              userPrompt: buildClassifierUserPrompt({
                isFollowUp,
                agentName: state.selectedAgentName,
                input: state.normalizedInput || state.input,
              }),
            });

            let finalMode = classification.mode === "research" ? "search" : classification.mode;
            const isWorkflowRun = state.sessionId?.startsWith("workflow:");

            // Critical safeguard: An automated background workflow step cannot be in "workflow" mode,
            // because that mode is explicitly for DESIGNING/BUILDING workflows. If it falls into this,
            // it will output meta-text like "Will populate after workflow run".
            if (isWorkflowRun && finalMode === "workflow") {
              finalMode = "auto";
            }
            const budgetIntent = budgetIntentForMode(finalMode);
            const execution = getAiExecutionContext();
            if (budgetIntent && !execution?.workflowStep) {
              execution?.applyBudgetProfile?.(budgetIntent);
            }

            return {
              resolvedMode: finalMode,
              stepLogs: [`mode:${finalMode}:llm${classification.mode !== finalMode ? '_overridden' : ''}`],
            };
          } catch (error) {
            logger.warn("Mode classifier failed; falling back to auto", {
              workspaceId: state.currentWorkspace.id,
              error: error instanceof Error ? error.message : "unknown",
            });
            return {
              resolvedMode: "auto",
              stepLogs: ["mode:auto:fallback"],
            };
          }
        });
      })
      .addNode("context", async (state) => {
        return timeRequestPhase(state.request, "command.context", async () => {
          if (
            state.resolvedMode === "search" ||
            isCapabilityHelpQuery(state.normalizedInput || state.input)
          ) {
            return {
              contextBundleId: state.contextBundleId ?? "",
              contextFreshness: "fresh",
              contextSummary: "",
              sourceRefs: state.sourceRefs,
              missingContext: state.missingContext,
              stepLogs: ["context:search:minimal"],
            };
          }

          // contextResult holds either a reused bundle or a freshly built one
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let contextResult: { bundle: any; reused: boolean } | null = null;

          // Try to reuse the provided contextBundleId first, but fall back gracefully
          // if the bundle is stale or no longer exists (e.g. after a Gmail re-sync)
          if (state.contextBundleId) {
            try {
              contextResult = {
                bundle: await this.contextService.getBundle(state.currentWorkspace.workspace, state.contextBundleId),
                reused: true,
              };
            } catch {
              // Bundle not found or expired — build a fresh one below
              contextResult = null;
            }
          }

          if (!contextResult) {
            contextResult = await this.contextService.buildOrReuseBundle({
              workspace: state.currentWorkspace.workspace,
              userId: state.userId,
              key: `command:${state.selectedAgentId ?? "gideon"}:${state.resolvedMode}`,
              purpose: "Command execution context",
              payload: {
                input: state.normalizedInput || state.input,
                agentId: state.selectedAgentId ?? null,
                mode: state.resolvedMode,
              },
            });
          }

          state.progressEmit?.("command.context_loaded", { contextFreshness: contextResult.bundle.freshness });
          return {
            contextBundleId: contextResult.bundle.id,
            contextFreshness: contextResult.bundle.freshness,
            contextSummary: JSON.stringify(contextResult.bundle.content),
            sourceRefs: contextResult.bundle.sourceRefs,
            missingContext: contextResult.bundle.missingSources ?? [],
            stepLogs: [`context:${contextResult.reused ? "reused" : "built"}:${contextResult.bundle.freshness}`],
          };
        });
      })
      .addNode("capabilities", async (state) =>
        timeRequestPhase(state.request, "command.tool_build", async () => {
          const availableCapabilities =
            state.resolvedMode === "search"
              ? ["web.researchTask"]
              : isCapabilityHelpQuery(state.normalizedInput || state.input)
                ? []
              : await this.toolRegistryService.listCapabilities(state.currentWorkspace);
          
          const sopRegistry = new SopRegistryService(this.db);
          const relevantSops =
            state.resolvedMode === "search" || isCapabilityHelpQuery(state.normalizedInput || state.input)
              ? []
              : await sopRegistry.retrieveRelevantSops(state.normalizedInput || state.input);
          const retrievedSopsBlock = sopRegistry.formatSopsForPrompt(relevantSops);
          
          const selectedItem = parseSelectedExpertItem(state.contextSummary);
          const referencedRecentResult = resolveReferencedRecentResult(
            state.normalizedInput || state.input,
            state.sessionState,
          );
          const routeInput = {
            userQuery: state.normalizedInput || state.input,
            explicitMode: state.requestedMode,
            originSurface: state.requestEnvelope?.originSurface ?? "command_center",
            selectedItem,
            selectedAgentId: state.selectedAgentId,
            availableCapabilities,
            sessionState: state.sessionState,
            workspaceId: state.currentWorkspace.id,
            userId: state.userId,
          } as const;

          const scheduleShadowComparison = (
            liveIntent: SemanticIntentResult["intent"],
          ) => {
            if (!state.rolloutFlags.routeV2Shadow || state.rolloutFlags.routeV2Active) {
              return;
            }
            void runWithoutAiExecutionContext(() =>
              new CommandRouterV2(this.db).route(routeInput),
            )
              .then((shadowDecision) => {
                const legacyV2Intent = toLegacySemanticIntent(shadowDecision).intent;
                logger.info("Route V2 comparison", {
                  workspaceId: state.currentWorkspace.id,
                  liveIntent,
                  v2Intent: shadowDecision.intent,
                  v2ToolStrategy: shadowDecision.toolStrategy,
                  agreement: liveIntent === legacyV2Intent,
                  providerFalseTrigger:
                    Boolean(shadowDecision.provider) &&
                    liveIntent !== "email_action" &&
                    liveIntent !== "crm_action",
                  v2Confidence: shadowDecision.confidence,
                });
              })
              .catch((error) => {
                logger.warn("Route V2 shadow comparison failed", {
                  workspaceId: state.currentWorkspace.id,
                  error: error instanceof Error ? error.message : String(error),
                });
              });
          };

          let routeDecision: RouteDecision | null = state.requestEnvelope?.routeDecision ?? null;
          if (!routeDecision && state.rolloutFlags.routeV2Active) {
            routeDecision = await new CommandRouterV2(this.db).route(routeInput);
          }

          if (state.rolloutFlags.routeV2Active && routeDecision) {
            let mappedMode: CommandMode =
              routeDecision.action === "extract_url"
                ? "extract_url"
                : routeDecision.toolStrategy === "web_search"
                  ? "search"
                  : routeDecision.toolStrategy === "deep_research"
                    ? "research"
                    : routeDecision.intent === "workflow_create"
                      ? "workflow"
                      : "auto";

            // Critical safeguard: An automated background workflow step cannot be in "workflow" mode
            const isWorkflowRun = state.sessionId?.startsWith("workflow:");
            if (isWorkflowRun && mappedMode === "workflow") {
              mappedMode = "auto";
            }

            const execution = getAiExecutionContext();
            if (execution) {
              if (!execution.workflowStep) {
                execution.applyBudgetProfile?.(routeDecision.intent);
              }
              execution.routeDecision = routeDecision;
            }
            return {
              availableCapabilities,
              semanticIntent: toLegacySemanticIntent(routeDecision),
              routeDecision,
              resolvedMode: mappedMode,
              retrievedSopsBlock,
              stepLogs: ["capabilities:loaded", `route_v2:${routeDecision.intent}`],
            };
          }

          const semanticIntent: SemanticIntentResult =
            state.resolvedMode === "search" || state.resolvedMode === "research"
              ? {
                  intent: "research",
                  expertCapabilityId: null,
                  integrationParams: null,
                  reason: `deterministic_${state.resolvedMode}_mode`,
                }
              : referencedRecentResult
                ? {
                    intent: "normal_answer",
                    expertCapabilityId: null,
                    integrationParams: null,
                    reason: "typed_session_result_follow_up",
                  }
                : isCapabilityHelpQuery(state.normalizedInput || state.input)
                  ? {
                      intent: "normal_answer",
                      expertCapabilityId: null,
                      integrationParams: null,
                      reason: "capability_help_request",
                    }
              : await new SemanticIntentClassifier().classify({
                  userQuery: state.normalizedInput || state.input,
                  selectedItem,
                  availableCapabilities,
                  retrievedExpertSopMetadata: [
                    ...relevantSops.map((sop) => ({
                      capabilityId: sop.id,
                      description: sop.title,
                    })),
                    ...expertCapabilities
                      .filter((cap) => cap.lifecycleStatus === "active")
                      .map((cap) => ({
                        capabilityId: cap.id,
                        description: cap.description,
                      })),
                  ],
                });
          scheduleShadowComparison(semanticIntent.intent);

          // Prevent CRM/Expert hallucination in automated background workflows
          const isWorkflowRun = state.sessionId?.startsWith("workflow:");
          if (isWorkflowRun) {
            const queryLower = (state.normalizedInput || state.input).toLowerCase();
            const explicitlyMentionsHubSpot = queryLower.includes("hubspot") || queryLower.includes("crm") || queryLower.includes("deal") || queryLower.includes("contact");
            if (!explicitlyMentionsHubSpot && (semanticIntent.intent === "crm_action" || semanticIntent.intent === "expert_tool")) {
              semanticIntent.intent = "normal_answer";
              semanticIntent.expertCapabilityId = null;
              semanticIntent.integrationParams = null;
              semanticIntent.reason = "Forced normal_answer due to workflow safeguard without explicit CRM mentions";
            }
          }

          return {
            availableCapabilities,
            semanticIntent,
            routeDecision: null,
            routeComparison: null,
            retrievedSopsBlock,
            stepLogs: ["capabilities:loaded"],
          };
        }),
      )
      .addNode("toolExecution", async (state) => {
        if (
          state.rolloutFlags.routeV2Active &&
          state.routeDecision &&
          state.routeDecision.toolStrategy !== "web_search" &&
          state.routeDecision.toolStrategy !== "deep_research"
        ) {
          return { stepLogs: [`tool:v2:${state.routeDecision.toolStrategy}:deferred`] };
        }

        if (state.resolvedMode === "auto") {
          return { stepLogs: ["tool:auto:skipped"] };
        }

        if (shouldSkipToolExecution(state.resolvedMode)) {
          return { stepLogs: [`tool:${state.resolvedMode}:skipped`] };
        }

        const toolName = toolNameForMode(state.resolvedMode) ?? "web.researchTask";

        // null = no agent selected, no restriction; string[] = resolved allowedTools (may be empty)
        const toolFilter: string[] =
          state.agentAllowedTools !== null
            ? [toolName].filter((name) => (state.agentAllowedTools as string[]).includes(name))
            : [toolName];

        let workspaceContextPackage = "";
        let retrievalContextStr = "";
        if (state.resolvedMode !== "search") {
          try {
            workspaceContextPackage = await this.workspaceContextService.buildContextPackage(state.currentWorkspace, {
              selectedAgentName: state.selectedAgentName,
              resolvedMode: state.resolvedMode,
              userProfile: state.userProfile ?? undefined,
            });
          } catch {}

          const retrievalResults = await new RetrievalService(this.db).retrieve(
            state.currentWorkspace.id,
            state.normalizedInput || state.input,
            {
              topK: 6,
              collections: ["artifacts", "session_summaries", "memory"],
              userId: state.userId,
              userRole: state.currentWorkspace.role,
              useIndexedSources: state.rolloutFlags.retrievalV2Active,
              sourceTypes: ["artifact", "session_summary", "memory_fact", "uploaded_document"],
            },
          );
          retrievalContextStr = RetrievalService.formatForPrompt(retrievalResults);
        }

        const contextPacket: import("../../schemas/toolTypes.js").ToolContextPacket = {
          sessionContext: state.sessionContext || "",
          workspaceContext: workspaceContextPackage,
          selectedItemContext: buildSelectedContextPromptBlock(state.contextSummary),
          retrievedContext: retrievalContextStr,
          sourceRefs: state.sourceRefs,
          semanticIntent: state.semanticIntent?.intent,
        };

        const availableTools = this.toolRegistryService.buildToolSetFromCapabilities(
          state.currentWorkspace,
          state.userId,
          state.availableCapabilities,
          toolFilter,
          undefined,
          state.request,
          contextPacket,
        );
        const targetTool = availableTools.find((tool) => tool.name === toolName);

        if (!targetTool) {
          return {
            toolResult: null,
            missingContext: Array.from(new Set([...state.missingContext, `Tool unavailable: ${toolName}`])),
            stepLogs: [`tool:${toolName}:unavailable`],
          };
        }

        state.progressEmit?.("command.tool_started", { toolName, mode: state.resolvedMode });
        try {
          return await timeRequestPhase(state.request, "command.tool_execute", async () => {
          if (state.resolvedMode === "extract_url") {
            const urls = extractUrls(state.normalizedInput || state.input);

            if (!urls.length) {
              return {
                toolResult: null,
                missingContext: Array.from(new Set([...state.missingContext, "Provide a public URL to extract."])),
                stepLogs: ["tool:web.extractUrl:missing_url"],
                retrievalContext: retrievalContextStr,
              };
            }

            const objective = (state.normalizedInput || state.input).replace(urlPattern, "").trim();
            const result = (await targetTool.invoke({
              urls,
              objective: objective || undefined,
              includeFullContent: true,
            })) as Record<string, unknown>;
            const toolSourceRefs = Array.isArray(result.sourceRefs)
              ? (result.sourceRefs as SourceRef[])
              : [];

            state.progressEmit?.("command.tool_completed", { toolName, status: String(result.status ?? "completed") });
            return {
              toolResult: result,
              sourceRefs: [...state.sourceRefs, ...toolSourceRefs],
              stepLogs: [`tool:web.extractUrl:${String(result.status ?? "completed")}`],
              retrievalContext: retrievalContextStr,
            };
          }

          const referencedRecentResult = resolveReferencedRecentResult(
            state.normalizedInput || state.input,
            state.sessionState,
          );
          const researchPrompt = referencedRecentResult
            ? buildResearchFollowUpPrompt(
                state.normalizedInput || state.input,
                referencedRecentResult,
                state.sessionContext,
              )
            : state.normalizedInput || state.input;
          const result = (await targetTool.invoke({
            prompt: researchPrompt,
            processor: state.resolvedMode === "research" ? "pro" : "lite",
            depth: state.resolvedMode === "research" ? "deep" : "quick",
            maxPollAttempts: state.resolvedMode === "search" ? 12 : 20,
            pollTimeoutSeconds: state.resolvedMode === "search" ? 15 : 25,
            pollIntervalMs: state.resolvedMode === "search" ? 1500 : 2000,
          })) as Record<string, unknown>;
          const toolSourceRefs = Array.isArray(result.sourceRefs)
            ? (result.sourceRefs as SourceRef[])
            : [];

          state.progressEmit?.("command.tool_completed", { toolName, status: String(result.status ?? "completed") });
          return {
            toolResult: result,
            sourceRefs: [...state.sourceRefs, ...toolSourceRefs],
            stepLogs: [`tool:web.researchTask:${String(result.status ?? "completed")}:${state.resolvedMode}`],
            retrievalContext: retrievalContextStr,
          };
          });
        } catch (error) {
          if (
            error instanceof AiBudgetExceededError ||
            (error instanceof Error &&
              (error.name === "AbortError" ||
                error.message.toLowerCase().includes("aborted")))
          ) {
            const reason =
              error instanceof AiBudgetExceededError ? error.reason : "deadline";
            return {
              toolResult: {
                status: "unavailable",
                contentText: "",
                completeness: 0,
                confidence: 0,
                freshness: "missing",
                failedSources: [`research:${reason}`],
                partialResult: true,
              },
              missingContext: Array.from(
                new Set([
                  ...state.missingContext,
                  "Live web research is temporarily unavailable.",
                ]),
              ),
              stepLogs: [`tool:${toolName}:budget_${reason}`],
            };
          }

          if (error instanceof ApiError && error.code === "WEB_PROVIDER_TIMEOUT") {
            return {
              toolResult: {
                status: "timeout",
                contentText: "",
                completeness: 0,
                confidence: 0,
                freshness: "missing",
                failedSources: ["research:timeout"],
                partialResult: true,
              },
              missingContext: Array.from(
                new Set([
                  ...state.missingContext,
                  state.resolvedMode === "search"
                    ? "Search timed out before enough external context could be gathered."
                    : "Research timed out before enough external context could be gathered.",
                ]),
              ),
              stepLogs: [`tool:${toolName}:timeout`],
            };
          }

          logger.warn("Tool execution failed; continuing without tool output", {
            workspaceId: state.currentWorkspace.id,
            toolName,
            error: error instanceof Error ? error.message : "unknown",
          });

          return {
            toolResult: {
              status: "unavailable",
              contentText: "",
              completeness: 0,
              confidence: 0,
              freshness: "missing",
              failedSources: ["research:provider_error"],
              partialResult: true,
            },
            missingContext: Array.from(
              new Set([
                ...state.missingContext,
                "Live web research is temporarily unavailable.",
              ]),
            ),
            stepLogs: [`tool:${toolName}:error`],
          };
        }
      })
      .addNode("planner", async (state) =>
        timeRequestPhase(state.request, "command.planner", async () => {
          state.progressEmit?.("command.planning", { mode: state.resolvedMode });
          let plannerToolResult = state.toolResult;
          let toolSummary = summarizeToolResult(plannerToolResult);

          const semanticIntent = state.semanticIntent;
          if (!semanticIntent) {
            throw new Error("Semantic intent not computed");
          }


          if (isCapabilityHelpQuery(state.normalizedInput || state.input)) {
            const payload = buildCapabilityHelpPayload(
              state.normalizedInput || state.input,
              state.availableCapabilities,
              state.selectedAgentName,
            );
            return {
              plan: buildCapabilityHelpPlan(
                state.normalizedInput || state.input,
                state.availableCapabilities,
                state.selectedAgentName,
              ),
              toolResult: {
                status: "ready",
                capabilityGuide: payload,
              },
              expertExecution: null,
              semanticIntent,
              stepLogs: ["planner:capability_help:deterministic"],
            };
          }

          let modeInstructions = "";
          const isCompanyReview = semanticIntent.intent === "analyze_company" || semanticIntent.intent === "evaluate_website" || state.normalizedInput?.includes("review");
          const isGrantResearch = state.normalizedInput?.includes("grant") || state.normalizedInput?.includes("funding");
          const isNewsSummary = state.normalizedInput?.includes("news") || state.normalizedInput?.includes("top");

          if (isCompanyReview) {
            modeInstructions = "Produce a structured Startup/Company Review. Include: Company summary, ICP (Target Customer), Value Prop, Strengths, Weaknesses/Gaps, Differentiation, Messaging review, GTM/funding suggestions, Next Steps, and Sources. Be opinionated and practically useful for founders.";
          } else if (isGrantResearch) {
            modeInstructions = "Produce structured Grant/Funding Research. Include: Official link, Region/Eligibility, Amount/Benefit, Deadline/Status, Fit score for the company, Why it fits, Next action. If geography is unclear, explicitly ask for the target region or clearly state assumptions. Always prioritize official sources.";
          } else if (isNewsSummary) {
            modeInstructions = "Produce a structured News Summary. Include: Ranked list, Full Headline, Source/Domain, Short summary, Why it matters, and Link. Do not truncate headlines.";
          } else if (state.resolvedMode === "search") {
            modeInstructions = "Produce a concise sourced discovery answer with useful bullets or highlights. Keep it compact and actionable.";
          } else if (state.resolvedMode === "research") {
            modeInstructions = "Produce a deeper sourced research answer with clear sections. Prefer artifact-worthy structure and preserve uncertainty.";
          } else if (state.resolvedMode === "workflow") {
            modeInstructions = "Design a complete, logical workflow draft to achieve the user's goal. Use the `workflowDraft` object. Choose the correct triggerType and cron schedule based on their request. Use 'fetch_url', 'agent', 'monitor', 'artifact', 'integration.read' (hubspot only), or 'notification' step types. Gmail and Salesforce steps are coming soon — never use them; to deliver results by email use a notification step with channel 'system_email'. Keep steps focused and essential.";
          } else if (state.resolvedMode === "extract_url") {
            modeInstructions = "Summarize the extracted page clearly. Provide a concise summary plus key evidence directly from the page. Use the extracted page content as the source of truth.";
          } else {
            modeInstructions = "Answer directly and clearly.";
          }

          const shapingGuardrails = "QUALITY GUARDRAILS:\n- Did you answer the actual ask, or just summarize?\n- Did you reuse prior context (like the workspace or company) naturally?\n- Are sources attached?\n- Is a structured output (table/card) better than a paragraph?\n- Do not hallucinate missing facts.\n- Explicitly state if you used 'direct URL extraction', 'multi-page crawl', 'web search', or 'previous session output'.";


          const globalWritingRules = "If the user asks you to prepare, write, draft, or create a substantive document (like a pitch deck, report, or blog post), or if you are producing a research report, you MUST act as a ghostwriter and write the ACTUAL final text of the document. Do NOT write an outline, and do NOT write instructions on what should be included. You MUST output the full, comprehensive content using the `sections` array to break it down logically. The `answer` field should ONLY contain a brief introductory sentence. Do NOT duplicate the tables, lists, or substantive content in the `answer` field if it is already in the `sections` array. Do NOT use the `artifact` field. If you are drafting an email or message via an approval, DO NOT include the drafted text in your `answer` or `sections`.";

          const crmRules = (state.semanticIntent?.intent === "crm_action" || state.semanticIntent?.intent === "expert_tool")
            ? "CRM APPROVAL RULES — read carefully:\n• For UPDATES (hubspot.prepareUpdateApproval): fields are module, recordId, updates. The key is 'updates' NOT 'properties'. module MUST be exactly 'contacts', 'companies', or 'deals' (plural, never singular like 'contact'). recordId MUST be the exact numeric ID from [TOOL RESULT] (a long number like '489722284741'). NEVER invent a recordId. Example: { module: 'contacts', recordId: '489722284741', updates: { jobtitle: 'Secretary' } }. Common HubSpot property names: jobtitle (job title/occupation/title), firstname, lastname, email, phone, lifecyclestage, company.\n• For CREATES (hubspot.prepareCreateApproval): fields are module, properties. The key is 'properties' NOT 'updates'. Example: { module: 'contacts', properties: { firstname: 'Jane', lastname: 'Smith', email: 'jane@acme.com' } }.\n• If no numeric recordId is available in the tool result, do NOT create an approval — ask the user to specify the record first."
            : "";

          const workflowRules = state.sessionId?.startsWith("workflow:")
            ? "WORKFLOW RULES: You are executing a background workflow step. 1. NEVER truncate, clip, or summarize data 'for brevity'—always output the FULL comprehensive list, table, or payload so the next step receives all data. 2. DO NOT mention or apologize for missing integrations (like HubSpot or CRM); just process the data you have. 3. NEVER output meta-commentary, confirmations, or chatty text like 'I corrected the plan', 'Here is the data', 'Will populate after run', or 'I have searched the web'. ONLY output the final processed data or formatted document."
            : "";

          modeInstructions = [modeInstructions, globalWritingRules, crmRules, workflowRules, shapingGuardrails].filter(Boolean).join("\n\n");

          const clarificationInstruction = "CLARIFICATION RULE: If the user's request is dangerously ambiguous (e.g., 'Draft an email to John' when there are multiple Johns in context, or missing required context for an action), you MUST NOT guess. Instead, set the `intent` to 'clarification' and populate the `clarificationQuestion` field to ask the user what they meant.";
          const workspaceInstruction = `WORKSPACE CONTEXT: You are operating within the workspace "${state.currentWorkspace.workspace.name}". USE this context to naturally personalize your response.`;
          const sourceRefsInstruction = state.sourceRefs.length > 0 ? `RECENT SOURCES EXTRACTED: \n${state.sourceRefs.map(r => `- ${r.title || r.url || r.sourceId}`).join('\n')}\nUse the above sources to answer questions accurately.` : "";
          let finalModeInstructions = `${modeInstructions}\n\n${clarificationInstruction}\n\n${workspaceInstruction}\n\n${sourceRefsInstruction}`;

          const referencedRecentResult = resolveReferencedRecentResult(
            state.normalizedInput || state.input,
            state.sessionState,
          );

          // Retrieve relevant context from artifacts, session summaries, and active memory
          let retrievalContext = state.retrievalContext;
          if (!retrievalContext) {
            const isWorkflowRun = state.requestEnvelope?.originSurface === "workflow_run";
            const collectionsToRetrieve: Array<"artifacts" | "session_summaries" | "memory"> = isWorkflowRun
              ? ["memory"]
              : ["artifacts", "session_summaries", "memory"];

            const retrievalResults = await new RetrievalService(this.db).retrieve(
              state.currentWorkspace.id,
              state.normalizedInput || state.input,
              {
                topK: isWorkflowRun ? 3 : 6,
                collections: collectionsToRetrieve,
                userId: state.userId,
                userRole: state.currentWorkspace.role,
                useIndexedSources: state.rolloutFlags.retrievalV2Active,
                sourceTypes: isWorkflowRun ? ["memory_fact"] : ["artifact", "session_summary", "memory_fact", "uploaded_document"],
              },
            );
            retrievalContext = RetrievalService.formatForPrompt(retrievalResults);
            if (retrievalContext && !isWorkflowRun) {
              retrievalContext = `${retrievalContext}\n\n[SYSTEM RULE: The above is retrieved context from past interactions. DO NOT repeat past system responses, summaries, or drafts (e.g., "I drafted a workflow", "I found emails") as your current answer. Only use past context if it contains facts directly relevant to the user's CURRENT query.]`;
            }
          }
          
          if (referencedRecentResult) {
            retrievalContext =
              `${formatRecentResultForPrompt(
                referencedRecentResult,
                state.sessionContext,
              )}\n\n${retrievalContext}`;
            const constraint =
              "CONSTRAINT: The user explicitly referenced the prior result. Operate on those exact items and do not ask which list or result they mean.";
            finalModeInstructions = `${finalModeInstructions}\n\n${constraint}`;
            if (referencedRecentResult.resultKind === "workflow_draft") {
              finalModeInstructions = `${finalModeInstructions}\n\nWORKFLOW DRAFT EDIT RULE: The user is editing the prior unsaved workflow draft. Return the complete updated workflowDraft object with all previous steps preserved unless the user asked to remove or replace them. Do not save or activate it automatically.`;
            }
          }


          const retrievedSopsBlock = state.retrievedSopsBlock || "";

          const selectedContextBlock = buildSelectedContextPromptBlock(state.contextSummary);
          const selectedItem = parseSelectedExpertItem(state.contextSummary);

          // Build workspace-aware capability manifest (system prompt)
          let manifest: string;
          try {
            manifest = await this.manifestService.buildManifest(state.currentWorkspace);
          } catch (manifestError) {
            logger.warn("Manifest build failed; using minimal fallback", {
              workspaceId: state.currentWorkspace.id,
              error: manifestError instanceof Error ? manifestError.message : "unknown",
            });
            manifest =
              "You are Gideon — a warm, sharp, and genuinely helpful AI Chief of Staff built for founders and operators. " +
              "Be warm but efficient. Greet users, acknowledge their context, use light compliments when warranted. " +
              "Help users research, draft, and automate anything they need. " +
              "Route every external action through an Approval — never act without it. Do not invent facts.";
          }

          // Build workspace context package (what this workspace/session knows)
          let workspaceContextPackage: string;
          try {
            workspaceContextPackage = await this.workspaceContextService.buildContextPackage(
              state.currentWorkspace,
              { 
                selectedAgentName: state.selectedAgentName, 
                resolvedMode: state.resolvedMode,
                userProfile: state.userProfile ?? undefined 
              },
            );
          } catch (contextError) {
            logger.warn("Workspace context package build failed; omitting", {
              workspaceId: state.currentWorkspace.id,
              error: contextError instanceof Error ? contextError.message : "unknown",
            });
            workspaceContextPackage = "";
          }

          logger.debug("Planner context assembled", {
            workspaceId: state.currentWorkspace.id,
            resolvedMode: state.resolvedMode,
            manifestChars: manifest.length,
            contextPackageChars: workspaceContextPackage.length,
            selectedContextChars: selectedContextBlock.length,
            sessionContextChars: state.sessionContext?.length ?? 0,
            retrievalContextChars: retrievalContext.length,
            toolSummaryChars: toolSummary.length,
            totalUserPromptChars: [
              workspaceContextPackage,
              selectedContextBlock,
              state.sessionContext,
              retrievalContext,
              toolSummary,
              state.normalizedInput || state.input,
            ]
              .filter(Boolean)
              .join("\n\n").length,
          });

          // Phase 3.5: Execute Dynamic CRM Reads for "read" intents OR expert tools needing HubSpot
          let shouldExecuteHubspotRead = false;
          let targetModuleForRead: HubSpotAutoModule | null = null;
          let targetQueryForRead = "";

          if (
            semanticIntent.intent !== "clarification_needed" &&
            semanticIntent.intent !== "normal_answer" &&
            semanticIntent.integrationParams?.provider === "hubspot" &&
            (semanticIntent.integrationParams?.action === "read" || semanticIntent.intent === "expert_tool") &&
            semanticIntent.integrationParams?.module
          ) {
            shouldExecuteHubspotRead = true;
            targetModuleForRead = semanticIntent.integrationParams.module as HubSpotAutoModule;
            targetQueryForRead = semanticIntent.integrationParams.targetQuery || "";
          } else if (semanticIntent.intent === "expert_tool" && semanticIntent.expertCapabilityId) {
            const cap = expertCapabilities.find(c => c.id === semanticIntent.expertCapabilityId);
            if (cap && cap.requiredContext?.includes("hubspot_record")) {
              shouldExecuteHubspotRead = true;
              targetQueryForRead = semanticIntent.integrationParams?.targetQuery || state.normalizedInput || state.input;
              
              if (semanticIntent.integrationParams?.module) {
                targetModuleForRead = semanticIntent.integrationParams.module as HubSpotAutoModule;
              } else {
                if (cap.id === "contact_brief") targetModuleForRead = "contacts";
                else if (cap.id === "account_snapshot" || cap.id === "sales_intelligence") targetModuleForRead = "companies";
                else if (cap.id === "opportunity_scorecard" || cap.id === "deal_risk") targetModuleForRead = "deals";
                else targetModuleForRead = "contacts"; // fallback
              }
            }
          }

          if (shouldExecuteHubspotRead && targetModuleForRead) {
            try {
              const workspaceService = new IntegrationWorkspaceService(this.db);
              const selectedRecordId = selectedItem?.provider === "hubspot" && selectedItem.itemType === targetModuleForRead ? selectedItem.itemId : null;

              const resolution = await workspaceService.resolveHubSpotRecord(state.currentWorkspace, state.userId, {
                module: targetModuleForRead,
                query: targetQueryForRead,
                selectedRecordId,
                maxResults: 8,
              });

                if (resolution.status === "resolved_single") {
                  plannerToolResult = {
                    status: "completed",
                    module: targetModuleForRead,
                    record: resolution.record,
                    contentText: `[hubspot-record-detail: ${JSON.stringify(resolution.record)}]`,
                  };
                } else if (resolution.status === "multiple_matches") {
                  plannerToolResult = {
                    status: "multiple_matches",
                    module: targetModuleForRead,
                    records: resolution.records,
                    contentText: `[hubspot-multiple-matches: ${JSON.stringify(resolution.records)}]`,
                  };
                } else {
                  plannerToolResult = { status: "empty", module: targetModuleForRead };
                }
                toolSummary = summarizeToolResult(plannerToolResult);
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              logger.warn("HubSpot dynamic read failed in planner", {
                workspaceId: state.currentWorkspace.id,
                error: errorMessage,
              });
              toolSummary = `[hubspot-error: ${errorMessage}]`;
            }
          }

          // Phase 3.6: Auto web-research for expert tools that require web_research_context
          // Mirrors the HubSpot auto-read pattern — fetch research inline before the context check.
          const queryLowerForIntel = (state.normalizedInput || state.input).toLowerCase();
          const isWorkflowNeedingIntel = !!(state.sessionId?.startsWith("workflow:") &&
            (queryLowerForIntel.includes("intel") || queryLowerForIntel.includes("research") || queryLowerForIntel.includes("news") || queryLowerForIntel.includes("search for")));

          const needsWebResearch =
            semanticIntent.intent === "research" ||
            semanticIntent.intent === "analyze_company" ||
            semanticIntent.intent === "evaluate_website" ||
            isWorkflowNeedingIntel ||
            (semanticIntent.intent === "expert_tool" &&
            semanticIntent.expertCapabilityId &&
            (() => {
              const cap = expertCapabilities.find(c => c.id === semanticIntent.expertCapabilityId);
              return cap?.requiredContext?.includes("web_research_context") ?? false;
            })());

          const alreadyHasWebResearch =
            state.resolvedMode === "search" ||
            state.resolvedMode === "research" ||
            state.resolvedMode === "extract_url" ||
            toolSummary.includes("openai_graph") ||
            toolSummary.includes("reasoning_extract") ||
            retrievalContext.includes("web_research") ||
            toolSummary.includes("openai_search");

          const autoResearchSourceRefs: SourceRef[] = [];

          if (needsWebResearch && !alreadyHasWebResearch) {
            try {
              state.progressEmit?.("command.tool_started", { tool: "web.researchTask" });
              const webService = new WebIntelligenceService(this.db);

              let researchPrompt = state.normalizedInput || state.input;
              if (isWorkflowNeedingIntel) {
                 researchPrompt = `Find recent news, press releases, and company intelligence updates for ${state.currentWorkspace.workspace.name}.`;
              }

              const webResult = await webService.runResearchTask({
                currentWorkspace: state.currentWorkspace,
                userId: state.userId,
                prompt: researchPrompt,
                processor: "lite",
                depth: "quick",
                activitySource: "tool",
                request: state.request,
              });
              // Inject into toolSummary so the web_research_context check passes
              toolSummary += `\n[openai_search: ${webResult.contentText?.slice(0, 6000) ?? ""}]`;
              retrievalContext += `\nweb_research:\n${webResult.contentText?.slice(0, 6000) ?? ""}`;
              // Collect source refs to return via LangGraph state
              if (webResult.sourceRefs?.length) {
                autoResearchSourceRefs.push(...webResult.sourceRefs);
              }
              state.progressEmit?.("command.tool_completed", { tool: "web.researchTask" });
              logger.info("Expert auto-research completed", {
                workspaceId: state.currentWorkspace.id,
                expertCapabilityId: semanticIntent.expertCapabilityId,
                provider: webResult.provider,
                chars: webResult.contentText?.length ?? 0,
              });
            } catch (webErr) {
              logger.warn("Expert auto-research failed; will fall back to missing_context", {
                workspaceId: state.currentWorkspace.id,
                expertCapabilityId: semanticIntent.expertCapabilityId,
                error: webErr instanceof Error ? webErr.message : String(webErr),
              });
            }
          }

          let expertRoute: { status: "none" | "needs_context" | "match"; expertType?: string; reason?: string; message?: string } = { status: "none" };
          
          if (semanticIntent.intent === "expert_tool" && semanticIntent.expertCapabilityId) {
            const capability = expertCapabilities.find((c) => c.id === semanticIntent.expertCapabilityId);
            if (capability) {
              let missingContextReason = "";

              if (capability.requiredContext && capability.requiredContext.length > 0) {
                for (const req of capability.requiredContext) {
                  if (req === "hubspot_record") {
                    const hasHubspotSelected = selectedItem?.provider === "hubspot";
                    const hasResolvedHubSpotRecord = toolSummary.includes("[hubspot-record-detail:");
                    const hasAmbiguousHubSpotMatches = toolSummary.includes("[hubspot-multiple-matches:");
                    if (!hasHubspotSelected && !hasResolvedHubSpotRecord) {
                      if (hasAmbiguousHubSpotMatches) {
                        missingContextReason = `Multiple CRM records found. Please specify which one you mean before I can run ${capability.displayName}.`;
                      } else if (toolSummary.includes("[hubspot-error:")) {
                        missingContextReason = `I'm having trouble accessing HubSpot. Please verify your integration is connected, or clarify your request so I can help you another way.`;
                      } else if (toolSummary.includes('"status":"empty"')) {
                        missingContextReason = `I couldn't find a matching CRM record. Please check the name or select it.`;
                      } else {
                        missingContextReason = `${capability.displayName} requires a selected CRM record (like a Contact or Deal). Please select one.`;
                      }
                      break;
                    }
                  } else if (req === "company_or_person_details") {
                    const hasHubspotSelected = selectedItem?.provider === "hubspot";
                    const hasResolvedHubSpotRecord = toolSummary.includes("[hubspot-record-detail:");
                    const hasGmailThread = selectedItem?.provider === "gmail" || toolSummary.includes("[gmail-thread:");
                    const hasStrongRetrieval = retrievalContext.length > 100;
                    if (!hasHubspotSelected && !hasResolvedHubSpotRecord && !hasGmailThread && !hasStrongRetrieval) {
                      missingContextReason = `${capability.displayName} requires information about a target company or person. Please specify who this is for.`;
                      break;
                    }
                  } else if (req === "gmail_thread") {
                    const hasGmailThread = selectedItem?.provider === "gmail" || toolSummary.includes("[gmail-thread:");
                    if (!hasGmailThread) {
                      missingContextReason = `${capability.displayName} requires a selected email thread.`;
                      break;
                    }
                  } else if (req === "web_research_context") {
                    const hasWebResearch = retrievalContext.includes("web_research") || toolSummary.includes("openai_search");
                    if (!hasWebResearch) {
                      missingContextReason = `${capability.displayName} requires web research or market data to run accurately.`;
                      break;
                    }
                  } else if (req === "session_context") {
                    // Usually always provided
                  }
                }
              }

              if (missingContextReason) {
                expertRoute = { status: "needs_context", message: missingContextReason };
              } else {
                expertRoute = { status: "match", expertType: capability.id, reason: semanticIntent.reason };
              }
            }
          } else if (
            semanticIntent.intent === "crm_action" &&
            semanticIntent.integrationParams?.action === "read"
          ) {
            if (toolSummary.includes('"status":"empty"')) {
              const query = semanticIntent.integrationParams?.targetQuery || "your search";
              expertRoute = { status: "needs_context", message: `I couldn't find a HubSpot record matching "${query}". Please check the name or select it from the sidebar.` };
            } else if (toolSummary.includes("[hubspot-error:")) {
              const errorMatch = toolSummary.match(/\[hubspot-error: (.*?)\]/);
              const errorMessage = errorMatch ? errorMatch[1] : "An error occurred connecting to HubSpot.";
              expertRoute = { status: "needs_context", message: `HubSpot error: ${errorMessage} Please reconnect your account or verify the integration.` };
            }
          }

          // Phase 5: Hand off deterministic integration intents (CRM exact updates, Deterministic Briefs)
          const integrationHandler = new IntegrationIntentHandler();
          const handlerResult = integrationHandler.handle(
            { ...state, semanticIntent, toolResult: plannerToolResult }, 
            expertRoute as any, 
            selectedItem, 
            (expertRoute.status === "match" && expertRoute.expertType) ? {
              expertType: expertRoute.expertType as ExpertTypeId,
              expertGroup: expertCapabilities.find(c => c.id === expertRoute.expertType)?.group as any,
              rendererKey: expertCapabilities.find(c => c.id === expertRoute.expertType)?.rendererKey as ExpertRendererKey,
            } : undefined
          );

          if (handlerResult) {
            return {
              ...handlerResult,
              semanticIntent,
            };
          }

          if (expertRoute.status === "needs_context") {
            const plan = commandPlanSchema.parse({
              intent: "other",
              answer: expertRoute.message,
              highlights: [],
              sections: [],
              artifact: null,
              approval: null,
              notification: null,
              workflowDraft: null,
              requestedCapabilities: [],
              requestedTools: [],
              missingContext: [expertRoute.message],
            });

            return {
              plan,
              expertExecution: null,
              semanticIntent,
              stepLogs: [`expert:${expertRoute.expertType}:needs_context`],
            };
          }

          if (expertRoute.status === "match" && expertRoute.expertType) {
            const capabilityConfig = expertCapabilities.find(c => c.id === expertRoute.expertType);
            
            if (!capabilityConfig) {
              logger.warn("CommandGraph: Matched capability not found in registry", { expertType: expertRoute.expertType });
            } else {
              const expertConfig = {
                expertType: capabilityConfig.expertType as ExpertTypeId,
                expertGroup: capabilityConfig.group as any,
                rendererKey: capabilityConfig.rendererKey as ExpertRendererKey,
                schema: capabilityConfig.outputSchema,
              };

            try {
              // Phase 4: Prompt Compiler for Experts
              const compiler = new PromptCompilerService();
              const workspaceIdentity = formatWorkspaceIdentityBlock(state.currentWorkspace.workspace.profile);
              const expertPromptPackage = await compiler.compileExpertPrompt({
                expertType: expertRoute.expertType as ExpertTypeId,
                userRequest: state.normalizedInput || state.input,
                selectedItemContext: selectedContextBlock,
                sessionSummary: state.sessionContext,
                retrievedContext: retrievalContext,
                toolResult: toolSummary,
                expertSopText: retrievedSopsBlock,
                missingContext: state.missingContext,
                workspaceIdentity,
              });

              let payload: Record<string, unknown> | null = null;

              if (
                ["revenue_intelligence", "opportunity_analysis", "outreach_messaging"].includes(expertConfig.expertGroup)
              ) {
                const isCrmMissing = plannerToolResult?.status === "empty";
                const isCrmMultiple = plannerToolResult?.status === "multiple_matches";
                
                if (isCrmMissing || isCrmMultiple) {
                  const queryStr = typeof plannerToolResult?.module === "string" 
                    ? state.input 
                    : state.input;
                    
                  payload = {
                    status: isCrmMissing ? "not_found" : "partial",
                    searchMetadata: {
                      query: queryStr,
                      sourceUsed: "HubSpot",
                      missingData: isCrmMissing 
                        ? ["CRM record not found"] 
                        : ["Multiple records found; please refine search or select one directly."],
                    },
                  };
                }
              } else if (expertConfig.expertType === "document_analysis") {
                const hasArtifact = retrievalContext?.includes("[Document Artifact]") || retrievalContext?.includes("[Context Bundle]");
                if (!hasArtifact) {
                  payload = {
                    status: "not_found",
                    searchMetadata: {
                      query: state.normalizedInput || state.input,
                      sourceUsed: "Workspace Documents",
                      missingData: [
                        "No matching document found in workspace context.",
                        "Tip: If you meant a CRM record, try searching for a 'contact' instead."
                      ],
                    },
                  };
                }
              }

              if (!payload) {
                const reasoningProvider = createLlmProvider("reasoning");
                payload = (await reasoningProvider.generateStructured({
                  schema: expertConfig.schema as z.ZodType<Record<string, unknown>>,
                  systemPrompt: expertPromptPackage.systemPrompt,
                  userPrompt: expertPromptPackage.userPrompt,
                })) as Record<string, unknown>;
              }

              const expertExecution: ExpertExecutionResult = {
                expertType: expertConfig.expertType,
                expertGroup: expertConfig.expertGroup,
                rendererKey: expertConfig.rendererKey,
                payload,
                suggestedActions: buildExpertSuggestedActions(expertConfig.expertType, selectedItem),
              };

              const plan = commandPlanSchema.parse({
                intent: "other",
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
                stepLogs: [`expert:${expertConfig.expertType}:matched:${expertRoute.reason}`],
                semanticIntent,
                toolResult: plannerToolResult,
                sourceRefs: autoResearchSourceRefs.length > 0
                  ? [...state.sourceRefs, ...autoResearchSourceRefs]
                  : state.sourceRefs,
              };
            } catch (expertError) {
              logger.warn("Expert generation failed; falling back to generic planner", {
                workspaceId: state.currentWorkspace.id,
                expertType: expertRoute.expertType,
                error: expertError instanceof Error ? expertError.message : "unknown",
              });
            }
          }
        }

          if (semanticIntent.intent === "clarification_needed") {
            const constraint = `CONSTRAINT: The intent classifier flagged this request as ambiguous: "${semanticIntent.reason}". You MUST respond by asking the user to clarify this ambiguity before proceeding. Do NOT attempt to execute tools or guess the target.`;
            finalModeInstructions = `${finalModeInstructions}\n\n${constraint}`;
          }

          if (state.sessionId?.startsWith("workflow:")) {
            const constraint = `CONSTRAINT: You are executing a background task within an already-running workflow. DO NOT attempt to create or draft a new workflow. Focus entirely on executing your assigned task and providing the answer.`;
            finalModeInstructions = `${finalModeInstructions}\n\n${constraint}`;
          }

          // Phase 4: Prompt Compiler for Orchestrator
          const compiler = new PromptCompilerService();
          const workspaceIdentity = formatWorkspaceIdentityBlock(state.currentWorkspace.workspace.profile);
          const promptPackage = await compiler.compileCommandPrompt({
            manifest,
            agentSystemPromptAddition: state.agentSystemPromptAddition,
            mode: state.resolvedMode,
            modeInstructions: finalModeInstructions,
            userRequest: state.normalizedInput || state.input,
            selectedItemContext: selectedContextBlock,
            sessionSummary: state.sessionContext,
            retrievedContext: retrievalContext,
            toolResult: toolSummary,
            expertSopText: retrievedSopsBlock,
            missingContext: state.missingContext,
            workspaceIdentity,
          });

          const isBasicOrSearch =
            semanticIntent.intent === "normal_answer" ||
            semanticIntent.intent === "clarification_needed" ||
            state.resolvedMode === "search" ||
            state.resolvedMode === "research";

          const plannerLlmProvider = isBasicOrSearch
            ? createLlmProvider("fast")
            : llmProvider;

          const isWorkflowSession = state.sessionId?.startsWith("workflow:");
          const activeSchema = isWorkflowSession
            ? commandPlanSchema.omit({ workflowDraft: true })
            : commandPlanSchema;

          const planData = await plannerLlmProvider.generateStructured({
            schema: activeSchema,
            systemPrompt: promptPackage.systemPrompt,
            userPrompt: promptPackage.userPrompt,
          });

          // Normalize literal \n escape sequences that structured output models sometimes emit
          const plan = planData as CommandPlan;
          plan.answer = plan.answer.replace(/\\n/g, "\n");
          for (const section of plan.sections) {
            section.body = section.body.replace(/\\n/g, "\n");
          }
          if (plan.artifact) {
            plan.artifact.content = plan.artifact.content.replace(/\\n/g, "\n");
          }

          if (plan.workflowDraft) {
            plan.workflowDraft = postProcessWorkflowDraft(
              plan.workflowDraft,
              state.normalizedInput || state.input,
              state.requestEnvelope?.timezone
            );
          }

          return {
            plan,
            expertExecution: null,
            semanticIntent,
            toolResult: plannerToolResult,
            stepLogs: [`planner:${state.resolvedMode}:${plan.requestedTools.join(",") || "no_tools"}`],
            sourceRefs: autoResearchSourceRefs.length > 0
              ? [...state.sourceRefs, ...autoResearchSourceRefs]
              : state.sourceRefs,
          };
        }),
      )
      .addNode("guard", async (state) => {
        return timeRequestPhase(state.request, "command.guard", async () => {
          const plan = state.plan;

          if (!plan) {
            throw new ApiError({
              code: "INTERNAL_ERROR",
              message: "Command planner did not return a plan.",
              status: 500,
            });
          }

          const missingCapabilities = this.toolRegistryService.getMissingCapabilitiesFromCapabilities(
            state.availableCapabilities,
            plan.requestedCapabilities,
          );

          const policyDecisions: PolicyDecision[] = [];

        if (plan.artifact && shouldPersistArtifact(state.normalizedInput || state.input, state.artifactWritePolicy)) {
          policyDecisions.push(
            this.policyService.assertActionAllowed({
              currentWorkspace: state.currentWorkspace,
              toolName: "artifact.create",
              actionType: "artifact_create",
              agentId: state.selectedAgentId,
            }),
          );
        }

        if (plan.notification) {
          policyDecisions.push(
            this.policyService.assertActionAllowed({
              currentWorkspace: state.currentWorkspace,
              toolName: "notification.create",
              actionType: "notification_create",
              agentId: state.selectedAgentId,
            }),
          );
        }

        if (plan.approval) {
          const normalizedApprovalToolName = normalizeApprovalToolName(
            plan.approval.toolName,
            plan.approval.actionType,
          );
          policyDecisions.push(
            this.policyService.assertActionAllowed({
              currentWorkspace: state.currentWorkspace,
              toolName: normalizedApprovalToolName,
              actionType: plan.approval.actionType,
              agentId: state.selectedAgentId,
              requestedRiskLevel: plan.approval.riskLevel,
              requestedRequiresApproval: true,
            }),
          );
        }

        if (state.resolvedMode === "workflow" && plan.workflowDraft) {
          policyDecisions.push(
            this.policyService.assertActionAllowed({
              currentWorkspace: state.currentWorkspace,
              toolName: "workflow.generate",
              actionType: "workflow_create_draft",
            }),
          );
        }

          const requiresApproval = policyDecisions.some((decision) => decision.status === "approval_required");

          return {
            safety: {
              requiresApproval,
              missingCapabilities,
              policyDecisions,
            },
            stepLogs: [
              `safety:${requiresApproval ? "approval" : "clear"}:${missingCapabilities.length ? "missing_caps" : "ok"}:${policyDecisions.map((decision) => `${decision.toolName}:${decision.status}`).join(",") || "no_actions"}`,
            ],
          };
        });
      })
      .addNode("write", async (state) => {
        return timeRequestPhase(state.request, "command.write", async () => {
          state.progressEmit?.("command.synthesizing", {});
          let plan = state.plan;

          if (!plan) {
            throw new ApiError({
              code: "INTERNAL_ERROR",
              message: "Command graph state is incomplete.",
              status: 500,
            });
          }

        let routeDecision = state.routeDecision;
        const hasArtifactToPersist = Boolean(
          plan.artifact &&
            shouldPersistArtifact(state.normalizedInput || state.input, state.artifactWritePolicy),
        );
        const hasWriteWork = Boolean(
          hasArtifactToPersist ||
            plan.approval ||
            plan.notification ||
            (state.rolloutFlags.routeV2Active && routeDecision?.intent === "integration_write"),
        );

        if (!hasWriteWork) {
          return {
            plan,
            routeDecision,
            toolResult: state.toolResult,
            createdArtifact: null,
            createdApproval: null,
            createdWorkflow: null,
            missingContext: state.missingContext,
            stepLogs: ["write:none"],
          };
        }

        const normalizedApprovalToolName = plan.approval
          ? normalizeApprovalToolName(plan.approval.toolName, plan.approval.actionType)
          : null;
        const approvalDecision = state.safety?.policyDecisions.find(
          (decision) => normalizedApprovalToolName && decision.toolName === normalizedApprovalToolName,
        );

        const allowedTools = ["artifact.create", "approval.create", "notification.create", "workflow.generate"];
        if (normalizedApprovalToolName) {
          allowedTools.push(normalizedApprovalToolName);
        }

        const tools = this.toolRegistryService.buildToolSetFromCapabilities(
          state.currentWorkspace,
          state.userId,
          state.availableCapabilities,
          allowedTools,
          state.sourceRefs,
          state.request,
        );

        const artifactTool = tools.find((tool) => tool.name === "artifact.create");
        const approvalTool = tools.find((tool) => tool.name === "approval.create");
        const notificationTool = tools.find((tool) => tool.name === "notification.create");
        const createdRefs: string[] = [];

        let createdArtifact = null;
        let createdApproval = null;
        let createdWorkflow = null;
        let providerActionHandled = false;
        let toolResult = state.toolResult;

        if (plan.artifact && artifactTool && hasArtifactToPersist) {
          const artifactResult = (await artifactTool.invoke({
            ...plan.artifact,
            creationSource: "command_explicit",
            sourceSessionId: state.sessionId || undefined,
            sourceAssistantMessageId: undefined,
          })) as { artifactId?: string };
          if (artifactResult.artifactId) {
            createdArtifact = {
              artifactId: artifactResult.artifactId,
              title: plan.artifact.title,
              artifactType: plan.artifact.artifactType,
              previewText: plan.artifact.content.slice(0, 280),
            };
            createdRefs.push(`artifact:${artifactResult.artifactId}`);
          }
        }

        const plannerApprovalNeedsWorkspaceAction = false;

        let approvalFollowUpHint: string | null = null;

        if (
          state.rolloutFlags.routeV2Active &&
          routeDecision?.intent === "integration_write" &&
          routeDecision.provider === "gmail"
        ) {
          providerActionHandled = true;
          const selectedItem = parseSelectedExpertItem(state.contextSummary);
          const preparation = await new GmailActionService(this.db).prepareSend({
            currentWorkspace: state.currentWorkspace,
            userId: state.userId,
            userInput: state.normalizedInput || state.input,
            sessionContext: state.sessionContext,
            plan,
            selectedItem,
          });
          if (preparation.status === "ready") {
            createdApproval = {
              approvalId: preparation.approvalId,
              label: preparation.label,
              riskLevel: "medium" as const,
              requiresApproval: true,
              status: "pending" as const,
              actionType: preparation.actionType,
            };
            createdRefs.push(`approval:${preparation.approvalId}`);
          } else {
            approvalFollowUpHint = preparation.message;
            const degradationAnswer = preparation.status === "unavailable"
              ? `⚠️ **Gmail is temporarily unavailable.** ${preparation.message}\n\nI can still draft the email content for you to copy, or we can try again in a moment.`
              : preparation.message;
            plan = commandPlanSchema.parse({
              ...plan,
              intent: "clarification",
              answer: degradationAnswer,
              clarificationQuestion: preparation.message,
              approval: null,
              missingContext: [preparation.message],
            });
          }
        } else if (
          state.rolloutFlags.routeV2Active &&
          routeDecision?.intent === "integration_write" &&
          routeDecision.provider === "hubspot"
        ) {
          providerActionHandled = true;
          const selectedItem = parseSelectedExpertItem(state.contextSummary);
          const preparation = await new HubSpotActionService(this.db).prepare({
            currentWorkspace: state.currentWorkspace,
            userId: state.userId,
            userInput: state.normalizedInput || state.input,
            route: routeDecision,
            selectedItem,
            sessionState: state.sessionState,
          });
          if (preparation.status === "ready") {
            createdApproval = {
              approvalId: preparation.approvalId,
              label: preparation.label,
              riskLevel: preparation.actionType === "hubspot_update" ? "high" as const : "medium" as const,
              requiresApproval: true,
              status: "pending" as const,
              actionType: preparation.actionType,
            };
            createdRefs.push(`approval:${preparation.approvalId}`);
            if (preparation.resolvedEntity) {
              routeDecision = {
                ...routeDecision,
                resolvedEntities: [preparation.resolvedEntity],
                reason: `${routeDecision.reason}:resolved_target`,
              };
            }
            plan = commandPlanSchema.parse({
              ...plan,
              intent: "approval",
              answer: `I prepared this HubSpot change for your review. Nothing will be written until you approve it.`,
              approval: null,
              missingContext: [],
            });
          } else {
            approvalFollowUpHint = preparation.message;
            toolResult =
              preparation.status === "multiple_matches"
                ? {
                    status: "multiple_matches",
                    module: preparation.module,
                    query: preparation.query,
                    candidates: preparation.candidates,
                  }
                : { status: preparation.status };

            // Degradation response: surface clear, actionable messages for each failure type
            const isDegradation = preparation.status === "unavailable" || preparation.status === "unsupported";
            const isDisambiguation = preparation.status === "multiple_matches" || preparation.status === "missing_fields";
            const degradationAnswer = isDegradation
              ? `⚠️ **HubSpot is temporarily unavailable.** ${preparation.message}\n\nI can still answer from workspace memory and context — would you like me to try that instead?`
              : preparation.status === "not_found"
                ? `I couldn't find the HubSpot record you referenced. ${preparation.message}\n\nWould you like me to search by a different name, or check a different module (contacts, companies, deals)?`
                : preparation.message;

            plan = commandPlanSchema.parse({
              ...plan,
              intent: isDisambiguation ? "clarification" : "other",
              answer: degradationAnswer,
              clarificationQuestion: isDisambiguation ? preparation.message : null,
              approval: null,
              missingContext: [preparation.message],
            });
          }
        } else if (plan.approval && normalizedApprovalToolName === "gmail.prepareSendApproval") {
          const workspaceService = new IntegrationWorkspaceService(this.db);
          const gmailApproval = resolveGmailApprovalFromCommand({
            input: state.normalizedInput || state.input,
            sessionContext: state.sessionContext,
            plan,
            contextSummary: state.contextSummary,
          });

          if (gmailApproval.status === "ready") {
            try {
              const approvalResult = await workspaceService.prepareGmailSendApproval(
                state.currentWorkspace,
                state.userId,
                gmailApproval.input,
              );
              createdApproval = {
                approvalId: approvalResult.approvalId,
                label: `Send Gmail email: ${approvalResult.subject}`,
                riskLevel: approvalDecision?.riskLevel ?? plan.approval.riskLevel,
                requiresApproval: approvalDecision?.requiresApproval ?? true,
                status: "pending",
                actionType: "email_send",
              };
              createdRefs.push(`approval:${approvalResult.approvalId}`);
            } catch (error) {
              if (error instanceof ApiError) {
                approvalFollowUpHint = `${error.message} ${gmailWorkspaceComposeHint(state.contextSummary)}`;
              } else {
                throw error;
              }
            }
          } else {
            approvalFollowUpHint = gmailApproval.message;
          }
        } else if (
          !providerActionHandled &&
          plan.approval &&
          (normalizedApprovalToolName === "hubspot.prepareNoteApproval" ||
            normalizedApprovalToolName === "hubspot.prepareTaskCreateApproval" ||
            normalizedApprovalToolName === "hubspot.prepareTaskUpdateApproval")
        ) {
          const workspaceService = new IntegrationWorkspaceService(this.db);
          const selectedItem = parseSelectedIntegrationItem(state.contextSummary);
          const resolvedHubSpotTarget =
            selectedItem?.provider === "hubspot"
              ? {
                  module: selectedItem.itemType,
                  recordId: selectedItem.itemId,
                  title: selectedItem.title,
                }
              : typeof state.toolResult?.recordId === "string" && typeof state.toolResult?.module === "string"
                ? {
                    module: state.toolResult.module,
                    recordId: state.toolResult.recordId,
                    title:
                      typeof state.toolResult.recordTitle === "string"
                        ? state.toolResult.recordTitle
                        : "Selected HubSpot record",
                  }
                : null;

          if (!resolvedHubSpotTarget) {
            approvalFollowUpHint =
              "Select a HubSpot record first so I know exactly which CRM object this approval should target.";
          } else {
            try {
              if (
                normalizedApprovalToolName === "hubspot.prepareNoteApproval" &&
                (resolvedHubSpotTarget.module === "contacts" || resolvedHubSpotTarget.module === "companies" || resolvedHubSpotTarget.module === "deals")
              ) {
                const noteBody =
                  firstMeaningfulLine(plan.sections[0]?.body ?? "") ||
                  firstMeaningfulLine(plan.answer);
                const approvalResult = await workspaceService.prepareHubSpotNoteApproval(
                  state.currentWorkspace,
                  state.userId,
                  {
                    module: resolvedHubSpotTarget.module as "contacts" | "companies" | "deals",
                    recordId: resolvedHubSpotTarget.recordId,
                    body: noteBody,
                  },
                );
                createdApproval = {
                  approvalId: approvalResult.approvalId,
                  label: plan.approval.title,
                  riskLevel: approvalDecision?.riskLevel ?? plan.approval.riskLevel,
                  requiresApproval: true,
                  status: "pending",
                  actionType: "hubspot_note_create",
                };
                createdRefs.push(`approval:${approvalResult.approvalId}`);
              } else if (
                normalizedApprovalToolName === "hubspot.prepareTaskCreateApproval" &&
                (resolvedHubSpotTarget.module === "contacts" || resolvedHubSpotTarget.module === "companies" || resolvedHubSpotTarget.module === "deals")
              ) {
                const subject =
                  firstMeaningfulLine(plan.highlights[0] ?? "") ||
                  firstMeaningfulLine(plan.answer).slice(0, 120) ||
                  `Follow up on ${resolvedHubSpotTarget.title}`;
                const approvalResult = await workspaceService.prepareHubSpotTaskCreateApproval(
                  state.currentWorkspace,
                  state.userId,
                  {
                    module: resolvedHubSpotTarget.module as "contacts" | "companies" | "deals",
                    recordId: resolvedHubSpotTarget.recordId,
                    subject,
                    body: plan.answer,
                  },
                );
                createdApproval = {
                  approvalId: approvalResult.approvalId,
                  label: plan.approval.title,
                  riskLevel: approvalDecision?.riskLevel ?? plan.approval.riskLevel,
                  requiresApproval: true,
                  status: "pending",
                  actionType: "hubspot_task_create",
                };
                createdRefs.push(`approval:${approvalResult.approvalId}`);
              } else if (normalizedApprovalToolName === "hubspot.prepareTaskUpdateApproval" && resolvedHubSpotTarget.module === "tasks") {
                const approvalResult = await workspaceService.prepareHubSpotTaskUpdateApproval(
                  state.currentWorkspace,
                  state.userId,
                  {
                    recordId: resolvedHubSpotTarget.recordId,
                    updates: { hs_task_status: "COMPLETED" },
                  },
                );
                createdApproval = {
                  approvalId: approvalResult.approvalId,
                  label: plan.approval.title,
                  riskLevel: approvalDecision?.riskLevel ?? plan.approval.riskLevel,
                  requiresApproval: true,
                  status: "pending",
                  actionType: "hubspot_task_update",
                };
                createdRefs.push(`approval:${approvalResult.approvalId}`);
              }
            } catch (error) {
              if (error instanceof ApiError) {
                approvalFollowUpHint = error.message;
              } else {
                throw error;
              }
            }
          }
        } else if (!providerActionHandled && plan.approval && !plannerApprovalNeedsWorkspaceAction) {
          const specificApprovalToolName = normalizedApprovalToolName ?? plan.approval.toolName;
          const specificApprovalTool = tools.find((t) => t.name === specificApprovalToolName);

          try {
            if (specificApprovalTool) {
              const approvalResult = (await specificApprovalTool.invoke(plan.approval.input ?? {})) as {
                approvalId?: string;
              };
              if (approvalResult.approvalId) {
                createdApproval = {
                  approvalId: approvalResult.approvalId,
                  label: plan.approval.title,
                  riskLevel: approvalDecision?.riskLevel ?? plan.approval.riskLevel,
                  requiresApproval: approvalDecision?.requiresApproval ?? true,
                  status: "pending",
                  actionType: plan.approval.actionType,
                };
                createdRefs.push(`approval:${approvalResult.approvalId}`);
              }
            } else if (approvalTool) {
              const approvalResult = (await approvalTool.invoke({
                ...plan.approval,
                toolName: specificApprovalToolName,
                input: plan.approval.input ?? {},
                preview: plan.approval.input ?? {},
                riskLevel: approvalDecision?.riskLevel ?? plan.approval.riskLevel,
              })) as { approvalId?: string };
              if (approvalResult.approvalId) {
                createdApproval = {
                  approvalId: approvalResult.approvalId,
                  label: plan.approval.title,
                  riskLevel: approvalDecision?.riskLevel ?? plan.approval.riskLevel,
                  requiresApproval: approvalDecision?.requiresApproval ?? true,
                  status: "pending",
                  actionType: plan.approval.actionType,
                };
                createdRefs.push(`approval:${approvalResult.approvalId}`);
              }
            }
          } catch (error) {
            if (error instanceof ApiError) {
              approvalFollowUpHint = error.message;
            } else if (error instanceof Error && error.message.includes("expected schema")) {
              approvalFollowUpHint = `I couldn't prepare the approval because I missed some required fields: ${error.message}`;
            } else {
              throw error;
            }
          }
        }



        if (plan.notification && notificationTool) {
          const notificationResult = (await notificationTool.invoke(plan.notification)) as { notificationId?: string };
          if (notificationResult.notificationId) {
            createdRefs.push(`notification:${notificationResult.notificationId}`);
          }
        }

          return {
            plan,
            routeDecision,
            toolResult,
            createdArtifact,
            createdApproval,
            createdWorkflow,
            missingContext: approvalFollowUpHint
              ? Array.from(new Set([...state.missingContext, approvalFollowUpHint]))
              : state.missingContext,
            stepLogs: [`write:${createdRefs.join(",") || "none"}`],
          };
        });
      })
      .addNode("output", async (state) =>
        timeRequestPhase(state.request, "command.output", async () => {
          const plan = state.plan;
          const safety = state.safety;

          if (!plan || !safety) {
            throw new ApiError({
              code: "INTERNAL_ERROR",
              message: "Command graph state is incomplete.",
              status: 500,
            });
          }

        let answer = plan.answer;
        if (plan.approval && !state.createdApproval) {
          const normalizedApprovalToolName = normalizeApprovalToolName(
            plan.approval.toolName,
            plan.approval.actionType,
          );
          if (normalizedApprovalToolName === "gmail.prepareSendApproval") {
            answer = `${answer}\n\nI can help draft the message here, but the executable Gmail approval should be created inside the Gmail workspace. ${gmailWorkspaceComposeHint(state.contextSummary)}`;
          } else if (normalizedApprovalToolName === "hubspot.prepareAssociationApproval") {
            answer = `${answer}\n\nI can line up the association change here, but the executable HubSpot approval still needs the exact related record pair from the HubSpot workspace.`;
          } else if (state.missingContext.length > 0) {
            const lastHint = state.missingContext[state.missingContext.length - 1];
            if (
              lastHint.includes("HubSpot API request failed") ||
              lastHint.includes("missed some required fields") ||
              lastHint.includes("couldn't prepare the approval")
            ) {
              answer = `${answer}\n\n⚠️ **Approval Generation Failed:** ${lastHint}`;
            }
          }
        }
        const resultPayload = buildResult(
          state.resolvedMode,
          { ...plan, answer },
          state.toolResult,
          state.createdWorkflow,
          state.createdArtifact,
          state.expertExecution,
        );

          return {
            answer,
            artifactDrafts: state.createdArtifact
              ? [
                  {
                    title: state.createdArtifact.title,
                    artifactType: state.createdArtifact.artifactType,
                    previewText: state.createdArtifact.previewText,
                  },
                ]
              : plan.artifact
                ? [
                    {
                      title: plan.artifact.title,
                      artifactType: plan.artifact.artifactType,
                      previewText: plan.artifact.content.slice(0, 280),
                    },
                  ]
                : [],
            proposedActions: state.createdApproval
              ? [
                  {
                    id: state.createdApproval.approvalId,
                    label: state.createdApproval.label,
                    riskLevel: state.createdApproval.riskLevel,
                    requiresApproval: state.createdApproval.requiresApproval,
                  },
                ]
              : state.expertExecution?.suggestedActions?.length
                ? state.expertExecution.suggestedActions
                : plan.approval
                ? [
                    {
                      id: "approval-preview",
                      label: plan.approval.title,
                      riskLevel: plan.approval.riskLevel,
                      requiresApproval: true,
                    },
                  ]
                : [],
            missingContext: Array.from(
              new Set([
                ...state.missingContext,
                ...plan.missingContext,
                ...safety.missingCapabilities.map((item) => item.capability),
              ]),
            ),
            resultType: resultPayload.resultType,
            result: resultPayload.result,
            stepLogs: ["output:prepared"],
          };
        }),
      )
      .addEdge(START, "parseInput")
      .addEdge("parseInput", "resolveMode")
      .addEdge("resolveMode", "context")
      .addEdge("context", "capabilities")
      .addEdge("capabilities", "toolExecution")
      .addEdge("toolExecution", "planner")
      .addEdge("planner", "guard")
      .addEdge("guard", "write")
      .addEdge("write", "output")
      .addEdge("output", END)
      .compile();

    return graph;
  }

  async run(input: CommandGraphInput) {
    const execution = getAiExecutionContext();
    const runRef = execution?.requestId
      ? this.db
          .collection("workspaces")
          .doc(input.currentWorkspace.id)
          .collection("agentRuns")
          .doc(execution.requestId)
      : this.db
          .collection("workspaces")
          .doc(input.currentWorkspace.id)
          .collection("agentRuns")
          .doc();
    const startedAt = Timestamp.now();

    await runRef.set({
      id: runRef.id,
      workspaceId: input.currentWorkspace.id,
      agentId: input.agentId ?? undefined,
      runType: "command",
      status: "running",
      inputHash: hashInput(input.input),
      promptVersion: "command-graph-v2",
      model: createLlmProvider().modelName,
      sourceRefs: [],
      startedAt,
      createdBy: input.userId,
      metadata: {
        requestedMode: input.mode ?? "auto",
      },
    });

    // Resolve user profile from Firebase Auth (email + display name)
    // The Firestore 'users' doc only stores defaultWorkspaceId, not PII.
    let userProfile: { displayName?: string; email?: string } | null = null;
    try {
      const userRecord = await getAuth().getUser(input.userId);
      userProfile = {
        displayName: userRecord.displayName,
        email: userRecord.email,
      };
    } catch {
      // Non-fatal — context will omit user profile block
    }

    const graph = this.buildGraph();

    try {
      const result = await graph.invoke({
          input: input.input,
          normalizedInput: input.input,
          requestedMode: input.mode ?? "auto",
          resolvedMode: "auto",
          attachments: input.attachments ?? [],
          userId: input.userId,
          userProfile,
          currentWorkspace: input.currentWorkspace,
          selectedAgentId: input.agentId ?? null,
          selectedAgentName: input.agentId ? getVisibleAgent(input.agentId)?.name ?? "Gideon Orchestrator" : "Gideon Orchestrator",
          availableCapabilities: [],
          contextBundleId: input.contextBundleId ?? "",
          contextFreshness: "missing",
          contextSummary: "",
          sourceRefs: [],
          missingContext: [],
          semanticIntent: null,
          plan: null,
          toolResult: null,
          safety: null,
          answer: "",
          artifactDrafts: [],
          proposedActions: [],
          createdArtifact: null,
          createdApproval: null,
          createdWorkflow: null,
          expertExecution: null,
          resultType: "answer",
          result: null,
          creditsCharged: 1,
          agentRunId: runRef.id,
          stepLogs: [],
          request: input.request,
          sessionId: input.sessionId ?? "",
          sessionContext: input.sessionContext ?? "",
          agentSystemPromptAddition: input.agentSystemPromptAddition ?? "",
          agentAllowedTools: input.agentAllowedTools ?? null,
          progressEmit: input.progressEmit,
          artifactWritePolicy: input.artifactWritePolicy ?? "explicit_user_intent",
          routeDecision: null,
          routeComparison: null,
          sessionState: input.sessionState ?? null,
          retrievedSopsBlock: "",
          requestEnvelope: input.requestEnvelope ?? null,
          rolloutFlags: {
            routeV2Shadow: false,
            routeV2Active: false,
            contextV2: false,
            retrievalV2Active: false,
          },
      });

      await runRef.update({
        status: "completed",
        completedAt: Timestamp.now(),
        outputSummary: result.answer,
        sourceRefs: result.sourceRefs,
      });
      input.progressEmit?.("command.completed", { agentRunId: runRef.id, resolvedMode: result.resolvedMode });
      await this.activityService.createEvent({
        workspaceId: input.currentWorkspace.id,
        type: "command.completed",
        title: `Command completed by ${result.selectedAgentName}`,
        description: input.input,
        actorType: "user",
        actorId: input.userId,
        related: { agentRunId: runRef.id, workflowId: result.createdWorkflow?.workflowId },
        metadata: {
          graphSteps: result.stepLogs,
          agentId: input.agentId ?? null,
          contextBundleId: result.contextBundleId,
          requestedMode: input.mode ?? "auto",
          resolvedMode: result.resolvedMode,
        },
      });

      const failedSources = Array.isArray(result.toolResult?.failedSources)
        ? result.toolResult.failedSources.filter(
            (source): source is string => typeof source === "string",
          )
        : [];
      const isPartial =
        result.toolResult?.partialResult === true ||
        failedSources.length > 0 ||
        result.toolResult?.freshness === "partial";
      const partialResult = isPartial
        ? {
            completeness:
              typeof result.toolResult?.completeness === "number"
                ? result.toolResult.completeness
                : 0.5,
            confidence:
              typeof result.toolResult?.confidence === "number"
                ? result.toolResult.confidence
                : 0.5,
            freshness:
              result.toolResult?.freshness === "stale" ||
              result.toolResult?.freshness === "missing"
                ? result.toolResult.freshness
                : "partial",
            failedSources,
          }
        : null;

      return {
        answer: result.answer,
        agentRunId: runRef.id,
        resolvedMode: result.resolvedMode,
        resultType: result.resultType,
        result: result.result,
        proposedActions: result.proposedActions,
        artifactDrafts: result.artifactDrafts,
        createdArtifact: result.createdArtifact,
        createdApproval: result.createdApproval,
        createdWorkflow: result.createdWorkflow,
        sources: result.sourceRefs.map(serializeSourceRef),
        sourceRefs: result.sourceRefs,
        missingContext: result.missingContext,
        creditsCharged: result.creditsCharged,
        routeDecision: result.routeDecision,
        routeComparison: result.routeComparison,
        partialResult,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command graph failed.";
      logger.error("Command graph failed", {
        workspaceId: input.currentWorkspace.id,
        agentRunId: runRef.id,
        error: message,
      });
      await runRef.update({
        status: "failed",
        error: message,
        completedAt: Timestamp.now(),
      });
      input.progressEmit?.("command.failed", { agentRunId: runRef.id, error: message });

      throw error;
    }
  }
}

export const __testables = {
  buildCapabilityHelpPlan,
  buildResearchPlan,
  extractEmailAddresses,
  isFreshDiscoveryQuery,
  isCapabilityHelpQuery,
  parseEmailDraftFromText,
  extractEmailDraftFromPlan,
  resolveGmailApprovalFromCommand,
  shouldPersistArtifact,
};
