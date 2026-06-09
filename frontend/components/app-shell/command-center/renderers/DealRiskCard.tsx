import { CalloutBlock, CardShell, Chips, ConfidenceMeter, SectionLabel } from "./CardShell";
import { MissingDataState } from "./MissingDataState";
import type { CommandExpertResult, DealRiskPayload } from "@/services/command";

export function DealRiskCard({ payload }: { payload: DealRiskPayload }) {

  if (payload?.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Deal Risk Analysis Unavailable"
      />
    );
  }

  const source = payload?.searchMetadata?.sourceUsed ?? null;

  return (
    <CardShell type="deal_risk" sourceLabel={source}>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          {payload?.summary && (
            <p className="flex-1 text-[14px] leading-6 text-foreground/90">{payload.summary}</p>
          )}
          {payload?.riskScore !== undefined && (
            <div className="flex shrink-0 flex-col items-center justify-center rounded-xl border border-border/50 bg-muted/20 px-4 py-2">
              <span className="text-[20px] font-bold tracking-tight text-rose-600">{payload.riskScore}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Risk Score</span>
            </div>
          )}
        </div>

        {payload?.riskFactors && payload.riskFactors.length > 0 && (
          <div>
            <SectionLabel>Risk Factors</SectionLabel>
            <ul className="space-y-1.5 pl-5 text-[13px] leading-relaxed text-foreground/90 [list-style-type:disc]">
              {payload.riskFactors.map((factor, i) => (
                <li key={i}>{factor}</li>
              ))}
            </ul>
          </div>
        )}

        {payload?.mitigatingFactors && payload.mitigatingFactors.length > 0 && (
          <div>
            <SectionLabel>Mitigating Factors</SectionLabel>
            <Chips items={payload.mitigatingFactors} tone="success" />
          </div>
        )}

        {payload?.recommendedAction && (
          <CalloutBlock tone="warning">
            <span className="font-semibold">Recommendation: </span>
            {payload.recommendedAction}
          </CalloutBlock>
        )}

        <ConfidenceMeter confidence={payload?.confidence} />
      </div>
    </CardShell>
  );
}
