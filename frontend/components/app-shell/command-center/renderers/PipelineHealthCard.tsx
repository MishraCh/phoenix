import { CalloutBlock, CardShell, ConfidenceMeter, SectionLabel } from "./CardShell";
import { MissingDataState } from "./MissingDataState";
import type { CommandExpertResult, PipelineHealthPayload } from "@/services/command";

export function PipelineHealthCard({ payload }: { payload: PipelineHealthPayload }) {

  if (payload?.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Pipeline Health Unavailable"
      />
    );
  }

  const source = payload?.searchMetadata?.sourceUsed ?? null;

  const maxStageCount = payload?.funnelStages?.reduce((max, s) => Math.max(max, s.count), 0) || 1;

  return (
    <CardShell type="pipeline_health" sourceLabel={source}>
      <div className="space-y-5">
        {payload?.summary && (
          <p className="text-[14px] leading-6 text-foreground/90">{payload.summary}</p>
        )}

        <div className="grid grid-cols-2 gap-4 rounded-xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-4">
          {payload?.totalValue && (
            <div>
              <SectionLabel>Total Value</SectionLabel>
              <p className="text-[14px] font-semibold text-emerald-600">{payload.totalValue}</p>
            </div>
          )}
          {payload?.dealCount !== undefined && (
            <div>
              <SectionLabel>Active Deals</SectionLabel>
              <p className="text-[13px] font-medium text-foreground">{payload.dealCount}</p>
            </div>
          )}
          {payload?.atRiskDeals !== undefined && (
            <div>
              <SectionLabel>At Risk</SectionLabel>
              <p className="text-[13px] font-medium text-rose-600">{payload.atRiskDeals}</p>
            </div>
          )}
          {payload?.velocity && (
            <div>
              <SectionLabel>Avg Velocity</SectionLabel>
              <p className="text-[13px] font-medium text-foreground">{payload.velocity}</p>
            </div>
          )}
        </div>

        {payload?.funnelStages && payload.funnelStages.length > 0 && (
          <div className="space-y-3">
            <SectionLabel>Funnel Breakdown</SectionLabel>
            <div className="space-y-2.5">
              {payload.funnelStages.map((stage, i) => {
                const pct = Math.max(5, Math.round((stage.count / maxStageCount) * 100));
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-[120px] shrink-0 truncate text-[12px] font-medium text-muted-foreground">
                      {stage.stageName}
                    </div>
                    <div className="flex h-5 flex-1 items-center">
                      <div
                        className="h-full rounded-r bg-emerald-500/20"
                        style={{ width: `${pct}%` }}
                      >
                        <div className="flex h-full w-full items-center justify-end px-2 text-[10px] font-semibold text-emerald-700">
                          {stage.count}
                        </div>
                      </div>
                    </div>
                    {stage.value && (
                      <div className="w-[80px] shrink-0 text-right text-[12px] font-medium text-foreground/80">
                        {stage.value}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <ConfidenceMeter confidence={payload?.confidence} />
      </div>
    </CardShell>
  );
}
