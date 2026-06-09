import { CardShell, SectionLabel } from "./CardShell";
import { MissingDataState } from "./MissingDataState";
import type { GrantShortlistPayload } from "@/services/command";

export function GrantShortlistCard({ payload }: { payload: GrantShortlistPayload }) {

  if (payload?.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Grant Shortlist Unavailable"
      />
    );
  }

  const source = payload?.searchMetadata?.sourceUsed ?? "Web Research";

  return (
    <CardShell type="grant_shortlist" sourceLabel={source}>
      <div className="space-y-5">
        <div>
          <a
            href={payload.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-foreground text-[16px] hover:underline hover:text-primary transition-colors"
          >
            {payload.title}
          </a>
          <p className="text-[14px] text-muted-foreground mt-1">
            {payload.region}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 rounded-xl border border-border/50 bg-muted/20 p-4">
          <div>
            <SectionLabel>Amount</SectionLabel>
            <p className="text-[13px] font-medium text-foreground">{payload.amount}</p>
          </div>
          <div>
            <SectionLabel>Deadline</SectionLabel>
            <p className="text-[13px] font-medium text-foreground">{payload.deadline}</p>
          </div>
          <div>
            <SectionLabel>Fit Score</SectionLabel>
            <div className="mt-1 flex items-center gap-2">
              <span className={`size-2 shrink-0 rounded-full ${
                payload.fitScore >= 80 ? "bg-emerald-500" :
                payload.fitScore >= 50 ? "bg-amber-500" : "bg-rose-500"
              }`} />
              <span className="text-[13px] font-medium text-foreground">
                {payload.fitScore}/100
              </span>
            </div>
          </div>
        </div>

        {payload.fitReasoning && (
          <div>
            <SectionLabel>Why it's a fit</SectionLabel>
            <p className="text-[14px] leading-6 text-foreground/90 mt-1">{payload.fitReasoning}</p>
          </div>
        )}

        {payload.nextAction && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <SectionLabel>Recommended Next Action</SectionLabel>
            <p className="text-[14px] leading-6 text-foreground/90 mt-1">{payload.nextAction}</p>
          </div>
        )}
      </div>
    </CardShell>
  );
}
