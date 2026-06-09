"use client";

import type { ContactBriefPayload } from "@/services/command";
import { CardShell, Chips, ConfidenceMeter, SectionLabel, CalloutBlock } from "./CardShell";
import { MissingDataState } from "./MissingDataState";

export function ContactBriefCard({ payload }: { payload: ContactBriefPayload }) {
  if (payload.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Contact Brief Unavailable"
      />
    );
  }

  const signals = payload.signals ?? [];
  const painPoints = payload.painPoints ?? [];
  const nextActions = payload.nextActions ?? [];
  const risks = payload.risks ?? [];
  const source = payload.searchMetadata?.sourceUsed ?? null;

  return (
    <CardShell type="contact_brief" sourceLabel={source}>
      <div className="space-y-5">
        {payload.status === "partial" && payload.searchMetadata && (
          <MissingDataState
            status={payload.status}
            searchMetadata={payload.searchMetadata}
            title="Partial Data Available"
          />
        )}

        {/* Summary */}
        {payload.summary && (
          <p className="text-[15px] leading-7 text-foreground/90">{payload.summary}</p>
        )}

        {/* Buyer context callout */}
        {payload.buyerContext && (
          <div>
            <SectionLabel>Buyer Context</SectionLabel>
            <CalloutBlock tone="info">
              <p className="text-[14px] leading-6">{payload.buyerContext}</p>
            </CalloutBlock>
          </div>
        )}

        {/* Recommended angle */}
        {payload.recommendedAngle && (
          <div>
            <SectionLabel>Recommended Angle</SectionLabel>
            <p className="text-[14px] leading-6 text-foreground/86">{payload.recommendedAngle}</p>
          </div>
        )}

        {/* Signals */}
        {signals.length > 0 && (
          <div>
            <SectionLabel>Signals</SectionLabel>
            <Chips items={signals} tone="info" />
          </div>
        )}

        {/* Pain points + Next actions */}
        {(painPoints.length > 0 || nextActions.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {painPoints.length > 0 && (
              <div>
                <SectionLabel>Pain Points</SectionLabel>
                <Chips items={painPoints} tone="warning" />
              </div>
            )}
            {nextActions.length > 0 && (
              <div>
                <SectionLabel>Next Actions</SectionLabel>
                <Chips items={nextActions} tone="success" />
              </div>
            )}
          </div>
        )}

        {/* Risks */}
        {risks.length > 0 && (
          <div>
            <SectionLabel>Risks</SectionLabel>
            <Chips items={risks} tone="danger" />
          </div>
        )}

        <ConfidenceMeter confidence={payload.confidence} />
      </div>
    </CardShell>
  );
}
