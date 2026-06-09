import { CardShell, Chips, ConfidenceMeter, SectionLabel } from "./CardShell";
import { MissingDataState } from "./MissingDataState";
import type { CommandExpertResult, MeetingSummaryPayload } from "@/services/command";

export function MeetingSummaryCard({ payload }: { payload: MeetingSummaryPayload }) {

  if (payload?.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Meeting Summary Unavailable"
      />
    );
  }

  const source = payload?.searchMetadata?.sourceUsed ?? null;

  return (
    <CardShell type="meeting_summary" sourceLabel={source}>
      <div className="space-y-5">
        {payload?.summary && (
          <p className="text-[14px] leading-6 text-foreground/90">{payload.summary}</p>
        )}

        {payload?.attendees && payload.attendees.length > 0 && (
          <div>
            <SectionLabel>Attendees</SectionLabel>
            <Chips items={payload.attendees} />
          </div>
        )}

        {payload?.decisions && payload.decisions.length > 0 && (
          <div>
            <SectionLabel>Key Decisions</SectionLabel>
            <ul className="space-y-1.5 pl-5 text-[13px] leading-relaxed text-foreground/90 [list-style-type:disc]">
              {payload.decisions.map((decision, i) => (
                <li key={i}>{decision}</li>
              ))}
            </ul>
          </div>
        )}

        {payload?.actionItems && payload.actionItems.length > 0 && (
          <div>
            <SectionLabel>Action Items</SectionLabel>
            <div className="space-y-2 mt-2">
              {payload.actionItems.map((item, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-muted/10 p-2.5">
                  <div className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border ${item.completed ? "border-emerald-500 bg-emerald-500" : "border-muted-foreground/30"}`}>
                    {item.completed && (
                      <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[13px] leading-5 ${item.completed ? "text-muted-foreground line-through" : "text-foreground"}`}>
                      {item.task}
                    </p>
                    {item.owner && (
                      <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                        Assigned to: {item.owner}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {payload?.followUpDraft && (
          <div>
            <SectionLabel>Follow-up Draft</SectionLabel>
            <div className="rounded-xl border border-border/50 bg-muted/20 p-4 font-mono text-[12px] leading-relaxed text-foreground/80">
              {payload.followUpDraft}
            </div>
          </div>
        )}

        <ConfidenceMeter confidence={payload?.confidence} />
      </div>
    </CardShell>
  );
}
