import { apiFetch } from "./apiClient";

export type CommandMode = "auto" | "search" | "research" | "extract_url" | "workflow";
export type CommandResultType =
  | "answer"
  | "search"
  | "research"
  | "extract_url"
  | "workflow"
  | "workflow_draft"
  | "expert"
  | "clarification"
  | "capability_guide"
  | "integration_records";

export type CommandSection = {
  title: string;
  body: string;
};

export type CommandSourceRef = {
  sourceType: string;
  sourceId: string;
  title?: string | null;
  url?: string | null;
  provider?: string | null;
  freshness?: "fresh" | "stale" | "partial" | "missing" | null;
  confidence?: number | null;
  fetchedAt?: string | null;
  citations?: Array<{
    title?: string | null;
    url?: string | null;
  }>;
  taskRunId?: string | null;
  sessionId?: string | null;
};

export type CommandRouteDecision = {
  routeId: string;
  intent: string;
  toolStrategy: string;
  provider?: "gmail" | "hubspot";
  objectType?: string;
  action?: string;
  expertCapabilityId?: string;
  confidence: number;
  missingRequirements: string[];
  clarificationQuestion?: string;
  expectedResultKind: string;
  routeSource: string;
  reason: string;
};

export type CommandPartialResult = {
  completeness: number;
  confidence: number;
  freshness: "fresh" | "stale" | "partial" | "missing" | "unknown";
  failedSources: string[];
};

export type CommandDisambiguationCandidate = {
  provider: "gmail" | "hubspot";
  objectType: string;
  id: string;
  label: string;
  description?: string;
};

export type CommandExpertType =
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
  | "grant_shortlist"
  | "commitment_confirmation"
  | "meeting_debrief"
  | "report_scorecard"
  | "executive_brief"
  | "ma_brief"
  | "legal_risk_panel"
  | "compliance_assessment"
  | "patent_analysis"
  | "people_insight";

export type CommandExpertGroup =
  | "revenue_intelligence"
  | "opportunity_analysis"
  | "outreach_messaging"
  | "market_research"
  | "executive_finance"
  | "legal_policy_ip"
  | "people_talent";

export type CommandExpertRendererKey =
  | "contact-brief-card"
  | "pre-call-brief-card"
  | "opportunity-scorecard"
  | "outreach-draft-card"
  | "competitor-battlecard"
  | "signal-radar-card"
  | "expert-result-renderer"
  | "sales-intelligence-card"
  | "account-snapshot-card"
  | "pipeline-health-card"
  | "deal-risk-card"
  | "meeting-summary-card"
  | "grant-shortlist-card"
  | "commitment-confirmation-card"
  | "generic-structured-result"
  | "meeting-debrief-card"
  | "report-scorecard"
  | "executive-brief-card"
  | "buyer-universe-card"
  | "legal-risk-panel"
  | "compliance-assessment-card"
  | "patent-analysis-card"
  | "people-insight-card";

export type CommandExpertSuggestedAction = {
  id: string;
  label: string;
  actionType: "save_to_library" | "create_workflow" | "prepare_gmail_send" | "prepare_hubspot_update";
  requiresApproval: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
};

export type ExpertPayloadStatus = "ready" | "missing_context" | "success" | "partial" | "not_found" | "connection_missing" | "permission_missing" | "error";

export type ExpertSearchMetadata = {
  query?: string;
  sourceUsed?: string;
  missingData?: string[];
};

export type ContactBriefPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  summary?: string;
  buyerContext?: string;
  painPoints?: string[];
  signals?: string[];
  recommendedAngle?: string;
  risks?: string[];
  nextActions?: string[];
  confidence?: number;
};

export type PreCallBriefPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  objective?: string;
  accountContext?: string;
  likelyObjections?: string[];
  suggestedQuestions?: string[];
  openingLines?: string[];
  successCriteria?: string[];
  confidence?: number;
};

export type OpportunityScorecardPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  summary?: string;
  opportunityScore?: number;
  whyNow?: string[];
  accountSignals?: string[];
  recommendedPlay?: string;
  risks?: string[];
  nextSteps?: string[];
  crmActionHints?: string[];
  confidence?: number;
};

export type OutreachDraftPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  summary?: string;
  audience?: string;
  subject?: string;
  body?: string;
  rationale?: string[];
  variants?: string[];
  confidence?: number;
};

export type CompetitorBattlecardPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  summary?: string;
  competitorOverview?: string;
  strengths?: string[];
  weaknesses?: string[];
  positioningGap?: string;
  attackAngles?: string[];
  watchItems?: string[];
  confidence?: number;
};

export type SignalRadarPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  summary?: string;
  urgency?: "low" | "medium" | "high" | "critical";
  signals?: Array<{
    title: string;
    whyItMatters: string;
    implication: string;
  }>;
  implications?: string[];
  suggestedMoves?: string[];
  confidence?: number;
};

export type DocumentAnalysisPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  summary?: string;
  details?: string;
  confidence?: number;
};

export type SalesIntelligencePayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  summary?: string;
  firmographics?: {
    industry?: string;
    employeeCount?: string;
    revenue?: string;
    location?: string;
  };
  techStack?: string[];
  hiringSignals?: string[];
  recommendedAngle?: string;
  confidence?: number;
};

export type AccountSnapshotPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  summary?: string;
  crmHealth?: "healthy" | "at_risk" | "churned" | "unknown";
  dealStage?: string;
  lastActivity?: string;
  owner?: string;
  openTasks?: string[];
  confidence?: number;
};

export type PipelineHealthPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  summary?: string;
  dealCount?: number;
  totalValue?: string;
  atRiskDeals?: number;
  velocity?: string;
  funnelStages?: Array<{
    stageName: string;
    count: number;
    value?: string;
  }>;
  confidence?: number;
};

export type DealRiskPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  summary?: string;
  riskScore?: number;
  riskFactors?: string[];
  mitigatingFactors?: string[];
  recommendedAction?: string;
  confidence?: number;
};

export type MeetingSummaryPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  summary?: string;
  attendees?: string[];
  decisions?: string[];
  actionItems?: Array<{
    owner?: string;
    task: string;
    completed?: boolean;
  }>;
  followUpDraft?: string;
  confidence?: number;
};

export type GrantShortlistPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  title: string;
  url: string;
  region: string;
  amount: string;
  deadline: string;
  fitScore: number;
  fitReasoning: string;
  nextAction: string;
};

export type CommitmentConfirmationPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  commitmentType: string;
  dueDate: string;
  context: string;
  suggestedAction: string;
};

export type GenericStructuredPayload = {
  status?: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  title?: string;
  summary?: string;
  score?: {
    label: string;
    value: number;
    explanation?: string;
  };
  sections?: Array<{
    title: string;
    body?: string;
    bullets?: string[];
  }>;
  table?: {
    columns: string[];
    rows: string[][];
  };
  checklist?: string[];
  timeline?: Array<{
    label: string;
    detail: string;
  }>;
  risks?: string[];
  recommendations?: string[];
  nextActions?: string[];
  confidence?: number;
};

export type CommandExpertResult =
  | {
      kind: "expert";
      expertType: "contact_brief";
      expertGroup: CommandExpertGroup;
      rendererKey: "contact-brief-card";
      payload: ContactBriefPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "pre_call_brief";
      expertGroup: CommandExpertGroup;
      rendererKey: "pre-call-brief-card";
      payload: PreCallBriefPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "opportunity_scorecard";
      expertGroup: CommandExpertGroup;
      rendererKey: "opportunity-scorecard";
      payload: OpportunityScorecardPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "outreach_draft";
      expertGroup: CommandExpertGroup;
      rendererKey: "outreach-draft-card";
      payload: OutreachDraftPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "competitor_battlecard";
      expertGroup: CommandExpertGroup;
      rendererKey: "competitor-battlecard";
      payload: CompetitorBattlecardPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "signal_radar";
      expertGroup: CommandExpertGroup;
      rendererKey: "signal-radar-card";
      payload: SignalRadarPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "document_analysis";
      expertGroup: CommandExpertGroup;
      rendererKey: "expert-result-renderer";
      payload: DocumentAnalysisPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "sales_intelligence";
      expertGroup: CommandExpertGroup;
      rendererKey: "sales-intelligence-card";
      payload: SalesIntelligencePayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "account_snapshot";
      expertGroup: CommandExpertGroup;
      rendererKey: "account-snapshot-card";
      payload: AccountSnapshotPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "pipeline_health";
      expertGroup: CommandExpertGroup;
      rendererKey: "pipeline-health-card";
      payload: PipelineHealthPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "deal_risk";
      expertGroup: CommandExpertGroup;
      rendererKey: "deal-risk-card";
      payload: DealRiskPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "meeting_summary";
      expertGroup: CommandExpertGroup;
      rendererKey: "meeting-summary-card";
      payload: MeetingSummaryPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "grant_shortlist";
      expertGroup: CommandExpertGroup;
      rendererKey: "grant-shortlist-card";
      payload: GrantShortlistPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: "commitment_confirmation";
      expertGroup: CommandExpertGroup;
      rendererKey: "commitment-confirmation-card";
      payload: CommitmentConfirmationPayload;
      suggestedActions?: CommandExpertSuggestedAction[];
    }
  | {
      kind: "expert";
      expertType: string;
      expertGroup: string;
      rendererKey: string;
      payload: GenericStructuredPayload | any;
      suggestedActions?: CommandExpertSuggestedAction[];
    };

export type CapabilityGuideResult = {
  kind: "capability_guide";
  status?: "ready" | "partial" | "missing";
  selectedAgentName?: string;
  headline?: string;
  categories?: Array<{
    title: string;
    description: string;
    examples?: string[];
  }>;
  connectedIntegrations?: Array<{
    provider: string;
    label: string;
    status?: string;
    capabilities?: string[];
  }>;
  limitations?: string[];
  nextActions?: Array<{
    label: string;
    prompt: string;
  }>;
};

export type IntegrationRecordsResult = {
  kind: "integration_records";
  provider: "gmail" | "hubspot" | string;
  module?: string | null;
  query?: string | null;
  status?: "completed" | "empty" | "not_found" | "multiple_matches" | "disconnected" | "error" | string;
  summary?: string;
  records?: Array<{
    id: string;
    title: string;
    subtitle?: string | null;
    url?: string | null;
    metadata?: Record<string, unknown>;
  }>;
  availableActions?: string[];
};

export type WorkflowDraftResult = {
  kind: "workflow_draft";
  summary: string;
  sections: CommandSection[];
  draft: {
    draftId: string;
    name: string;
    description?: string | null;
    trigger: Record<string, unknown>;
    deliveryIntent?: "in_app" | "system_email" | "gmail_outbound";
    steps: Array<{
      id: string;
      type: string;
      name: string;
      config: Record<string, unknown>;
      order: number;
    }>;
    validationIssues?: string[];
    clarificationQuestions?: string[];
  };
};

export type CommandResult = (
  | {
      kind: "answer";
      summary: string;
      highlights: string[];
      sections: CommandSection[];
    }
  | {
      kind: "search";
      summary: string;
      highlights: string[];
      sections: CommandSection[];
      provider: string | null;
      confidence: number | null;
      completeness?: number;
      freshness?: "fresh" | "stale" | "partial" | "missing" | "unknown";
      failedSources?: string[];
      partialResult?: boolean;
    }
  | {
      kind: "research";
      summary: string;
      highlights: string[];
      sections: CommandSection[];
      provider: string | null;
      confidence: number | null;
      artifactTitle: string | null;
      completeness?: number;
      freshness?: "fresh" | "stale" | "partial" | "missing" | "unknown";
      failedSources?: string[];
      partialResult?: boolean;
    }
  | {
      kind: "extract_url";
      summary: string;
      sections: CommandSection[];
      page: {
        url: string | null;
        title: string | null;
        publishDate: string | null;
        provider: string | null;
        sessionId: string | null;
      };
      excerpts: string[];
    }
  | {
      kind: "workflow";
      summary: string;
      sections: CommandSection[];
      workflow: {
        workflowId: string | null;
        name: string;
        triggerType: string;
        stepCount: number;
      } | null;
    }
  | {
      kind: "clarification";
      summary: string;
      question: string;
    }
  | CapabilityGuideResult
  | IntegrationRecordsResult
  | WorkflowDraftResult
  | CommandExpertResult
) & {
  status?: string;
  candidates?: CommandDisambiguationCandidate[];
};

export type CommandResponse = {
  answer: string | null;
  agentRunId: string;
  resolvedMode?: CommandMode;
  resultType?: CommandResultType;
  result?: CommandResult | null;
  createdArtifact?: {
    artifactId: string;
    title: string;
    artifactType: string;
    previewText: string;
  } | null;
  createdApproval?: {
    approvalId: string;
    label: string;
    riskLevel: "low" | "medium" | "high" | "critical";
    requiresApproval: boolean;
    actionType?: string;
    status?: "pending" | "executing" | "executed" | "failed";
  } | null;
  createdWorkflow?: {
    workflowId: string;
    name: string;
    triggerType: string;
    stepCount: number;
  } | null;
  proposedActions: Array<{
    id: string;
    label: string;
    riskLevel: "low" | "medium" | "high" | "critical";
    requiresApproval: boolean;
  }>;
  artifactDrafts: Array<{
    title: string;
    artifactType: string;
    previewText: string;
  }>;
  sources: CommandSourceRef[];
  missingContext: string[];
  creditsCharged: number;
  sessionId: string;
  assistantMessageId?: string;
  commandId?: string;
  routeDecision?: CommandRouteDecision | null;
  partialResult?: CommandPartialResult | null;
};

export function createLocalCommandPreview(input: string): CommandResponse {
  return {
    answer:
      "Sign in to run this with your live workspace context. For now, Gideon can still sketch a lightweight draft of what you asked for.",
    agentRunId: "local-preview",
    resolvedMode: "auto",
    resultType: "answer",
    result: {
      kind: "answer",
      summary:
        "Sign in to run this with your live workspace context. Gideon can then route between research, extraction, workflows, and action planning.",
      highlights: ["Live workspace context is not available yet."],
      sections: [
        {
          title: "What Gideon would do next",
          body: "Once you are signed in, Gideon will use your workspace context, selected agent, and chosen mode to decide whether this is a normal answer, research task, URL extraction, or workflow draft.",
        },
      ],
    },
    createdArtifact: null,
    createdApproval: null,
    createdWorkflow: null,
    proposedActions: [
      {
        id: "connect-auth",
        label: "Finish sign-in to unlock live runs",
        riskLevel: "low",
        requiresApproval: false,
      },
    ],
    artifactDrafts: [
      {
        title: "Command draft",
        artifactType: "summary",
        previewText: input,
      },
    ],
    sources: [],
    missingContext: ["Workspace access", "Connected tools", "Saved context"],
    creditsCharged: 0,
    sessionId: "",
    assistantMessageId: "",
  };
}

export function submitCommand(input: {
  firebaseIdToken: string;
  command: string;
  mode?: CommandMode;
  agentId?: string | null;
  contextBundleId?: string | null;
  attachments?: unknown[];
  sessionId?: string;
  timezone?: string;
  clientCommandId?: string;
}) {
  return apiFetch<CommandResponse>("/command", {
    firebaseIdToken: input.firebaseIdToken,
    method: "POST",
    body: JSON.stringify({
      input: input.command,
      mode: input.mode ?? "auto",
      agentId: input.agentId ?? null,
      contextBundleId: input.contextBundleId ?? null,
      attachments: input.attachments ?? [],
      sessionId: input.sessionId,
      timezone: input.timezone,
      clientCommandId: input.clientCommandId,
    }),
  });
}
