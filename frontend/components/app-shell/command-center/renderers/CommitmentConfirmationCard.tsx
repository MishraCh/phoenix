import { CardShell, SectionLabel } from "./CardShell";
import { MissingDataState } from "./MissingDataState";
import type { CommitmentConfirmationPayload } from "@/services/command";

export function CommitmentConfirmationCard({ payload }: { payload: CommitmentConfirmationPayload }) {

  if (payload?.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Commitment Details Unavailable"
      />
    );
  }

  const source = payload?.searchMetadata?.sourceUsed ?? "Email Sync";

  return (
    <CardShell type="commitment_confirmation" sourceLabel={source}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
          </div>
          <div>
            <h3 className="text-[16px] font-semibold text-foreground tracking-tight">
              Commitment Tracked
            </h3>
            <p className="text-[14px] text-muted-foreground mt-0.5">
              {payload.commitmentType}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 rounded-xl border border-border/50 bg-muted/20 p-4">
          <div>
            <SectionLabel>Due By</SectionLabel>
            <p className="text-[13px] font-medium text-foreground">{payload.dueDate}</p>
          </div>
        </div>

        {payload.context && (
          <div>
            <SectionLabel>Context</SectionLabel>
            <blockquote className="mt-2 border-l-2 border-primary/40 pl-4 text-[14px] leading-6 text-foreground/90 italic">
              "{payload.context}"
            </blockquote>
          </div>
        )}

        {payload.suggestedAction && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <SectionLabel>Suggested Action</SectionLabel>
            <p className="text-[14px] leading-6 text-foreground/90 mt-1">{payload.suggestedAction}</p>
          </div>
        )}
      </div>
    </CardShell>
  );
}
