import { CalloutBlock, CardShell, Chips, ConfidenceMeter, SectionLabel } from "./CardShell";
import { MissingDataState } from "./MissingDataState";
import type { CommandExpertResult, SalesIntelligencePayload } from "@/services/command";

export function SalesIntelligenceCard({ payload }: { payload: SalesIntelligencePayload }) {

  if (payload?.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Sales Intelligence Unavailable"
      />
    );
  }

  const source = payload?.searchMetadata?.sourceUsed ?? null;

  return (
    <CardShell type="sales_intelligence" sourceLabel={source}>
      <div className="space-y-5">
        {payload?.summary && (
          <p className="text-[14px] leading-6 text-foreground/90">{payload.summary}</p>
        )}

        {payload?.firmographics && (
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-4">
            {payload.firmographics.industry && (
              <div>
                <SectionLabel>Industry</SectionLabel>
                <p className="text-[13px] font-medium text-foreground">{payload.firmographics.industry}</p>
              </div>
            )}
            {payload.firmographics.employeeCount && (
              <div>
                <SectionLabel>Employees</SectionLabel>
                <p className="text-[13px] font-medium text-foreground">{payload.firmographics.employeeCount}</p>
              </div>
            )}
            {payload.firmographics.revenue && (
              <div>
                <SectionLabel>Revenue</SectionLabel>
                <p className="text-[13px] font-medium text-foreground">{payload.firmographics.revenue}</p>
              </div>
            )}
            {payload.firmographics.location && (
              <div>
                <SectionLabel>Location</SectionLabel>
                <p className="text-[13px] font-medium text-foreground">{payload.firmographics.location}</p>
              </div>
            )}
          </div>
        )}

        {payload?.techStack && payload.techStack.length > 0 && (
          <div>
            <SectionLabel>Tech Stack</SectionLabel>
            <Chips items={payload.techStack} tone="info" />
          </div>
        )}

        {payload?.hiringSignals && payload.hiringSignals.length > 0 && (
          <div>
            <SectionLabel>Hiring Signals</SectionLabel>
            <Chips items={payload.hiringSignals} tone="success" />
          </div>
        )}

        {payload?.recommendedAngle && (
          <CalloutBlock tone="info">
            <span className="font-semibold">Angle: </span>
            {payload.recommendedAngle}
          </CalloutBlock>
        )}

        <ConfidenceMeter confidence={payload?.confidence} />
      </div>
    </CardShell>
  );
}
