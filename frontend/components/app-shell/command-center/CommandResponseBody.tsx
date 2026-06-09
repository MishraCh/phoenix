"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

import { Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  CapabilityGuideResult,
  CommandExpertResult,
  IntegrationRecordsResult,
  CommandResponse,
  CommandSection,
  CommandSourceRef,
  WorkflowDraftResult,
} from "@/services/command";
import type { WorkflowStep } from "@/services/workflows";

import { ExpertRendererRegistry } from "./renderers/expertRendererRegistry";
import { CrmApprovalRouter } from "./renderers/CrmApprovalRouter";
import { InlineWorkflowEditor } from "./InlineWorkflowEditor";
import { CapabilityGuideCard } from "./renderers/CapabilityGuideCard";
import { IntegrationRecordsCard } from "./renderers/IntegrationRecordsCard";

// ─── Types ─────────────────────────────────────────────────────────────────────

type CommandResponseBodyProps = {
  response: CommandResponse;
  hasDetails?: boolean;
  onOpenDetails?: () => void;
  approvalStatus?: string;
  onEditApproval?: (approvalId: string) => void;
  onApproveApproval?: (messageId: string, approvalId: string, options?: { retry?: boolean }) => void;
  messageId: string;
  /** If the previous message in the thread was an expert card, pass its type here
   *  so this text response gets a left-border accent for visual continuity. */
  prevExpertType?: string | null;
};

// ─── Markdown components ────────────────────────────────────────────────────────

const mdComponents: Components = {
  p: ({ children }) => (
    <p className="text-[14.5px] leading-7 text-foreground/90 [&:not(:first-child)]:mt-3">{children}</p>
  ),
  h1: ({ children }) => (
    <h2 className="mt-6 text-lg font-semibold tracking-tight text-foreground first:mt-0">{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-5 text-[15px] font-semibold tracking-tight text-foreground first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-4 text-[14px] font-semibold text-foreground first:mt-0">{children}</h4>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-foreground/80">{children}</em>,
  ul: ({ children }) => (
    <ul className="mt-3 space-y-1.5 pl-5 text-[14.5px] leading-7 text-foreground/90 [list-style-type:disc]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 space-y-1.5 pl-5 text-[14.5px] leading-7 text-foreground/90 [list-style-type:decimal]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="text-[14.5px] leading-7">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline decoration-primary/25 underline-offset-4 hover:text-primary/80"
    >
      {children}
    </a>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) return <code className={`${className} text-xs`}>{children}</code>;
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground/85">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mt-4 overflow-x-auto rounded-xl border border-border/55 bg-muted/40 p-4 text-xs leading-6 text-foreground/88">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-border/70 pl-4 text-[14.5px] leading-7 text-foreground/80">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border/55" />,
  table: ({ children }) => (
    <div className="mt-4 overflow-x-auto rounded-xl border border-border/55 bg-background">
      <table className="w-full min-w-[420px] text-[14px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border/60 bg-muted/30">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-4 py-3 text-left text-[12px] font-semibold text-foreground/72">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-3 align-top text-[14px] leading-6 text-foreground/82">{children}</td>
  ),
  tr: ({ children }) => <tr className="border-b border-border/40 last:border-0">{children}</tr>,
};

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
      {children}
    </ReactMarkdown>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function formatConfidence(confidence: number | null | undefined) {
  if (typeof confidence !== "number") return null;
  return `${Math.round(confidence * 100)}% confidence`;
}

function summarizeSources(sources: CommandSourceRef[]) {
  if (!sources.length) return "No sources attached";
  const freshness = sources.find((s) => s.freshness)?.freshness ?? null;
  return [sources.length === 1 ? "1 source reviewed" : `${sources.length} sources reviewed`, freshness]
    .filter(Boolean)
    .join(" · ");
}

// ─── Expert preamble map (frontend fallbacks) ─────────────────────────────────
// The backend now generates rich preambles via buildExpertPlanAnswer.
// These are fallback-only for cases where the backend answer field is empty/missing.

const EXPERT_DEFAULT_PREAMBLE: Record<string, string> = {
  contact_brief: "Here's the contact brief I put together — key signals, pain points, and the best angle of approach.",
  pre_call_brief: "Here's your pre-call brief to help you walk in prepared.",
  opportunity_scorecard: "Here's the opportunity scorecard I assembled.",
  outreach_draft: "Here's an outreach draft ready for your review.",
  competitor_battlecard: "Here's the competitive battlecard — strengths, weaknesses, and attack angles.",
  signal_radar: "Here are the key signals on my radar for this account.",
  document_analysis: "Here's my analysis of the document.",
  sales_intelligence: "Here's the sales intelligence I assembled — firmographics, tech stack, and hiring signals.",
  account_snapshot: "Here's a snapshot of this account — CRM health, deal stage, and open tasks.",
  deal_risk: "Here's the deal risk analysis — risk score, red flags, and recommended action.",
  meeting_summary: "Here's the meeting summary — decisions, action items, and a follow-up draft.",
  grant_shortlist: "Here's a shortlisted grant program that looks like a strong fit for your criteria.",
  commitment_confirmation: "I've extracted a commitment from this thread that you might want to track.",
  meeting_debrief: "Here's the meeting debrief and coaching readout.",
  report_scorecard: "Here's the report scorecard and improvement pass.",
  executive_brief: "Here's the executive brief.",
  ma_brief: "Here's the strategic M&A brief.",
  legal_risk_panel: "Here's the legal risk panel.",
  compliance_assessment: "Here's the compliance assessment.",
  patent_analysis: "Here's the patent analysis.",
  people_insight: "Here's the people insight summary.",
};

// ─── Per-expert-type accent color for text continuity ─────────────────────────
// When a text-only response follows an expert card, it gets a left-border in
// the card's accent color to maintain visual continuity across the thread.

const EXPERT_ACCENT_CLASSES: Record<string, string> = {
  contact_brief: "border-indigo-400",
  pre_call_brief: "border-violet-400",
  opportunity_scorecard: "border-emerald-400",
  outreach_draft: "border-sky-400",
  competitor_battlecard: "border-orange-400",
  signal_radar: "border-amber-400",
  document_analysis: "border-slate-400",
  sales_intelligence: "border-blue-400",
  pipeline_health: "border-emerald-500",
  deal_risk: "border-rose-400",
  meeting_summary: "border-cyan-400",
  grant_shortlist: "border-emerald-400",
  commitment_confirmation: "border-violet-400",
  meeting_debrief: "border-blue-400",
  report_scorecard: "border-slate-500",
  executive_brief: "border-indigo-500",
  ma_brief: "border-amber-500",
  legal_risk_panel: "border-red-400",
  compliance_assessment: "border-orange-400",
  patent_analysis: "border-teal-500",
  people_insight: "border-pink-400",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionFlow({ sections }: { sections: CommandSection[] }) {
  if (!sections.length) return null;
  return (
    <div className="space-y-5">
      {sections.map((section, index) => (
        <section
          key={`${section.title}-${index}`}
          className={index === 0 ? "" : "border-t border-border/40 pt-5"}
        >
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{section.title}</h3>
          <div className="mt-2.5">
            <Markdown>{section.body}</Markdown>
          </div>
        </section>
      ))}
    </div>
  );
}

function QuickTake({ highlights }: { highlights: string[] }) {
  const items = highlights.slice(0, 5);
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
        Quick take
      </p>
      <ul className="space-y-1.5 pl-5 text-[14px] leading-6 text-foreground/88 [list-style-type:disc]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function Recommendation({ section }: { section: CommandSection }) {
  return (
    <section className="rounded-xl border-l-2 border-primary/35 bg-primary/[0.035] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
        Recommended
      </p>
      <h3 className="mt-1 text-[15px] font-semibold tracking-tight text-foreground">{section.title}</h3>
      <div className="mt-2">
        <Markdown>{section.body}</Markdown>
      </div>
    </section>
  );
}

function WorkflowObject({ response }: { response: CommandResponse }) {
  if (
    !response.createdWorkflow &&
    !(response.result && response.result.kind === "workflow" && response.result.workflow)
  ) {
    return null;
  }
  const workflow =
    response.createdWorkflow ??
    (response.result && response.result.kind === "workflow" ? response.result.workflow : null);
  
  if (!workflow || !workflow.workflowId) return null;
  
  return (
    <div className="mt-4">
      <InlineWorkflowEditor workflowId={workflow.workflowId} />
    </div>
  );
}

function SourceSnapshot({
  title,
  url,
  publishDate,
  provider,
}: {
  title: string | null;
  url: string | null;
  publishDate: string | null;
  provider: string | null;
}) {
  return (
    <section className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
        Source
      </p>
      <p className="text-[15px] font-semibold tracking-tight text-foreground">
        {title ?? "Extracted page"}
      </p>
      {url ? (
        <p className="break-all text-[13px] leading-6 text-muted-foreground">{url}</p>
      ) : null}
      {[publishDate, provider].filter(Boolean).length ? (
        <p className="text-[12px] text-muted-foreground">
          {[publishDate, provider].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

function MetadataFooter({
  response,
  hasDetails,
  onOpenDetails,
}: {
  response: CommandResponse;
  hasDetails?: boolean;
  onOpenDetails?: () => void;
}) {
  if (!hasDetails || !onOpenDetails) return null;
  return (
    <div className="pt-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-auto min-h-0 justify-start rounded-full px-0 py-0 text-[11px] font-medium text-muted-foreground/80 hover:bg-transparent hover:text-foreground"
        onClick={onOpenDetails}
      >
        <Link2 className="mr-1 size-3" />
        Sources &amp; details
        {response.sources.length ? (
          <span className="ml-1 text-[10px] text-muted-foreground/60">
            · {summarizeSources(response.sources)}
          </span>
        ) : null}
      </Button>
    </div>
  );
}

// ─── Result-kind renderers ────────────────────────────────────────────────────

function DefaultAnswer({
  response,
  hasDetails,
  onOpenDetails,
  prevExpertType,
}: {
  response: CommandResponse;
  hasDetails?: boolean;
  onOpenDetails?: () => void;
  prevExpertType?: string | null;
}) {
  const result = response.result;
  if (!result || result.kind !== "answer") return null;

  const accentClass = prevExpertType ? EXPERT_ACCENT_CLASSES[prevExpertType] : null;

  return (
    <div
      className={
        accentClass
          ? `space-y-4 border-l-2 pl-4 ${accentClass}`
          : "space-y-4"
      }
    >
      {result.summary ? <Markdown>{result.summary}</Markdown> : null}
      <QuickTake highlights={result.highlights} />
      <SectionFlow sections={result.sections} />
      <MetadataFooter response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
    </div>
  );
}

function PartialResearchNotice({
  completeness,
}: {
  completeness?: number;
}) {
  return (
    <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs leading-5 text-amber-900">
      Partial research result
      {typeof completeness === "number"
        ? ` · ${Math.round(completeness * 100)}% complete`
        : ""}
      . Some sources or final synthesis were unavailable.
    </div>
  );
}

function SearchAnswer({
  response,
  hasDetails,
  onOpenDetails,
  prevExpertType,
}: {
  response: CommandResponse;
  hasDetails?: boolean;
  onOpenDetails?: () => void;
  prevExpertType?: string | null;
}) {
  const result = response.result;
  if (!result || result.kind !== "search") return null;

  const [recommended, ...rest] = result.sections;
  const accentClass = prevExpertType ? EXPERT_ACCENT_CLASSES[prevExpertType] : null;

  return (
    <div
      className={
        accentClass
          ? `space-y-4 border-l-2 pl-4 ${accentClass}`
          : "space-y-4"
      }
    >
      {result.partialResult || response.partialResult ? (
        <div className="space-y-1.5">
          <PartialResearchNotice
            completeness={result.completeness ?? response.partialResult?.completeness}
          />
          <p className="text-[11px] leading-5 text-amber-800/80">
            {[
              typeof (result.confidence ?? response.partialResult?.confidence) === "number"
                ? `${Math.round((result.confidence ?? response.partialResult!.confidence) * 100)}% confidence`
                : null,
              result.freshness ?? response.partialResult?.freshness,
              ...(result.failedSources ?? response.partialResult?.failedSources ?? [])
                .slice(0, 3)
                .map((source) => `Unavailable: ${source}`),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      ) : null}
      {result.summary ? <Markdown>{result.summary}</Markdown> : null}
      <QuickTake highlights={result.highlights} />
      {recommended ? <Recommendation section={recommended} /> : null}
      {rest.length ? <SectionFlow sections={rest} /> : null}
      <MetadataFooter response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
    </div>
  );
}

// ─── Citation strip — shown inline below research content ────────────────────
// Renders numbered citation pills. Clicking opens the URL. Full source list
// is available in the "Sources & details" drawer.

function ResearchAnswer({
  response,
  hasDetails,
  onOpenDetails,
}: {
  response: CommandResponse;
  hasDetails?: boolean;
  onOpenDetails?: () => void;
}) {
  const result = response.result;
  if (!result || result.kind !== "research") return null;
  const partial = result.partialResult || response.partialResult;
  return (
    <div className="space-y-4">
      {partial ? (
        <div className="space-y-1.5">
          <PartialResearchNotice
            completeness={result.completeness ?? response.partialResult?.completeness}
          />
          <p className="text-[11px] leading-5 text-amber-800/80">
            {[
              typeof (result.confidence ?? response.partialResult?.confidence) === "number"
                ? `${Math.round((result.confidence ?? response.partialResult!.confidence) * 100)}% confidence`
                : null,
              result.freshness ?? response.partialResult?.freshness,
              ...(result.failedSources ?? response.partialResult?.failedSources ?? [])
                .slice(0, 3)
                .map((source) => `Unavailable: ${source}`),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      ) : null}
      {result.summary ? <Markdown>{result.summary}</Markdown> : null}
      <QuickTake highlights={result.highlights} />
      <SectionFlow sections={result.sections} />
      <MetadataFooter response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
    </div>
  );
}

function ExtractAnswer({
  response,
  hasDetails,
  onOpenDetails,
}: {
  response: CommandResponse;
  hasDetails?: boolean;
  onOpenDetails?: () => void;
}) {
  const result = response.result;
  if (!result || result.kind !== "extract_url") return null;
  return (
    <div className="space-y-4">
      {result.summary ? <Markdown>{result.summary}</Markdown> : null}
      <SourceSnapshot
        title={result.page.title}
        url={result.page.url}
        publishDate={result.page.publishDate}
        provider={result.page.provider}
      />
      {result.excerpts.length ? (
        <details className="group text-[13px] text-muted-foreground">
          <summary className="cursor-pointer list-none font-medium text-foreground marker:hidden">
            Key excerpts
            <span className="ml-2 text-[12px] text-muted-foreground group-open:hidden">Show</span>
            <span className="ml-2 hidden text-[12px] text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <div className="mt-3 space-y-3">
            {result.excerpts.map((excerpt, index) => (
              <div key={`${index}-${excerpt.slice(0, 20)}`} className="border-l-2 border-border/50 pl-4">
                <Markdown>{excerpt}</Markdown>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <SectionFlow sections={result.sections} />
      <MetadataFooter response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
    </div>
  );
}

function WorkflowAnswer({
  response,
  hasDetails,
  onOpenDetails,
}: {
  response: CommandResponse;
  hasDetails?: boolean;
  onOpenDetails?: () => void;
}) {
  const result = response.result;
  if (!result || result.kind !== "workflow") return null;
  return (
    <div className="space-y-4">
      {result.summary ? <Markdown>{result.summary}</Markdown> : null}
      <WorkflowObject response={response} />
      <SectionFlow sections={result.sections} />
      <MetadataFooter response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
    </div>
  );
}

// ─── Expert Answer — the crown jewel of Phase 4 ──────────────────────────────
// Preamble + card are now visually bonded:
//  • preamble fades in with a subtle animation
//  • a thin horizontal rule (matching the card's accent color) separates them
//  • the card sits directly beneath with no float gap

function WorkflowDraftAnswer({
  response,
  hasDetails,
  onOpenDetails,
}: {
  response: CommandResponse;
  hasDetails?: boolean;
  onOpenDetails?: () => void;
}) {
  const result = response.result;
  if (!result || result.kind !== "workflow_draft") return null;

  const draftResult = result as WorkflowDraftResult;
  const draftSteps = draftResult.draft.steps.map((step) => ({
    id: step.id,
    type: step.type as WorkflowStep["type"],
    name: step.name,
    config: step.config,
    order: step.order,
  }));

  return (
    <div className="space-y-4">
      {draftResult.summary ? <Markdown>{draftResult.summary}</Markdown> : null}
      <InlineWorkflowEditor
        draft={{
          ...draftResult.draft,
          steps: draftSteps,
        }}
      />
      <SectionFlow sections={draftResult.sections} />
      <MetadataFooter response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
    </div>
  );
}

function CapabilityGuideAnswer({
  response,
  hasDetails,
  onOpenDetails,
}: {
  response: CommandResponse;
  hasDetails?: boolean;
  onOpenDetails?: () => void;
}) {
  const result = response.result;
  if (!result || result.kind !== "capability_guide") return null;

  return (
    <div className="space-y-3">
      <CapabilityGuideCard result={result as CapabilityGuideResult} />
      <MetadataFooter response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
    </div>
  );
}

function IntegrationRecordsAnswer({
  response,
  hasDetails,
  onOpenDetails,
}: {
  response: CommandResponse;
  hasDetails?: boolean;
  onOpenDetails?: () => void;
}) {
  const result = response.result;
  if (!result || result.kind !== "integration_records") return null;

  return (
    <div className="space-y-3">
      <IntegrationRecordsCard result={result as IntegrationRecordsResult} />
      <MetadataFooter response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
    </div>
  );
}

function ExpertAnswer({
  response,
  hasDetails,
  onOpenDetails,
}: {
  response: CommandResponse;
  hasDetails?: boolean;
  onOpenDetails?: () => void;
}) {
  const result = response.result;
  if (!result || result.kind !== "expert") return null;

  const expertType = (result as CommandExpertResult).expertType;
  const accentClass = EXPERT_ACCENT_CLASSES[expertType] ?? "border-muted-foreground/40";

  const preamble =
    response.answer?.trim() ||
    EXPERT_DEFAULT_PREAMBLE[expertType] ||
    "Here's what I found.";

  return (
    <div className="space-y-0">
      {/* Preamble — fades in, shares visual space with card via left accent connector */}
      <div className={`animate-in fade-in slide-in-from-bottom-1 duration-300 border-l-2 pl-3 pb-3 ${accentClass}`}>
        <p className="text-[14.5px] leading-7 text-foreground/90">{preamble}</p>
      </div>

      {/* Card — sits directly beneath the preamble line, connected by the accent */}
      <div className={`border-l-2 pl-3 ${accentClass}`}>
        <ExpertRendererRegistry result={result as CommandExpertResult} />
      </div>

      <MetadataFooter response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
    </div>
  );
}

function ClarificationAnswer({
  response,
}: {
  response: CommandResponse;
}) {
  const result = response.result;
  if (!result || result.kind !== "clarification") return null;
  return (
    <div className="space-y-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
        <p className="text-[13px] font-semibold tracking-wide uppercase">Clarification Needed</p>
      </div>
      {result.summary ? (
        <div className="text-[14.5px] leading-7 text-foreground/90">
          <Markdown>{result.summary}</Markdown>
        </div>
      ) : null}
      <p className="text-[15px] font-medium text-foreground">{result.question}</p>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function CommandResponseBody({
  response,
  hasDetails = false,
  onOpenDetails,
  approvalStatus,
  onEditApproval,
  onApproveApproval,
  messageId,
  prevExpertType,
}: CommandResponseBodyProps) {
  const result = response.result;
  const isCrmApproval =
    response.createdApproval && response.createdApproval.actionType?.startsWith("hubspot_");

  const renderApproval = () => {
    if (!isCrmApproval || !response.createdApproval) return null;
    return (
      <CrmApprovalRouter
        approvalId={response.createdApproval.approvalId}
        messageId={messageId}
        defaultStatus={approvalStatus}
        onEdit={onEditApproval}
        onApprove={onApproveApproval}
      />
    );
  };

  if (!result) {
    return (
      <div className="space-y-3">
        <div className="max-w-[52rem]">
          <Markdown>{response.answer ?? ""}</Markdown>
        </div>
        <MetadataFooter response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
        {renderApproval()}
      </div>
    );
  }

  switch (result.kind) {
    case "answer":
      return (
        <div className="space-y-3">
          <DefaultAnswer
            response={response}
            hasDetails={hasDetails}
            onOpenDetails={onOpenDetails}
            prevExpertType={prevExpertType}
          />
          {renderApproval()}
        </div>
      );
    case "search":
      return (
        <div className="space-y-3">
          <SearchAnswer
            response={response}
            hasDetails={hasDetails}
            onOpenDetails={onOpenDetails}
            prevExpertType={prevExpertType}
          />
          {renderApproval()}
        </div>
      );
    case "research":
      return (
        <div className="space-y-3">
          <ResearchAnswer response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
          {renderApproval()}
        </div>
      );
    case "extract_url":
      return (
        <div className="space-y-3">
          <ExtractAnswer response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
          {renderApproval()}
        </div>
      );
    case "workflow":
      return (
        <div className="space-y-3">
          <WorkflowAnswer response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
          {renderApproval()}
        </div>
      );
    case "workflow_draft":
      return (
        <div className="space-y-3">
          <WorkflowDraftAnswer response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
          {renderApproval()}
        </div>
      );
    case "capability_guide":
      return (
        <div className="space-y-3">
          <CapabilityGuideAnswer response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
          {renderApproval()}
        </div>
      );
    case "integration_records":
      return (
        <div className="space-y-3">
          <IntegrationRecordsAnswer response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
          {renderApproval()}
        </div>
      );
    case "clarification":
      return (
        <div className="space-y-3">
          <ClarificationAnswer response={response} />
        </div>
      );
    case "expert":
      return (
        <div className="space-y-2">
          <ExpertAnswer response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
          {renderApproval()}
        </div>
      );
    default:
      return (
        <div className="space-y-3">
          <div className="max-w-[52rem]">
            <Markdown>{response.answer ?? ""}</Markdown>
          </div>
          <MetadataFooter response={response} hasDetails={hasDetails} onOpenDetails={onOpenDetails} />
          {renderApproval()}
        </div>
      );
  }
}
