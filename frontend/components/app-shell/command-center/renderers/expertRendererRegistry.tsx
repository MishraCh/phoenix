"use client";

import type { CommandExpertRendererKey, CommandExpertResult } from "@/services/command";

import { CompetitorBattlecard } from "./CompetitorBattlecard";
import { ContactBriefCard } from "./ContactBriefCard";
import { OpportunityScorecard } from "./OpportunityScorecard";
import { OutreachDraftCard } from "./OutreachDraftCard";
import { PreCallBriefCard } from "./PreCallBriefCard";
import { SignalRadarCard } from "./SignalRadarCard";
import { ExpertResultRenderer } from "./ExpertResultRenderer";
import { SalesIntelligenceCard } from "./SalesIntelligenceCard";
import { AccountSnapshotCard } from "./AccountSnapshotCard";
import { PipelineHealthCard } from "./PipelineHealthCard";
import { DealRiskCard } from "./DealRiskCard";
import { MeetingSummaryCard } from "./MeetingSummaryCard";
import { GrantShortlistCard } from "./GrantShortlistCard";
import { CommitmentConfirmationCard } from "./CommitmentConfirmationCard";

export const expertRendererRegistry: Record<CommandExpertRendererKey, CommandExpertResult["expertType"]> = {
  "contact-brief-card": "contact_brief",
  "pre-call-brief-card": "pre_call_brief",
  "opportunity-scorecard": "opportunity_scorecard",
  "outreach-draft-card": "outreach_draft",
  "competitor-battlecard": "competitor_battlecard",
  "signal-radar-card": "signal_radar",
  "sales-intelligence-card": "sales_intelligence",
  "account-snapshot-card": "account_snapshot",
  "pipeline-health-card": "pipeline_health",
  "deal-risk-card": "deal_risk",
  "meeting-summary-card": "meeting_summary",
  "grant-shortlist-card": "grant_shortlist",
  "commitment-confirmation-card": "commitment_confirmation",
  "expert-result-renderer": "document_analysis",
  "generic-structured-result": "document_analysis",
  "meeting-debrief-card": "meeting_debrief",
  "report-scorecard": "report_scorecard",
  "executive-brief-card": "executive_brief",
  "buyer-universe-card": "ma_brief",
  "legal-risk-panel": "legal_risk_panel",
  "compliance-assessment-card": "compliance_assessment",
  "patent-analysis-card": "patent_analysis",
  "people-insight-card": "people_insight",
};

export function ExpertRendererRegistry({ result }: { result: CommandExpertResult }) {
  switch (result.expertType) {
    case "contact_brief":
      return <ContactBriefCard payload={result.payload} />;
    case "pre_call_brief":
      return <PreCallBriefCard payload={result.payload} />;
    case "opportunity_scorecard":
      return <OpportunityScorecard payload={result.payload} />;
    case "outreach_draft":
      return <OutreachDraftCard payload={result.payload} />;
    case "competitor_battlecard":
      return <CompetitorBattlecard payload={result.payload} />;
    case "signal_radar":
      return <SignalRadarCard payload={result.payload} />;
    case "sales_intelligence":
      return <SalesIntelligenceCard payload={result.payload} />;
    case "account_snapshot":
      return <AccountSnapshotCard payload={result.payload} />;
    case "pipeline_health":
      return <PipelineHealthCard payload={result.payload} />;
    case "deal_risk":
      return <DealRiskCard payload={result.payload} />;
    case "meeting_summary":
      return <MeetingSummaryCard payload={result.payload} />;
    case "grant_shortlist":
      return <GrantShortlistCard payload={result.payload} />;
    case "commitment_confirmation":
      return <CommitmentConfirmationCard payload={result.payload} />;
    case "document_analysis":
      return <ExpertResultRenderer result={result} />;
    case "meeting_debrief":
    case "report_scorecard":
    case "executive_brief":
    case "ma_brief":
    case "legal_risk_panel":
    case "compliance_assessment":
    case "patent_analysis":
    case "people_insight":
      return <ExpertResultRenderer result={result} />;
    default:
      return <ExpertResultRenderer result={result} />;
  }
}
