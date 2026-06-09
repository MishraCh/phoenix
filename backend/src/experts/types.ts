import type { z, ZodTypeAny } from "zod";

export type ExpertGroupId =
  | "revenue_intelligence"
  | "opportunity_analysis"
  | "outreach_messaging"
  | "market_research"
  | "executive_finance"
  | "legal_policy_ip"
  | "people_talent";

export type ExpertTypeId =
  | "contact_brief"
  | "pre_call_brief"
  | "opportunity_scorecard"
  | "outreach_draft"
  | "competitor_battlecard"
  | "signal_radar"
  | "document_analysis"
  | "sales_intelligence"
  | "account_snapshot"
  | "pipeline_health"
  | "deal_risk"
  | "meeting_summary"
  | "meeting_debrief"
  | "report_scorecard"
  | "executive_brief"
  | "ma_brief"
  | "legal_risk_panel"
  | "compliance_assessment"
  | "patent_analysis"
  | "people_insight";

export type ExpertRendererKey =
  | "contact-brief-card"
  | "pre-call-brief-card"
  | "opportunity-scorecard"
  | "outreach-draft-card"
  | "competitor-battlecard"
  | "signal-radar-card"
  | "sales-intelligence-card"
  | "account-snapshot-card"
  | "pipeline-health-card"
  | "deal-risk-card"
  | "meeting-summary-card"
  | "meeting-debrief-card"
  | "report-scorecard"
  | "executive-brief-card"
  | "buyer-universe-card"
  | "legal-risk-panel"
  | "compliance-assessment-card"
  | "patent-analysis-card"
  | "people-insight-card"
  | "expert-result-renderer";

export type ExpertAgentId = "executive" | "sales" | "research" | "operations" | "customer" | "recruiting";

export type ExpertCapabilityLifecycleStatus = "archived" | "candidate" | "shadow" | "active" | "deprecated";

export type ExpertGroundingPolicy =
  | "requires_selected_context"
  | "requires_resolved_record"
  | "requires_retrieved_sources"
  | "requires_uploaded_document"
  | "can_use_user_supplied_context"
  | "can_run_without_workspace_context";

export type ExpertCapabilityApprovalPolicy =
  | "none"
  | "approval_required_for_external_write"
  | "approval_required_for_email_send"
  | "approval_required_for_crm_write";

export type ExpertCapabilityArtifactPolicy =
  | "none"
  | "suggest_save"
  | "save_on_explicit_request"
  | "artifact_friendly_report";

export type ExpertCapabilityWorkflowPolicy =
  | "none"
  | "can_suggest_workflow"
  | "can_create_workflow_draft_on_request";

export type ExpertCapabilitySourcePromptModule = {
  legacyId: string;
  sourceFiles: string[];
  retainedAs: "keep" | "merge";
};

export type ExpertCapability = {
  id: string;
  expertType?: ExpertTypeId;
  displayName: string;
  group: ExpertGroupId | "operations" | "other";
  agentOwner: ExpertAgentId;
  secondaryAgents?: ExpertAgentId[];
  description: string;
  useCases: string[];
  aliases: string[];
  sourcePromptModules: ExpertCapabilitySourcePromptModule[];
  lifecycleStatus: ExpertCapabilityLifecycleStatus;
  requiredContext: ExpertContextRequirement[];
  optionalContext: ExpertContextRequirement[];
  groundingPolicy: ExpertGroundingPolicy;
  inputSchema: unknown;
  outputSchema: unknown;
  rendererKey: string;
  fallbackRendererKey: "generic-structured-result";
  schemaVersion: string;
  sopText: string;
  positiveExamples: string[];
  negativeExamples: string[];
  allowedRuntimeTools: string[];
  approvalPolicy: ExpertCapabilityApprovalPolicy;
  artifactPolicy: ExpertCapabilityArtifactPolicy;
  workflowPolicy: ExpertCapabilityWorkflowPolicy;
  minimumConfidence: number;
  maxPromptTokens: number;
  promptVersion: string;
};

export type ExpertArtifactBehavior = "none" | "save_on_request" | "suggest_save" | "artifact_friendly";
export type ExpertApprovalBehavior = "none" | "uses_existing_approval_flows";

export type ExpertContextRequirement =
  | "hubspot_record"
  | "gmail_thread"
  | "company_or_person_details"
  | "web_research_context"
  | "session_context";

export type ExpertRoutingHint = {
  intentKeywords: string[];
  selectedItemProviders?: Array<"gmail" | "hubspot">;
  selectedItemTypes?: string[];
  prefersModes?: Array<"auto" | "search" | "research" | "extract_url" | "workflow">;
};

export type ExpertSuggestedAction = {
  id: string;
  label: string;
  actionType: "save_to_library" | "create_workflow" | "prepare_gmail_send" | "prepare_hubspot_update";
  requiresApproval: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
};

export type ExpertExecutionResult<TPayload = Record<string, unknown>> = {
  expertType: ExpertTypeId;
  expertGroup: ExpertGroupId;
  rendererKey: ExpertRendererKey;
  payload: TPayload;
  suggestedActions: ExpertSuggestedAction[];
};

export type ExpertSelectedItem = {
  provider: "gmail" | "hubspot";
  itemId: string;
  title: string;
  itemType: string;
  summary?: string;
};

export type ExpertPromptContext = {
  userMessage: string;
  selectedAgentId: string | null;
  selectedAgentName: string;
  selectedItemContextBlock?: string;
  workspaceContextPackage?: string;
  sessionContext?: string;
  retrievalContext?: string;
  toolSummary?: string;
  relevantSopsBlock?: string;
  missingContext?: string[];
};

export type ExpertRegistryEntry<TSchema extends ZodTypeAny = ZodTypeAny> = {
  expertType: ExpertTypeId;
  expertGroup: ExpertGroupId;
  mappedAgents: ExpertAgentId[];
  rendererKey: ExpertRendererKey;
  schema: TSchema;
  triggerExamples: string[];
  routingHints: ExpertRoutingHint[];
  requiredContext: ExpertContextRequirement[];
  preferredIntegrations: Array<"gmail" | "hubspot">;
  artifactBehavior: ExpertArtifactBehavior;
  approvalBehavior: ExpertApprovalBehavior;
  canSuggestWorkflow: boolean;
};

export type ExpertPayload<TSchema extends ZodTypeAny> = z.infer<TSchema>;

export type ExpertRouteDecision =
  | {
      status: "none";
    }
  | {
      status: "match";
      expertType: ExpertTypeId;
      reason: string;
    }
  | {
      status: "needs_context";
      expertType: ExpertTypeId;
      message: string;
    };
