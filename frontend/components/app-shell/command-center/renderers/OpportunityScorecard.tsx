"use client";

import { cn } from "@/lib/utils";
import type { OpportunityScorecardPayload } from "@/services/command";
import { CardShell, Chips, ConfidenceMeter, SectionLabel, CalloutBlock } from "./CardShell";
import { MissingDataState } from "./MissingDataState";

function ScoreRing({ score }: { score: number }) {
  const color =
    score >= 75
      ? { ring: "ring-emerald-400", text: "text-emerald-700", bg: "bg-emerald-50" }
      : score >= 50
        ? { ring: "ring-amber-400", text: "text-amber-700", bg: "bg-amber-50" }
        : { ring: "ring-rose-400", text: "text-rose-700", bg: "bg-rose-50" };

  return (
    <div
      className={cn(
        "flex size-16 shrink-0 flex-col items-center justify-center rounded-full ring-4",
        color.ring,
        color.bg,
      )}
    >
      <span className={cn("text-2xl font-bold leading-none", color.text)}>{score}</span>
      <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        Score
      </span>
    </div>
  );
}

export function OpportunityScorecard({ payload }: { payload: OpportunityScorecardPayload }) {
  if (payload.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Opportunity Scorecard Unavailable"
      />
    );
  }

  const whyNow = payload.whyNow ?? [];
  const accountSignals = payload.accountSignals ?? [];
  const nextSteps = payload.nextSteps ?? [];
  const risks = payload.risks ?? [];
  const crmActionHints = payload.crmActionHints ?? [];
  const source = payload.searchMetadata?.sourceUsed ?? null;

  return (
    <CardShell type="opportunity_scorecard" sourceLabel={source}>
      <div className="space-y-5">
        {payload.status === "partial" && payload.searchMetadata && (
          <MissingDataState
            status={payload.status}
            searchMetadata={payload.searchMetadata}
            title="Partial Data Available"
          />
        )}

        {/* Header row: summary + score ring */}
        <div className="flex items-start gap-4">
          <div className="flex-1">
            {payload.summary && (
              <p className="text-[15px] leading-7 text-foreground/90">{payload.summary}</p>
            )}
          </div>
          {payload.opportunityScore !== undefined && (
            <ScoreRing score={payload.opportunityScore} />
          )}
        </div>

        {/* Why now + Account signals */}
        {(whyNow.length > 0 || accountSignals.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {whyNow.length > 0 && (
              <div>
                <SectionLabel>Why Now</SectionLabel>
                <Chips items={whyNow} tone="info" />
              </div>
            )}
            {accountSignals.length > 0 && (
              <div>
                <SectionLabel>Account Signals</SectionLabel>
                <Chips items={accountSignals} />
              </div>
            )}
          </div>
        )}

        {/* Recommended play */}
        {payload.recommendedPlay && (
          <div>
            <SectionLabel>Recommended Play</SectionLabel>
            <CalloutBlock tone="success">
              <p className="text-[14px] leading-6">{payload.recommendedPlay}</p>
            </CalloutBlock>
          </div>
        )}

        {/* Next steps */}
        {nextSteps.length > 0 && (
          <div>
            <SectionLabel>Next Steps</SectionLabel>
            <ol className="space-y-1.5 pl-4 text-[14px] leading-6 text-foreground/86 [list-style-type:decimal]">
              {nextSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Risks */}
        {risks.length > 0 && (
          <div>
            <SectionLabel>Risks</SectionLabel>
            <Chips items={risks} tone="danger" />
          </div>
        )}

        {/* CRM hints */}
        {crmActionHints.length > 0 && (
          <div>
            <SectionLabel>CRM Action Hints</SectionLabel>
            <Chips items={crmActionHints} tone="warning" />
          </div>
        )}

        <ConfidenceMeter confidence={payload.confidence} />
      </div>
    </CardShell>
  );
}
